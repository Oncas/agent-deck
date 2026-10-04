const assert = require('node:assert/strict');
const test = require('node:test');

const interactions = require('../static/terminal_interactions.js');

test('normalizeExternalUrl allows only http and https URLs', () => {
    assert.equal(interactions.normalizeExternalUrl(' https://example.com/path?q=1 '), 'https://example.com/path?q=1');
    assert.equal(interactions.normalizeExternalUrl('http://example.com'), 'http://example.com/');
    assert.equal(interactions.normalizeExternalUrl('file:///tmp/nope'), '');
    assert.equal(interactions.normalizeExternalUrl('not a url'), '');
});

test('openExternalUrl uses Electron opener and reports failures', async () => {
    const opened = [];
    const alerts = [];
    const ok = await interactions.openExternalUrl('https://example.com', {
        electronOpenExternal: async (url) => {
            opened.push(url);
            return { ok: true };
        },
        alert: (message) => alerts.push(message),
    });

    assert.deepEqual(ok, { ok: true });
    assert.deepEqual(opened, ['https://example.com/']);
    assert.deepEqual(alerts, []);

    const failed = await interactions.openExternalUrl('https://example.com/fail', {
        electronOpenExternal: async () => ({ ok: false, error: 'denied' }),
        alert: (message) => alerts.push(message),
        console: { error() {} },
    });

    assert.equal(failed.ok, false);
    assert.equal(failed.error, 'denied');
    assert.match(alerts.at(-1), /denied/);
});

test('openExternalUrl falls back to browser window opener', async () => {
    const calls = [];
    const result = await interactions.openExternalUrl('https://example.com/docs', {
        openWindow: (...args) => {
            calls.push(args);
            return {};
        },
    });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [['https://example.com/docs', '_blank', 'noopener,noreferrer']]);
});

test('getTerminalContextMenuItems reflects selection and paste state', () => {
    const items = interactions.getTerminalContextMenuItems({
        hasSelection: true,
        selection: 'https://example.com',
        canPaste: false,
    });

    assert.deepEqual(items.map(item => [item.action, item.enabled]), [
        ['copy', true],
        ['paste', false],
        ['select-all', true],
        ['open-selected-link', true],
    ]);
    assert.equal(items.find(item => item.action === 'open-selected-link').url, 'https://example.com/');
});

function makeBuffer(rows, cols, { wrapped = [] } = {}) {
    const padded = rows.map(row => row.padEnd(cols, ' '));
    return {
        length: padded.length,
        getLine(index) {
            const text = padded[index];
            if (text === undefined) return undefined;
            return {
                isWrapped: wrapped.includes(index),
                translateToString: (trimRight) => (trimRight ? text.replace(/\s+$/, '') : text),
                getCell: (x) => ({ getChars: () => (text[x] === ' ' ? ' ' : text[x] ?? '') }),
            };
        },
    };
}

function hardWrap(text, cols) {
    const rows = [];
    for (let i = 0; i < text.length; i += cols) rows.push(text.slice(i, i + cols));
    return rows;
}

const FIRST_URL = 'https://github.test/a/compare/main...feat%2Fone-hard-wrap-fixture-branch-name?expand=1';
const SECOND_URL = 'https://github.test/b/compare/main...feat%2Ftwo-hard-wrap-fixture-branch-name?expand=1';
const TWO_URL_LINE = `    PR links: web-portal (${FIRST_URL}) and mocks (${SECOND_URL}) (done).`;

test('findTerminalLinks stops a hard-wrapped URL at the closing bracket', () => {
    const cols = 100;
    const rows = hardWrap(TWO_URL_LINE, cols);
    const buf = makeBuffer(rows, cols);

    const [first] = interactions.findTerminalLinks(buf, 0, cols);
    assert.equal(first.url, FIRST_URL);

    const [second] = interactions.findTerminalLinks(buf, 1, cols);
    assert.equal(second.url, SECOND_URL);
});

test('findTerminalLinks ends the range on the last URL character', () => {
    const cols = 100;
    const rows = hardWrap(TWO_URL_LINE, cols);
    const buf = makeBuffer(rows, cols);

    const [link] = interactions.findTerminalLinks(buf, 1, cols);
    const endRowText = rows[link.range.end.y - 1];
    assert.equal(endRowText[link.range.end.x - 1], SECOND_URL.at(-1));
    assert.equal(endRowText[link.range.end.x], ')');
});

test('findTerminalLinks resolves a URL split across three hard-wrapped rows', () => {
    const cols = 60;
    const url = 'https://github.test/group/project/compare/main...feat%2Fa-rather-long-branch-name-here-hard-wrap-fixture-branch-name?expand=1';
    const rows = ['  See: ' + url.slice(0, cols - 7), '  ' + url.slice(cols - 7, 2 * cols - 9), '  ' + url.slice(2 * cols - 9) + ' (done)'];
    const buf = makeBuffer(rows, cols);

    for (const rowIndex of [0, 1, 2]) {
        const links = interactions.findTerminalLinks(buf, rowIndex, cols);
        assert.equal(links.length, 1, `row ${rowIndex}`);
        assert.equal(links[0].url, url);
        assert.equal(links[0].range.end.y, 3);
        assert.equal(rows[2][links[0].range.end.x - 1], url.at(-1));
    }
});

