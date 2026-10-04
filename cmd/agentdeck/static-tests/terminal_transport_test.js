const assert = require('node:assert/strict');
const test = require('node:test');

const transport = require('../static/terminal_transport.js');

class FakeSocket {
    static instances = [];

    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        FakeSocket.instances.push(this);
    }

    open() {
        this.readyState = 1;
        this.onopen?.({});
    }

    message(data) {
        this.onmessage?.({ data });
    }

    send(data) {
        this.sent.push(data);
    }

    close(code = 1000, reason = '') {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.({ code, reason });
    }
}

function makeTerminal() {
    const writes = [];
    let onData = null;
    let onBinary = null;
    let onResize = null;
    return {
        cols: 100,
        rows: 30,
        resets: 0,
        writes,
        write(data, callback) {
            writes.push({ data, callback });
        },
        reset() {
            this.resets++;
        },
        onData(callback) {
            onData = callback;
            return { dispose() { onData = null; } };
        },
        onBinary(callback) {
            onBinary = callback;
            return { dispose() { onBinary = null; } };
        },
        onResize(callback) {
            onResize = callback;
            return { dispose() { onResize = null; } };
        },
        emitData(data) { onData?.(data); },
        emitBinary(data) { onBinary?.(data); },
        emitResize(cols, rows) {
            this.cols = cols;
            this.rows = rows;
            onResize?.({ cols, rows });
        },
        finishWrite() {
            const write = writes.shift();
            write?.callback?.();
            return write;
        },
    };
}

function binary(text) {
    return new TextEncoder().encode(text).buffer;
}

function JSONMessages(socket, type) {
    return socket.sent
        .filter(value => typeof value === 'string')
        .map(value => JSON.parse(value))
        .filter(value => !type || value.type === type);
}

async function flushTasks() {
    await Promise.resolve();
    await Promise.resolve();
}

test.beforeEach(() => {
    FakeSocket.instances = [];
});

test('parseTerminalSyncMessage accepts only valid cursor markers', () => {
    assert.deepEqual(
        transport.parseTerminalSyncMessage('{"type":"terminal-sync","cursor":42,"reset":true}'),
        { cursor: 42, reset: true },
    );
    assert.deepEqual(
        transport.parseTerminalSyncMessage('{"type":"terminal-sync","cursor":0}'),
        { cursor: 0, reset: false },
    );
    assert.equal(transport.parseTerminalSyncMessage('{"type":"other","cursor":1}'), null);
    assert.equal(transport.parseTerminalSyncMessage('{"type":"terminal-sync","cursor":-1}'), null);
    assert.equal(transport.parseTerminalSyncMessage('not json'), null);
});

test('terminal cursor acknowledges bytes only after xterm parses them', async () => {
    const term = makeTerminal();
    const connection = transport.createTerminalConnection({
        term,
        baseUrl: 'ws://localhost/ws/project',
        cli: 'openai',
        socketFactory: url => new FakeSocket(url),
    });
    const socket = FakeSocket.instances[0];
    assert.match(socket.url, /protocol=2/);
    assert.match(socket.url, /cursor=0/);
    assert.match(socket.url, /cols=100/);
    assert.match(socket.url, /rows=30/);
    assert.match(socket.url, /cli=openai/);

    socket.open();
    socket.message('{"type":"terminal-sync","cursor":0}');
    await flushTasks();
    assert.equal(JSONMessages(socket, 'ack').at(-1).cursor, 0);

    socket.message(binary('abc'));
    assert.equal(connection.receivedCursor, 3);
    assert.equal(connection.appliedCursor, 0);
    assert.equal(JSONMessages(socket, 'ack').at(-1).cursor, 0);

    term.finishWrite();
    await flushTasks();
    assert.equal(connection.appliedCursor, 3);
    assert.equal(JSONMessages(socket, 'ack').at(-1).cursor, 3);
    connection.close();
});

test('reset stays ordered before replay and acknowledges the replay base', async () => {
    const term = makeTerminal();
    const connection = transport.createTerminalConnection({
        term,
        baseUrl: 'ws://localhost/ws/project',
        socketFactory: url => new FakeSocket(url),
    });
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.message('{"type":"terminal-sync","cursor":100,"reset":true}');
    socket.message(binary('tail'));

    assert.equal(term.writes.length, 2);
    assert.equal(term.resets, 0);
    assert.equal(connection.appliedCursor, 0);

    term.finishWrite();
    await flushTasks();
    assert.equal(term.resets, 1);
    assert.equal(connection.appliedCursor, 100);
    assert.equal(JSONMessages(socket, 'ack').at(-1).cursor, 100);

    term.finishWrite();
    await flushTasks();
    assert.equal(connection.appliedCursor, 104);
    assert.equal(JSONMessages(socket, 'ack').at(-1).cursor, 104);
    connection.close();
});

