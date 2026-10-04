const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
    const window = new BrowserWindow({
        show: false,
        width: 800,
        height: 420,
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    try {
        const fixture = path.join(__dirname, '..', 'cmd', 'agentdeck', 'static-tests', 'testdata', 'terminal_browser_fixture.html');
        await window.loadFile(fixture);
        const result = await window.webContents.executeJavaScript('window.runTerminalBrowserTests()');
        process.stdout.write(`TERMINAL_BROWSER_RESULT ${JSON.stringify(result)}\n`);
        app.exit(0);
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
        app.exit(1);
    }
});