test('findTerminalLinks handles URLs across terminal-wrapped rows', () => {
    const cols = 100;
    const rows = hardWrap(TWO_URL_LINE, cols);
    const buf = makeBuffer(rows, cols, { wrapped: [1] });

    const links = interactions.findTerminalLinks(buf, 1, cols);
    assert.deepEqual(links.map(link => link.url), [FIRST_URL, SECOND_URL]);
});

test('escapeDroppedPath escapes shell metacharacters but leaves unicode intact', () => {
    assert.equal(interactions.escapeDroppedPath('/home/user/My Docs/notes.txt'), '/home/user/My\\ Docs/notes.txt');
    assert.equal(interactions.escapeDroppedPath('/tmp/a$b&c(d).txt'), '/tmp/a\\$b\\&c\\(d\\).txt');
    assert.equal(interactions.escapeDroppedPath('/tmp/résumé-ü.txt'), '/tmp/résumé-ü.txt');
});

test('pathFromFileUri decodes local file URLs only', () => {
    assert.equal(interactions.pathFromFileUri('file:///home/user/My%20Docs'), '/home/user/My Docs');
    assert.equal(interactions.pathFromFileUri('file://localhost/tmp/x'), '/tmp/x');
    assert.equal(interactions.pathFromFileUri('file://remote/share/x'), '');
    assert.equal(interactions.pathFromFileUri('https://example.com'), '');
});

test('parseUriList skips comments and non-file entries', () => {
    const paths = interactions.parseUriList('# comment\nfile:///tmp/a.txt\r\nhttps://example.com\nfile:///tmp/b%20c.txt\n');
    assert.deepEqual(paths, ['/tmp/a.txt', '/tmp/b c.txt']);
});

test('buildDropInsertion joins escaped paths and falls back to plain text', () => {
    assert.equal(
        interactions.buildDropInsertion({ paths: ['/tmp/a b.txt', '/tmp/c.txt'], text: 'ignored' }),
        '/tmp/a\\ b.txt /tmp/c.txt',
    );
    assert.equal(interactions.buildDropInsertion({ paths: [], text: 'hello' }), 'hello');
    assert.equal(interactions.buildDropInsertion({}), '');
});

test('acceptsTextDrop allows text into editable fields only', () => {
    const { acceptsTextDrop } = interactions;

    assert.equal(acceptsTextDrop({ tagName: 'TEXTAREA' }, ['text/plain']), true);
    assert.equal(acceptsTextDrop({ tagName: 'INPUT', type: 'text' }, ['text/plain']), true);
    assert.equal(acceptsTextDrop({ tagName: 'INPUT', type: 'search' }, ['text/plain']), true);
    assert.equal(acceptsTextDrop({ tagName: 'DIV', isContentEditable: true }, ['text/plain']), true);

    assert.equal(acceptsTextDrop({ tagName: 'DIV' }, ['text/plain']), false);
    assert.equal(acceptsTextDrop({ tagName: 'INPUT', type: 'checkbox' }, ['text/plain']), false);
    assert.equal(acceptsTextDrop({ tagName: 'TEXTAREA', readOnly: true }, ['text/plain']), false);
    assert.equal(acceptsTextDrop({ tagName: 'TEXTAREA', disabled: true }, ['text/plain']), false);
    assert.equal(acceptsTextDrop(null, ['text/plain']), false);
});

test('acceptsTextDrop refuses file drops even over editable fields', () => {
    const { acceptsTextDrop } = interactions;

    assert.equal(acceptsTextDrop({ tagName: 'TEXTAREA' }, ['Files']), false);
    assert.equal(acceptsTextDrop({ tagName: 'TEXTAREA' }, ['text/plain', 'Files']), false);
    assert.equal(
        acceptsTextDrop({ tagName: 'TEXTAREA' }, ['text/uri-list'], 'file:///tmp/a.txt'),
        false,
    );
    assert.equal(acceptsTextDrop({ tagName: 'TEXTAREA' }, undefined), true);
});

test('acceptsTextDrop allows URL drops into editable fields', () => {
    const { acceptsTextDrop } = interactions;

    assert.equal(
        acceptsTextDrop({ tagName: 'INPUT', type: 'text' }, ['text/uri-list', 'text/plain'], 'https://example.com'),
        true,
    );
    assert.equal(
        acceptsTextDrop({ tagName: 'DIV', isContentEditable: true }, ['text/uri-list'], 'https://example.com'),
        true,
    );
    assert.equal(
        acceptsTextDrop({ tagName: 'DIV' }, ['text/uri-list', 'text/plain'], 'https://example.com'),
        false,
    );
});

test('buildDropInsertion drops paths containing newlines', () => {
    assert.equal(interactions.buildDropInsertion({ paths: ['/tmp/evil\nrm -rf'], text: '' }), '');
    assert.equal(
        interactions.buildDropInsertion({ paths: ['/tmp/evil\nrm -rf'], text: '/tmp/evil\nrm -rf' }),
        '',
    );
});
