const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();
const staticDir = path.join(__dirname, '..', 'cmd', 'agentdeck', 'static');
const config = { scan_paths: ['/projects'], cli: 'claude', open_tabs: [], active_tab: '', tab_layouts: {}, workspaces: [] };
const requests = [];
let nextID = 0;

// Exercise the real HTML, app.js, xterm, and Monaco without launching AI CLIs.
const transportFixture = `
window.__workspaceTest = { sockets: [], errors: [] };
window.addEventListener('error', event => window.__workspaceTest.errors.push(event.message));
window.addEventListener('unhandledrejection', event => window.__workspaceTest.errors.push(String(event.reason)));
window.WebSocket = class {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
        this.url = url; this.readyState = 0;
        window.__workspaceTest.sockets.push(this);
        setTimeout(() => {
            if (this.readyState !== 0) return;
            this.readyState = 1;
            this.onopen?.({});
            this.onmessage?.({ data: JSON.stringify({ type: 'terminal-sync', cursor: 0, reset: false }) });
            this.onmessage?.({ data: new TextEncoder().encode('Shared AI session ready.\\r\\n').buffer });
        }, 0);
    }
    send() {}
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
};
`;

function json(res, value, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        const route = decodeURIComponent(url.pathname);
        let raw = '';
        for await (const part of req) raw += part;
        const body = raw ? JSON.parse(raw) : {};
        if (route.startsWith('/api/')) requests.push({ method: req.method, route, body });
        if (route === '/api/config') return json(res, config);
        if (route === '/api/tabs') { Object.assign(config, body); return json(res, {}); }
        if (route === '/api/themes') return json(res, [JSON.parse(fs.readFileSync(path.join(staticDir, 'themes/dark.json'), 'utf8'))]);
        if (route === '/api/projects') return json(res, ['a', 'b'].map(name => ({ name: 'org/' + name, path: '/projects/' + name })));
        if (route === '/api/badges') return json(res, { 'org/a': { dirty_count: 1 }, 'org/b': { dirty_count: 1 }, 'org/a@task': { dirty_count: 1 } });
        if (route === '/api/capabilities') return json(res, { dependencies: { claude: { available: true }, openai: { available: true } } });
        if (route === '/api/jobs' || route === '/api/skills') return json(res, []);
        if (route === '/api/workspaces' && req.method === 'POST') {
            const workspace = { ...body, id: 'test-' + ++nextID };
            config.workspaces.push(workspace);
            return json(res, workspace, 201);
        }
        const workspaceRoute = /^\/api\/workspaces\/([^/]+)(.*)$/.exec(route);
        if (workspaceRoute) {
            const [, id, action] = workspaceRoute;
            const workspace = config.workspaces.find(item => item.id === id);
            if (!workspace) return json(res, { error: 'workspace not found' }, 404);
            if (!action && req.method === 'PATCH') {
                Object.assign(workspace, body);
                if (!workspace.projects.includes(workspace.active_project)) workspace.active_project = workspace.projects[0] || '';
                return json(res, workspace);
            }
            if (!action && req.method === 'DELETE') {
                config.workspaces = config.workspaces.filter(item => item.id !== id);
                return json(res, {});
            }
            if (action === '/terminal/output') return json(res, { has_session: true, session_alive: true });
            return json(res, {});
        }
        const projectRoute = /^\/api\/projects\/(.+)\/(status|worktrees|file|pull)$/.exec(route);
        if (projectRoute) {
            const [, project, action] = projectRoute;
            if (action === 'worktrees') return json(res, project === 'org/a' ? [{ name: 'task', branch: 'task', path: '/projects/a--task' }] : []);
            if (action === 'status') return json(res, {
                is_git_repo: true, branch: project + '-branch', ahead: 0, behind: 0,
                files: [{ name: 'shared.txt', status: ' M', revision: project, revertible: true }], lines_added: 1, lines_deleted: 1,
            });
            if (action === 'file') return json(res, { original: 'old\n', modified: 'change in ' + project + '\n', kind: 'text' });
            return json(res, { output: 'Already up to date.' });
        }
        if (route.startsWith('/api/')) return json(res, {});
        const filename = path.join(staticDir, route === '/' ? 'index.html' : route);
        const contentType = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.ttf': 'font/ttf' }[path.extname(filename)] || 'application/octet-stream';
        let content = fs.readFileSync(filename);
        if (route === '/app.js') content = transportFixture + content.toString();
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    } catch (error) {
        res.writeHead(500);
        res.end(String(error));
    }
});

