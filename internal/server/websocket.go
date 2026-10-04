package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"nhooyr.io/websocket"

	ptyPkg "agentdeck/internal/pty"
)

const (
	terminalWSFrameSize       = 64 * 1024
	terminalWSMaxUnackedBytes = 512 * 1024
)

type terminalClientMsg struct {
	Type   string `json:"type"`
	Cols   int    `json:"cols"`
	Rows   int    `json:"rows"`
	Cursor uint64 `json:"cursor"`
}

type terminalSyncMsg struct {
	Type   string `json:"type"`
	Cursor uint64 `json:"cursor"`
	Reset  bool   `json:"reset"`
}

type wsHandler struct {
	manager *ptyPkg.Manager
	api     *apiHandler
}

type terminalFlowState struct {
	enabled bool
	acked   atomic.Uint64
	sent    atomic.Uint64
	wake    chan struct{}
}

func newTerminalFlowState(cursor uint64, enabled bool) *terminalFlowState {
	state := &terminalFlowState{
		enabled: enabled,
		wake:    make(chan struct{}, 1),
	}
	state.acked.Store(cursor)
	state.sent.Store(cursor)
	return state
}

func (s *terminalFlowState) acknowledge(cursor uint64) bool {
	if !s.enabled {
		return true
	}
	for {
		acked := s.acked.Load()
		sent := s.sent.Load()
		if cursor < acked || cursor > sent {
			return false
		}
		if cursor == acked || s.acked.CompareAndSwap(acked, cursor) {
			select {
			case s.wake <- struct{}{}:
			default:
			}
			return true
		}
	}
}

func (s *terminalFlowState) waitForWindow(ctx context.Context, size uint64) error {
	if !s.enabled {
		return nil
	}
	if size > terminalWSMaxUnackedBytes {
		return errors.New("terminal frame exceeds flow-control window")
	}
	for {
		sent := s.sent.Load()
		acked := s.acked.Load()
		if sent >= acked && sent-acked+size <= terminalWSMaxUnackedBytes {
			return nil
		}
		select {
		case <-s.wake:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func writeTerminalBinary(ctx context.Context, conn *websocket.Conn, flow *terminalFlowState, data []byte) error {
	for len(data) > 0 {
		size := min(len(data), terminalWSFrameSize)
		frame := data[:size]
		if err := flow.waitForWindow(ctx, uint64(size)); err != nil {
			return err
		}
		// Reserve the cursor before writing so an acknowledgement racing the
		// completion of conn.Write cannot be rejected as being ahead of sent.
		flow.sent.Add(uint64(size))
		if err := conn.Write(ctx, websocket.MessageBinary, frame); err != nil {
			return err
		}
		data = data[size:]
	}
	return nil
}

func newWSHandler(manager *ptyPkg.Manager, api *apiHandler) *wsHandler {
	return &wsHandler{manager: manager, api: api}
}

func (h *wsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*"},
	})
	if err != nil {
		log.Printf("websocket accept error: %v", err)
		return
	}
	defer conn.CloseNow()

	// Keep connection alive with periodic pings
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := conn.Ping(ctx); err != nil {
					cancel()
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	// Try to attach to an existing session first
	session := h.manager.Get(name)
	if session == nil {
		cols := 120
		rows := 40
		if c, err := strconv.Atoi(r.URL.Query().Get("cols")); err == nil && c > 0 {
			cols = c
		}
		if ro, err := strconv.Atoi(r.URL.Query().Get("rows")); err == nil && ro > 0 {
			rows = ro
		}
		var createErr error
		path, pathErr := h.api.resolveProjectPath(name)
		if pathErr != nil {
			conn.Close(websocket.StatusInternalError, pathErr.Error())
			return
		}
		session, createErr = h.manager.GetOrCreate(name, path, uint16(cols), uint16(rows), r.URL.Query().Get("cli"))
		if createErr != nil {
			log.Printf("session create error for %s: %v", name, createErr)
			conn.Close(websocket.StatusInternalError, "failed to create session")
			return
		}
	}

	requestedCursor := uint64(0)
	if rawCursor := r.URL.Query().Get("cursor"); rawCursor != "" {
		if parsed, parseErr := strconv.ParseUint(rawCursor, 10, 64); parseErr == nil {
			requestedCursor = parsed
		}
	}

	// Subscribe and capture the replay under one lock so output cannot be lost
	// or delivered twice at the snapshot/live boundary.
	sub, replay := session.SubscribeFrom(requestedCursor)
	defer session.Unsubscribe(sub)
	syncData, marshalErr := json.Marshal(terminalSyncMsg{
		Type:   "terminal-sync",
		Cursor: replay.Cursor,
		Reset:  replay.Reset,
	})
	if marshalErr != nil || conn.Write(ctx, websocket.MessageText, syncData) != nil {
		return
	}
	flow := newTerminalFlowState(replay.Cursor, r.URL.Query().Get("protocol") == "2")

	// Writer goroutine: PTY output → WebSocket. The browser acknowledges only
	// after xterm has parsed a frame, which bounds its parser queue and makes the
	// reconnect cursor describe rendered state instead of network delivery.
	go func() {
		defer cancel()
		if err := writeTerminalBinary(ctx, conn, flow, replay.Data); err != nil {
			return
		}
		for {
			select {
			case data, ok := <-sub.Output:
				if !ok {
					select {
					case <-sub.Overflow:
						conn.Close(websocket.StatusTryAgainLater, "terminal output subscriber fell behind")
					default:
					}
					return
				}
				if err := writeTerminalBinary(ctx, conn, flow, data); err != nil {
					return
				}
			case <-sub.Overflow:
				conn.Close(websocket.StatusTryAgainLater, "terminal output subscriber fell behind")
				return
			case <-ctx.Done():
				return
			}
		}
	}()

	// Reader loop: WebSocket → PTY input
	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}

		switch typ {
		case websocket.MessageBinary:
			// Raw keyboard input
			session.Write(data)
		case websocket.MessageText:
			var msg terminalClientMsg
			if json.Unmarshal(data, &msg) != nil {
				continue
			}
			switch msg.Type {
			case "resize":
				if msg.Cols > 0 && msg.Rows > 0 {
					session.Resize(uint16(msg.Cols), uint16(msg.Rows))
				}
			case "ack":
				flow.acknowledge(msg.Cursor)
			}
		}
	}
}

// wsConnContext returns a context that cancels when the connection closes.
func wsConnContext(ctx context.Context, conn *websocket.Conn) context.Context {
	ctx, cancel := context.WithCancel(ctx)
	go func() {
		defer cancel()
		conn.CloseRead(ctx)
	}()
	return ctx
}