test('reconnect waits for pending parser writes and resumes at the applied cursor', async () => {
    const timers = [];
    const term = makeTerminal();
    const connection = transport.createTerminalConnection({
        term,
        baseUrl: 'ws://localhost/ws/project',
        socketFactory: url => new FakeSocket(url),
        setTimeout(callback, delay) {
            timers.push({ callback, delay });
            return timers.length;
        },
        clearTimeout() {},
    });
    const first = FakeSocket.instances[0];
    first.open();
    first.message('{"type":"terminal-sync","cursor":0}');
    first.message(binary('first'));
    first.close(1013, 'slow consumer');
    await flushTasks();

    assert.equal(timers.length, 0, 'reconnect started before xterm parsed queued output');
    assert.equal(FakeSocket.instances.length, 1);

    term.finishWrite();
    await flushTasks();
    assert.equal(connection.appliedCursor, 5);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 1000);

    timers[0].callback();
    const second = FakeSocket.instances[1];
    assert.ok(second, 'reconnect did not create another socket');
    assert.equal(new URL(second.url).searchParams.get('cursor'), '5');
    connection.close();
});

test('terminal input, binary input, and resize share the active connection', () => {
    const term = makeTerminal();
    const connection = transport.createTerminalConnection({
        term,
        baseUrl: 'ws://localhost/ws/project',
        socketFactory: url => new FakeSocket(url),
    });
    const socket = FakeSocket.instances[0];
    socket.open();

    term.emitData('hello');
    term.emitBinary('\x00\xff');
    term.emitResize(132, 44);

    const binaryMessages = socket.sent.filter(value => value instanceof Uint8Array);
    assert.deepEqual(Array.from(binaryMessages[0]), Array.from(new TextEncoder().encode('hello')));
    assert.deepEqual(Array.from(binaryMessages[1]), [0, 255]);
    assert.deepEqual(JSONMessages(socket, 'resize').at(-1), { type: 'resize', cols: 132, rows: 44 });
    connection.close();
});

test('a definitively closed session stops reconnecting', async () => {
    const timers = [];
    const term = makeTerminal();
    let closedCalls = 0;
    const connection = transport.createTerminalConnection({
        term,
        baseUrl: 'ws://localhost/ws/project',
        socketFactory: url => new FakeSocket(url),
        isSessionAlive: async () => false,
        onSessionClosed: () => { closedCalls++; },
        setTimeout(callback, delay) {
            timers.push({ callback, delay });
            return timers.length;
        },
    });
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.message('{"type":"terminal-sync","cursor":0}');
    socket.close(1000, 'done');
    await flushTasks();
    await flushTasks();

    assert.equal(connection.state, 'closed');
    assert.equal(closedCalls, 1);
    assert.equal(timers.length, 0);
});

test('a bounded reconnect policy exposes the closed-session recovery path', async () => {
    const timers = [];
    const term = makeTerminal();
    let closedDetail = null;
    const connection = transport.createTerminalConnection({
        term,
        baseUrl: 'ws://localhost/ws/project',
        socketFactory: url => new FakeSocket(url),
        maxReconnectAttempts: 1,
        closedMessage: '\r\n[Session closed]\r\n',
        onSessionClosed: detail => { closedDetail = detail; },
        setTimeout(callback, delay) {
            timers.push({ callback, delay });
            return timers.length;
        },
        clearTimeout() {},
    });

    const first = FakeSocket.instances[0];
    first.close(1013, 'temporarily unavailable');
    await flushTasks();
    assert.equal(timers.length, 1);

    timers[0].callback();
    const second = FakeSocket.instances[1];
    second.close(1013, 'still unavailable');
    await flushTasks();
    await flushTasks();

    assert.equal(connection.state, 'closed');
    assert.deepEqual(closedDetail, { reason: 'reconnect-limit' });
    assert.equal(timers.length, 1, 'transport scheduled another retry past the limit');
    assert.equal(term.writes.at(-1).data, '\r\n[Session closed]\r\n');
});
