// Launch the actual release artifact on an X display (xvfb-run in CI).
// Node 22+ supplies fetch and WebSocket; no test dependencies are packaged.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const [artifact, expectedVersion] = process.argv.slice(2);
if (!artifact || !expectedVersion || process.platform !== 'linux') {
    throw new Error('Usage on Linux: node scripts/appimage-smoke.mjs APPIMAGE VERSION');
}
const sourceImage = await realpath(artifact);
const workDir = await mkdtemp(path.join(tmpdir(), 'agentdeck-smoke-'));
let child;
let socket;
let startupError;
let exited = false;
let output = '';

async function retry(check) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        if (startupError) throw startupError;
        if (exited) throw new Error('AppImage exited before the smoke test finished');
        const result = await check();
        if (result) return result;
        await delay(250);
    }
    throw new Error('Timed out waiting for the packaged app');
}

try {
    const home = path.join(workDir, 'home');
    const runtime = path.join(workDir, 'runtime');
    await mkdir(home, { mode: 0o700 });
    await mkdir(runtime, { mode: 0o700 });
    const downloads = path.join(workDir, 'downloads');
    await mkdir(downloads);
    const appImage = path.join(downloads, path.basename(sourceImage));
    // Keep legacy-config migration away from the source image's parent folder.
    await copyFile(sourceImage, appImage);
    await chmod(appImage, 0o700);
    const env = {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_DATA_HOME: path.join(home, '.local', 'share'),
        XDG_CACHE_HOME: path.join(home, '.cache'),
        XDG_RUNTIME_DIR: runtime,
        TMPDIR: workDir,
        SHELL: '/bin/bash',
    };
    for (const key of ['APPIMAGE', 'APPDIR', 'AGENTDECK_DEV', 'ELECTRON_RUN_AS_NODE']) delete env[key];
    child = spawn(appImage, [
        '--appimage-extract-and-run', // CI does not need a FUSE mount.
        '--no-sandbox', '--ozone-platform=x11', '--disable-gpu',
        '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    ], { cwd: workDir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', error => { startupError = error; });
    child.on('exit', () => { exited = true; });
    for (const stream of [child.stdout, child.stderr]) {
        createInterface({ input: stream }).on('line', line => {
            // The AppImage runtime lists every extracted file; retain app logs.
            if (line.startsWith(`${workDir}/appimage_extracted_`)) return;
            output = (output + line + '\n').slice(-65536);
            process.stderr.write(line + '\n');
        });
    }

    const port = await retry(() => output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1]);
    const target = await retry(async () => {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
            const targets = await response.json();
            return targets.find(item => item.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(item.url));
        } catch {
            return null;
        }
    });
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('DevTools connection timed out')), 10000);
        socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('DevTools connection failed')); }, { once: true });
    });

    let commandId = 0;
    const pending = new Map();
    const rendererErrors = [];
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') {
            rendererErrors.push(message.params.exceptionDetails);
        }
        if (pending.has(message.id)) {
            const { resolve, reject, timeout } = pending.get(message.id);
            pending.delete(message.id);
            clearTimeout(timeout);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result);
        }
    });
    function command(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++commandId;
            const timeout = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`DevTools command timed out: ${method}`));
            }, 10000);
            pending.set(id, { resolve, reject, timeout });
            socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async function evaluate(expression) {
        const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
        return response.result.value;
    }

    await command('Runtime.enable');
    // Reload with exception reporting enabled so startup failures are captured.
    await command('Page.reload', { ignoreCache: true });
    await retry(() => evaluate(`document.readyState === 'complete' &&
        document.getElementById('setup-overlay')?.style.display === 'flex'`));
    const result = await evaluate(`(async () => {
        const build = await (await fetch('/api/build')).json();
        const projects = await (await fetch('/api/projects')).json();
        const assets = await Promise.all([
            '/vendor/monaco-editor/min/vs/loader.js',
            '/vendor/sql-formatter/sql-formatter.min.js',
            '/vendor/xterm/xterm.js'
        ].map(async url => ({ url, status: (await fetch(url)).status })));
        const formatted = await window.sqlFormatter.format('select 1', { keywordCase: 'upper' });
        return { build, projects, assets, formatted, platform: window.electronPlatform };
    })()`);
    assert.equal(result.build.version, expectedVersion, 'Go backend version must match the release tag');
    assert.equal(result.platform, 'linux', 'Packaged preload bridge must load');
    assert.deepEqual(result.projects, [], 'Fresh settings must not load real projects');
    assert.match(result.formatted, /SELECT/, 'Packaged SQL formatter must work through IPC');
    for (const asset of result.assets) assert.equal(asset.status, 200, `Missing packaged asset: ${asset.url}`);
    assert.deepEqual(rendererErrors, [], 'Renderer must start without uncaught exceptions');
    assert.equal(exited, false, 'App must stay running');
    await evaluate("setTimeout(() => window.electronWindowControl('close'), 100); true");
    for (let attempt = 0; attempt < 50 && !exited; attempt++) await delay(100);
    assert.equal(exited, true, 'App must close normally');
    assert.equal(child.exitCode, 0, 'App must exit successfully');
    console.log(`AppImage smoke test passed: ${expectedVersion} (window, setup, backend, preload, assets, SQL formatter, shutdown)`);
} finally {
    if (!exited && socket?.readyState === WebSocket.OPEN) {
        // Also try normal shutdown when an assertion failed.
        socket.send(JSON.stringify({ id: 999999, method: 'Runtime.evaluate',
            params: { expression: "window.electronWindowControl('close')" } }));
        for (let attempt = 0; attempt < 50 && !exited; attempt++) await delay(100);
    }
    socket?.close();
    if (child?.pid) {
        // Kill the process group, including the extraction runtime and Go child.
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        await delay(500);
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await rm(workDir, { recursive: true, force: true });
}