app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1440, height: 980, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
    const evaluate = code => window.webContents.executeJavaScript(code);
    const wait = async (expression, message = expression) => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            if (await evaluate(expression)) return;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Timed out: ' + message + '\nErrors: ' + JSON.stringify(await evaluate('window.__workspaceTest?.errors')));
    };
    const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const selectProject = name => evaluate(`(() => { const select = document.getElementById('workspace-project-select'); select.value = ${JSON.stringify(name)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const setTracked = projects => evaluate(`(() => { document.querySelectorAll('#workspace-project-choices input').forEach(input => { input.checked = ${JSON.stringify(projects)}.includes(input.value); input.dispatchEvent(new Event('change', { bubbles: true })); }); })()`);
    const socketCount = id => evaluate(`window.__workspaceTest.sockets.filter(socket => decodeURIComponent(socket.url).includes('/ws/workspace:' + ${JSON.stringify(id)})).length`);
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const url = 'http://127.0.0.1:' + server.address().port;
        await window.loadURL(url);
        await wait(`document.querySelector('.terminal-wrapper.active .terminal-provider-select')?.value === 'claude'`);
        await click('new-workspace-btn');
        await wait(`document.querySelector('#workspace-project-choices input[value="org/a@task"]')`);
        await evaluate(`document.getElementById('workspace-name').value = 'Checkout redesign'; document.getElementById('workspace-folder').value = '/projects';`);
        await setTracked(['org/a']);
        await click('workspace-save');
        await wait(`document.getElementById('workspace-project-select').value === 'org/a' && document.getElementById('workspace-modal').style.display === 'none' && document.querySelector('.workspace-tab.active')`);
        const first = config.workspaces[0].id;
        assert.equal(await socketCount(first), 1);

        await click('workspace-manage-btn');
        await setTracked(['org/a', 'org/b', 'org/a@task']);
        await click('workspace-save');
        await wait(`document.getElementById('workspace-project-select').options.length === 3`);
        await selectProject('org/b');
        await wait(`document.getElementById('git-content').dataset.project === 'org/b' && document.getElementById('git-branch-name')?.textContent.includes('org/b-branch')`);
        assert.equal(await socketCount(first), 1);
        assert.equal(requests.filter(request => request.route === '/api/workspaces/' + first + '/terminal/start').length, 1);
        await click('git-pull-btn');
        await wait(`document.querySelector('.toast') || document.getElementById('git-content').dataset.project === 'org/b'`);
        await evaluate(`document.querySelector('#git-content .git-file-name').click()`);
        await wait(`document.getElementById('diff-modal-body').querySelector('.monaco-diff-editor')`);
        assert.equal(await evaluate(`document.getElementById('diff-modal-title').textContent`), 'org/b / shared.txt');
        assert.ok(requests.some(request => request.route === '/api/projects/org/b/pull' && request.method === 'POST'));
        assert.ok(requests.some(request => request.route === '/api/projects/org/b/file'));
        await click('diff-modal-close');
        await selectProject('org/a@task');
        await wait(`document.getElementById('git-content').dataset.project === 'org/a@task'`);
        assert.equal(await socketCount(first), 1);

        await click('workspace-manage-btn');
        await setTracked([]);
        await click('workspace-save');
        await wait(`document.getElementById('workspace-project-select').disabled && document.getElementById('git-content').textContent.includes('Add projects')`);
        assert.equal(await socketCount(first), 1);
        await click('workspace-manage-btn');
        await setTracked(['org/a', 'org/b']);
        await click('workspace-save');
        await wait(`document.getElementById('workspace-project-select').options.length === 2`);
        await selectProject('org/b');

        await click('new-workspace-btn');
        await evaluate(`document.getElementById('workspace-name').value = 'API follow-up'; document.getElementById('workspace-folder').value = '/projects';`);
        await setTracked(['org/a']);
        await click('workspace-save');
        await wait(`document.querySelectorAll('.workspace-tab').length === 2`);
        const second = config.workspaces[1].id;
        await evaluate(`Array.from(document.querySelectorAll('.workspace-tab')).find(tab => tab.textContent.includes('Checkout redesign')).click()`);
        await wait(`document.getElementById('workspace-project-select').value === 'org/b'`);
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, bubbles: true }));`);
        assert.equal(await evaluate(`document.getElementById('agent-picker-modal').style.display`), 'none');
        await evaluate(`(() => { const select = document.querySelector('.terminal-wrapper.active .terminal-provider-select'); select.value = 'openai'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait(`document.querySelector('.terminal-wrapper.active .terminal-provider-select')?.value === 'openai' && !document.querySelector('.terminal-wrapper.active .terminal-provider-select')?.disabled`);
        assert.equal(await socketCount(first), 2);
        assert.equal(await socketCount(second), 1);
        assert.ok(requests.some(request => request.route === '/api/workspaces/' + first + '/terminal/stop'));
        await new Promise(resolve => setTimeout(resolve, 500)); // tab persistence is debounced
        await window.loadURL(url);
        await wait(`document.querySelectorAll('.workspace-tab').length === 2 && document.getElementById('workspace-project-select').value === 'org/b' && document.querySelector('.terminal-wrapper.active .terminal-provider-select')?.value === 'openai'`);
        const screenshot = await window.webContents.capturePage();
        fs.writeFileSync(path.join(os.tmpdir(), 'agentdeck-workspaces.png'), screenshot.toPNG());
        await click('workspace-manage-btn');
        await click('workspace-delete');
        await wait(`document.getElementById('app-dialog-modal').style.display !== 'none'`);
        await click('app-dialog-confirm');
        await wait(`document.querySelectorAll('.workspace-tab').length === 1 && document.querySelectorAll('.workspace-item').length === 1`);
        assert.equal(config.workspaces[0].id, second);
        await evaluate(`Array.from(document.querySelectorAll('.terminal-tab')).find(tab => tab.querySelector('.tab-label').textContent === 'org/a').click()`);
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, bubbles: true }));`);
        await wait(`document.getElementById('agent-picker-modal').style.display === 'flex'`);
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));`);
        await wait(`document.getElementById('terminal-container').classList.contains('split-layout') && document.querySelectorAll('.terminal-wrapper.active').length === 2`);
        await evaluate(`document.querySelector('.workspace-tab').click()`);
        await wait(`!document.getElementById('terminal-container').classList.contains('split-layout') && document.querySelectorAll('.terminal-wrapper.active').length === 1`);
        assert.deepEqual(await evaluate('window.__workspaceTest.errors'), []);
        process.stdout.write('WORKSPACE_BROWSER_RESULT ok\n');
        server.close();
        app.exit(0);
    } catch (error) {
        process.stderr.write(String(error.stack || error) + '\n');
        server.close();
        app.exit(1);
    }
});
