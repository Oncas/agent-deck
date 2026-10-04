package server

import (
	"context"
	"testing"
	"time"
)

func TestTerminalFlowStateWaitsForAppliedCursor(t *testing.T) {
	flow := newTerminalFlowState(0, true)
	flow.sent.Store(terminalWSMaxUnackedBytes)

	done := make(chan error, 1)
	go func() {
		done <- flow.waitForWindow(context.Background(), 1)
	}()

	select {
	case err := <-done:
		t.Fatalf("waitForWindow returned before acknowledgement: %v", err)
	case <-time.After(20 * time.Millisecond):
	}

	if !flow.acknowledge(1) {
		t.Fatal("valid acknowledgement was rejected")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("waitForWindow returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("waitForWindow did not resume after acknowledgement")
	}
}

func TestTerminalFlowStateRejectsInvalidAcknowledgements(t *testing.T) {
	flow := newTerminalFlowState(10, true)
	flow.sent.Store(20)

	if flow.acknowledge(9) {
		t.Fatal("flow accepted a cursor behind the applied cursor")
	}
	if flow.acknowledge(21) {
		t.Fatal("flow accepted a cursor ahead of sent output")
	}
	if !flow.acknowledge(15) {
		t.Fatal("flow rejected a cursor inside the sent range")
	}
	if got := flow.acked.Load(); got != 15 {
		t.Fatalf("acked cursor = %d, want 15", got)
	}
}

func TestTerminalFlowStateHonorsContextCancellation(t *testing.T) {
	flow := newTerminalFlowState(0, true)
	flow.sent.Store(terminalWSMaxUnackedBytes)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := flow.waitForWindow(ctx, 1); err == nil {
		t.Fatal("waitForWindow ignored context cancellation")
	}
}

func TestTerminalFlowStateLeavesLegacyClientsUnthrottled(t *testing.T) {
	flow := newTerminalFlowState(0, false)
	flow.sent.Store(terminalWSMaxUnackedBytes)
	if err := flow.waitForWindow(context.Background(), 1); err != nil {
		t.Fatalf("legacy flow was unexpectedly throttled: %v", err)
	}
}
