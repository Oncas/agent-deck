(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TerminalTransport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DEFAULT_RECONNECT_INITIAL_MS = 1000;
    const DEFAULT_RECONNECT_MAX_MS = 15000;
    const DEFAULT_RECONNECT_MULTIPLIER = 1.5;

    function parseTerminalSyncMessage(data) {
        if (typeof data !== 'string') return null;
        let message;
        try {
            message = JSON.parse(data);
        } catch (_) {
            return null;
        }
        if (!message || message.type !== 'terminal-sync') return null;
        if (!Number.isSafeInteger(message.cursor) || message.cursor < 0) return null;
        return {
            cursor: message.cursor,
            reset: message.reset === true,
        };
    }

    function bytesFromBinaryString(data) {
        const bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
        return bytes;
    }

    function isSocketOpen(socket) {
        if (!socket) return false;
        const openState = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1;
        return socket.readyState === openState;
    }

    function safeCall(callback, ...args) {
        if (typeof callback !== 'function') return;
        try {
            callback(...args);
        } catch (err) {
            setTimeout(() => { throw err; }, 0);
        }
    }

    function createTerminalConnection(options = {}) {
        const term = options.term;
        const baseUrl = options.baseUrl;
        if (!term || typeof term.write !== 'function') throw new Error('terminal is required');
        if (!baseUrl) throw new Error('baseUrl is required');

        const socketFactory = typeof options.socketFactory === 'function'
            ? options.socketFactory
            : url => new WebSocket(url);
        const setTimer = options.setTimeout || setTimeout;
        const clearTimer = options.clearTimeout || clearTimeout;
        const queueTask = options.queueMicrotask
            || (typeof queueMicrotask === 'function' ? queueMicrotask : callback => Promise.resolve().then(callback));
        const reconnectInitialMs = options.reconnectInitialMs || DEFAULT_RECONNECT_INITIAL_MS;
        const reconnectMaxMs = options.reconnectMaxMs || DEFAULT_RECONNECT_MAX_MS;
        const reconnectMultiplier = options.reconnectMultiplier || DEFAULT_RECONNECT_MULTIPLIER;
        const maxReconnectAttempts = Number.isSafeInteger(options.maxReconnectAttempts)
            && options.maxReconnectAttempts >= 0
            ? options.maxReconnectAttempts
            : Number.POSITIVE_INFINITY;

        let socket = null;
        let state = 'connecting';
        let generation = 0;
        let reconnectTimer = null;
        let reconnectCheckPending = false;
        let reconnectAttempts = 0;
        let intentionallyClosed = false;
        let everConnected = false;
        let syncReceived = false;
        let receivedCursor = 0;
        let appliedCursor = 0;
        let pendingWrites = 0;
        let ackQueued = false;
        const idleWaiters = [];

        function setState(nextState, detail = {}) {
            state = nextState;
            safeCall(options.onStateChange, nextState, detail);
        }

        function flushIdleWaiters() {
            if (pendingWrites !== 0) return;
            while (idleWaiters.length > 0) {
                const callback = idleWaiters.shift();
                queueTask(callback);
            }
        }

        function afterWritesApplied(callback) {
            if (pendingWrites === 0) queueTask(callback);
            else idleWaiters.push(callback);
        }

        function queueAck(epoch) {
            if (ackQueued) return;
            ackQueued = true;
            queueTask(() => {
                ackQueued = false;
                if (epoch !== generation || !syncReceived || !isSocketOpen(socket)) return;
                socket.send(JSON.stringify({ type: 'ack', cursor: appliedCursor }));
            });
        }

        function writeFrame(bytes, epoch) {
            const frameStart = receivedCursor;
            const frameEnd = frameStart + bytes.byteLength;
            receivedCursor = frameEnd;
            pendingWrites++;
            term.write(bytes, () => {
                if (epoch === generation && frameEnd > appliedCursor) {
                    appliedCursor = frameEnd;
                    queueAck(epoch);
                    safeCall(options.onDataApplied, {
                        start: frameStart,
                        end: frameEnd,
                        byteLength: bytes.byteLength,
                    });
                }
                pendingWrites = Math.max(0, pendingWrites - 1);
                flushIdleWaiters();
            });
        }

        function applySync(sync, epoch) {
            syncReceived = true;
            receivedCursor = sync.cursor;
            if (!sync.reset) {
                appliedCursor = sync.cursor;
                queueAck(epoch);
                return;
            }

            pendingWrites++;
            // Queue the reset through xterm's parser so it stays ordered before
            // replay frames which can arrive immediately after the sync marker.
            term.write('', () => {
                if (epoch === generation) {
                    term.reset();
                    appliedCursor = sync.cursor;
                    queueAck(epoch);
                }
                pendingWrites = Math.max(0, pendingWrites - 1);
                flushIdleWaiters();
            });
        }

        function dimensions() {
            return {
                cols: Math.max(1, Number(term.cols) || 80),
                rows: Math.max(1, Number(term.rows) || 24),
            };
        }

        function connectionUrl() {
            const url = new URL(baseUrl);
            const size = dimensions();
            // Version 2 opts into parser acknowledgements. Keeping this
            // explicit lets a newly deployed server continue serving tabs
            // which still have the previous JavaScript cached.
            url.searchParams.set('protocol', '2');
            url.searchParams.set('cursor', String(appliedCursor));
            url.searchParams.set('cols', String(size.cols));
            url.searchParams.set('rows', String(size.rows));
            if (options.cli) url.searchParams.set('cli', options.cli);
            const extraQuery = options.query && typeof options.query === 'object' ? options.query : {};
            Object.entries(extraQuery).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    url.searchParams.set(key, String(value));
                }
            });
            return url.toString();
        }

        function sendResize() {
            if (!isSocketOpen(socket)) return false;
            const size = dimensions();
            socket.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
            return true;
        }

        function sendInput(data) {
            if (!isSocketOpen(socket)) return false;
            const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
            if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) return false;
            socket.send(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
            return true;
        }

        function stopForClosedSession(reason) {
            intentionallyClosed = true;
            setState('closed', { reason });
            if (options.closedMessage) term.write(options.closedMessage);
            safeCall(options.onSessionClosed, { reason });
        }

        async function scheduleReconnect(epoch) {
            if (intentionallyClosed || reconnectTimer || reconnectCheckPending || epoch !== generation) return;
            reconnectCheckPending = true;
            let sessionAlive = true;
            if (typeof options.isSessionAlive === 'function') {
                try {
                    sessionAlive = await options.isSessionAlive();
                } catch (err) {
                    // A missing session is definitive. Network failures are
                    // transient, so keep retrying the WebSocket in that case.
                    if (err && err.status === 404) sessionAlive = false;
                }
            }
            reconnectCheckPending = false;
            if (intentionallyClosed || epoch !== generation) return;
            if (!sessionAlive) {
                stopForClosedSession('session-closed');
                return;
            }

            reconnectAttempts++;
            if (reconnectAttempts > maxReconnectAttempts) {
                stopForClosedSession('reconnect-limit');
                return;
            }
            const delay = Math.min(
                reconnectInitialMs * Math.pow(reconnectMultiplier, reconnectAttempts - 1),
                reconnectMaxMs,
            );
            setState('reconnecting', { attempt: reconnectAttempts, delay });
            reconnectTimer = setTimer(() => {
                reconnectTimer = null;
                if (!intentionallyClosed && epoch === generation) connect();
            }, delay);
        }

        function connect() {
            if (intentionallyClosed) return;
            const epoch = ++generation;
            syncReceived = false;
            ackQueued = false;
            setState(everConnected ? 'reconnecting' : 'connecting');
            const ws = socketFactory(connectionUrl());
            socket = ws;
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                if (epoch !== generation || intentionallyClosed) return;
                reconnectAttempts = 0;
                const reconnected = everConnected;
                everConnected = true;
                setState('open', { reconnected });
                sendResize();
                safeCall(options.onOpen, { reconnected });
            };

            ws.onmessage = event => {
                if (epoch !== generation || intentionallyClosed) return;
                const sync = parseTerminalSyncMessage(event.data);
                if (sync) {
                    applySync(sync, epoch);
                    return;
                }
                if (!syncReceived) {
                    try { ws.close(1002, 'terminal sync marker required'); } catch (_) {}
                    return;
                }
                if (event.data instanceof ArrayBuffer) {
                    writeFrame(new Uint8Array(event.data), epoch);
                } else if (ArrayBuffer.isView(event.data)) {
                    writeFrame(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength), epoch);
                }
            };

            ws.onclose = event => {
                if (epoch !== generation) return;
                if (socket === ws) socket = null;
                if (intentionallyClosed) return;
                setState('disconnected', { code: event && event.code, reason: event && event.reason });
                // Reconnect only after xterm has parsed everything already
                // received. The next cursor therefore represents visible state,
                // not merely bytes delivered by the browser WebSocket stack.
                afterWritesApplied(() => scheduleReconnect(epoch));
            };

            ws.onerror = () => {
                // Browsers follow this with close; keeping one reconnect path
                // avoids duplicate timers and health checks.
            };
        }

        const dataDisposable = typeof term.onData === 'function'
            ? term.onData(data => sendInput(data))
            : null;
        const binaryDisposable = typeof term.onBinary === 'function'
            ? term.onBinary(data => sendInput(bytesFromBinaryString(data)))
            : null;
        const resizeDisposable = typeof term.onResize === 'function'
            ? term.onResize(() => sendResize())
            : null;

        if (options.connect !== false) connect();

        return {
            get socket() { return socket; },
            get state() { return state; },
            get appliedCursor() { return appliedCursor; },
            get receivedCursor() { return receivedCursor; },
            get pendingWrites() { return pendingWrites; },
            sendInput,
            sendResize,
            connect,
            whenIdle() {
                return new Promise(resolve => afterWritesApplied(resolve));
            },
            close() {
                if (intentionallyClosed) return;
                intentionallyClosed = true;
                generation++;
                if (reconnectTimer) clearTimer(reconnectTimer);
                reconnectTimer = null;
                const ws = socket;
                socket = null;
                if (ws) {
                    try { ws.close(1000, 'terminal closed'); } catch (_) {}
                }
                dataDisposable?.dispose?.();
                binaryDisposable?.dispose?.();
                resizeDisposable?.dispose?.();
                setState('closed', { reason: 'client-closed' });
                flushIdleWaiters();
            },
        };
    }

    return {
        parseTerminalSyncMessage,
        createTerminalConnection,
    };
});
