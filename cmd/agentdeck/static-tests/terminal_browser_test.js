const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..', '..', '..');
const electronBinary = path.join(
    repoRoot,
    'electron',
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron',
);
const runner = path.join(repoRoot, 'electron', 'terminal_browser_test_runner.js');

test('real xterm keeps output, viewport, and reconnect cursor synchronized', { timeout: 60000 }, async t => {
    if (!fs.existsSync(electronBinary)) {
        t.skip('Electron is not installed; run npm install in electron/');
        return;
    }

    const result = await new Promise((resolve, reject) => {
        const child = spawn(electronBinary, ['--no-sandbox', '--headless', runner], {
            cwd: repoRoot,
            env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(`Electron terminal regression failed (${code})\n${stdout}\n${stderr}`));
                return;
            }
            const marker = stdout.split(/\r?\n/).find(line => line.startsWith('TERMINAL_BROWSER_RESULT '));
            if (!marker) {
                reject(new Error(`Electron terminal regression returned no result\n${stdout}\n${stderr}`));
                return;
            }
            resolve(JSON.parse(marker.slice('TERMINAL_BROWSER_RESULT '.length)));
        });
    });

    assert.ok(result.firstBytes > 512 * 1024);
    assert.ok(result.finalCursor > result.firstBytes);
    assert.ok(result.cols > 0);
    assert.ok(result.rows > 0);
});
