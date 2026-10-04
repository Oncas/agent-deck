const { app, BrowserWindow, Menu, shell, ipcMain, clipboard, dialog, powerSaveBlocker, Notification } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const http = require("http");
const os = require("os");
const path = require("path");

let sqlFormatter = null;

function formatSQL(sql, options) {
  if (!sqlFormatter) {
    sqlFormatter = require("sql-formatter");
  }
  return sqlFormatter.format(typeof sql === "string" ? sql : "", options && typeof options === "object" ? options : {});
}

function openUrlWithSystemBrowser(url) {
  return new Promise((resolve, reject) => {
    let command;
    let args;

    if (process.platform === "darwin") {
      command = "open";
      args = [url];
    } else if (process.platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    const child = spawn(command, args, {
      detached: false,
      stdio: "ignore",
    });

    child.on("error", (err) => {
      console.error(`System browser fallback failed for: ${url}`, err);
      reject(err);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function openFolderWithSystemFileManager(folderPath) {
  return new Promise((resolve, reject) => {
    let command;
    let args;
    let allowNonZeroExit = false;

    if (process.platform === "darwin") {
      command = "open";
      args = [folderPath];
    } else if (process.platform === "win32") {
      command = "explorer.exe";
      args = [folderPath];
      // explorer.exe may return non-zero even when it successfully opens a folder.
      allowNonZeroExit = true;
    } else {
      command = "xdg-open";
      args = [folderPath];
    }

    const child = spawn(command, args, {
      detached: false,
      stdio: "ignore",
    });

    child.on("error", (err) => {
      console.error(`System folder-open fallback failed for: ${folderPath}`, err);
      reject(err);
    });

    child.on("exit", (code) => {
      if (code === 0 || allowNonZeroExit) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function openUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    console.error(`Invalid external URL: ${url}`, err);
    return { ok: false, error: "Invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: `Unsupported protocol: ${parsed.protocol}` };
  }

  const safeUrl = parsed.toString();

  try {
    await shell.openExternal(safeUrl);
    return { ok: true };
  } catch (err) {
    console.error(`shell.openExternal failed for: ${url}`, err);
    try {
      await openUrlWithSystemBrowser(safeUrl);
      return { ok: true };
    } catch (fallbackErr) {
      console.error(`Fallback browser open failed for: ${url}`, fallbackErr);
      return {
        ok: false,
        error: fallbackErr && fallbackErr.message ? fallbackErr.message : "Unable to open external URL",
      };
    }
  }
}

async function openFolder(folderPath) {
  if (!folderPath || typeof folderPath !== "string") {
    return { ok: false, error: "Missing folder path" };
  }

  const trimmedPath = folderPath.trim();
  if (!trimmedPath) {
    return { ok: false, error: "Missing folder path" };
  }
  const safePath = path.resolve(trimmedPath);

  let stats;
  try {
    stats = fs.statSync(safePath);
  } catch (err) {
    console.error(`Folder does not exist: ${safePath}`, err);
    return { ok: false, error: "Folder does not exist" };
  }

  if (!stats.isDirectory()) {
    return { ok: false, error: "Path is not a folder" };
  }

  try {
    const shellError = await shell.openPath(safePath);
    if (!shellError) {
      return { ok: true };
    }
    console.error(`shell.openPath failed for: ${safePath}`, shellError);
    await openFolderWithSystemFileManager(safePath);
    return { ok: true };
  } catch (err) {
    console.error(`Failed to open folder: ${safePath}`, err);
    return {
      ok: false,
      error: err && err.message ? err.message : "Unable to open folder",
    };
  }
}

async function selectFolder(options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Window unavailable" };
  }

  const title = typeof options.title === "string" && options.title.trim()
    ? options.title.trim()
    : "Select folder";
  const defaultPath = typeof options.defaultPath === "string" && options.defaultPath.trim()
    ? path.resolve(options.defaultPath.trim())
    : undefined;

  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      defaultPath,
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: path.resolve(result.filePaths[0]) };
  } catch (err) {
    console.error("Folder selection failed", err);
    return {
      ok: false,
      error: err && err.message ? err.message : "Unable to select folder",
    };
  }
}

async function selectFile(options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: "Window unavailable" };
  }

  const title = typeof options.title === "string" && options.title.trim()
    ? options.title.trim()
    : "Select file";
  const defaultPath = typeof options.defaultPath === "string" && options.defaultPath.trim()
    ? path.resolve(options.defaultPath.trim())
    : undefined;

  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      defaultPath,
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: path.resolve(result.filePaths[0]) };
  } catch (err) {
    console.error("File selection failed", err);
    return {
      ok: false,
      error: err && err.message ? err.message : "Unable to select file",
    };
  }
}

function showNotification(payload = {}) {
  if (!Notification.isSupported()) {
    return { ok: false, error: "Notifications are not supported" };
  }

  const title = typeof payload.title === "string" && payload.title.trim()
    ? payload.title.trim()
    : app.name;
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const action = typeof payload.action === "string" ? payload.action : "";
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};

  const notification = new Notification({
    title,
    body,
    silent: Boolean(payload.silent),
  });
  notification.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("notification-click", { action, data });
  });
  notification.show();
  return { ok: true };
}

app.commandLine.appendSwitch("no-sandbox");
// Do not add --ozone-platform-hint here. Ozone picks its windowing backend
// during Chromium startup, before this file is evaluated, so appendSwitch is a
// no-op for it — verified: the switch never reaches the GPU process argv and
// the app stays an X11 client. The flag is passed on the launch command line
// instead (scripts/install-launcher.sh, scripts/electron-package.sh,
// scripts/electron-dev.sh, and the Makefile electron targets). "npm start" is
// deliberately not covered, so that path still runs under XWayland.
if (process.platform === "win32") {
  app.setAppUserModelId("AgentDeck");
}

let goProcess = null;
let mainWindow = null;
const SERVER_HOST = "127.0.0.1";

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, SERVER_HOST, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function waitForServer(port, retries = 50) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(`http://${SERVER_HOST}:${port}/api/projects`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else if (attempts < retries) {
          setTimeout(check, 200);
        } else {
          reject(new Error("Server did not become ready"));
        }
      });
      req.on("error", () => {
        if (attempts < retries) {
          setTimeout(check, 200);
        } else {
          reject(new Error("Server did not become ready"));
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
        if (attempts < retries) {
          setTimeout(check, 200);
        } else {
          reject(new Error("Server did not become ready"));
        }
      });
    };
    check();
  });
}

const POWER_POLL_INTERVAL_MS = 10000;

let powerPollTimer = null;
let powerBlockerId = null;

function fetchPowerState(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://${SERVER_HOST}:${port}/api/power`, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

// prevent-app-suspension keeps the system awake while still allowing the
// display to sleep and the screen to lock.
function applyPowerState(state) {
  const wanted = Boolean(state && state.inhibit);
  const held = powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId);

  if (wanted && !held) {
    powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    console.log(`Preventing system sleep (${state.reason || "agent active"})`);
    return;
  }
  if (!wanted && held) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
    console.log(`Allowing system sleep${state && state.reason ? ` (${state.reason})` : ""}`);
  }
}

function releasePowerBlocker() {
  if (powerPollTimer) {
    clearInterval(powerPollTimer);
    powerPollTimer = null;
  }
  if (powerBlockerId !== null) {
    if (powerSaveBlocker.isStarted(powerBlockerId)) {
      powerSaveBlocker.stop(powerBlockerId);
    }
    powerBlockerId = null;
  }
}

function startPowerPolling(port) {
  if (powerPollTimer) return;
  const poll = () => {
    fetchPowerState(port).then((state) => {
      if (state) applyPowerState(state);
    });
  };
  poll();
  powerPollTimer = setInterval(poll, POWER_POLL_INTERVAL_MS);
}

function xdgConfigHome() {
  // XDG spec: a relative XDG_CONFIG_HOME must be treated as unset.
  const value = process.env.XDG_CONFIG_HOME;
  if (value && path.isAbsolute(value)) {
    return value;
  }
  return path.join(os.homedir(), ".config");
}

// Earlier AppImage builds kept their state one level above the .AppImage file.
// Copy it into the XDG directory once, so upgrading keeps settings, database
// connections and saved queries. Copied rather than moved: for a ./dist/ build
// the old location is the repository root, which development builds still use.
const LEGACY_APPIMAGE_STATE = ["config.json", "databases.json", "saved-queries"];

function migrateLegacyAppImageState(legacyDir, configDir) {
  if (fs.existsSync(path.join(configDir, "config.json"))) {
    return;
  }
  if (!fs.existsSync(path.join(legacyDir, "config.json"))) {
    return;
  }
  for (const name of LEGACY_APPIMAGE_STATE) {
    const from = path.join(legacyDir, name);
    if (!fs.existsSync(from)) {
      continue;
    }
    try {
      fs.cpSync(from, path.join(configDir, name), { recursive: true, force: false });
    } catch (err) {
      console.error(`Failed to migrate ${from}:`, err);
    }
  }
}

function getConfigPath() {
  // When running as AppImage, APPIMAGE env var points to the .AppImage file.
  // Its state lives under ~/.config/agentdeck/ so it doesn't depend on where
  // the file sits, and a ./dist/ build never shares the repository's config
  // with a development build.
  const appImage = process.env.APPIMAGE;
  if (appImage) {
    const configDir = path.join(xdgConfigHome(), "agentdeck");
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    migrateLegacyAppImageState(path.join(path.dirname(appImage), ".."), configDir);
    return path.join(configDir, "config.json");
  }

  // On macOS, store in ~/Library/Application Support/<app>/ so config
  // survives app updates (the .app bundle is replaced on each install).
  if (process.platform === "darwin") {
    const userDataDir = app.getPath("userData");
    const userDataConfig = path.join(userDataDir, "config.json");

    // Migrate config from old location (inside the app bundle) if it exists
    // and hasn't been migrated yet.
    if (!fs.existsSync(userDataConfig)) {
      const oldConfig = path.join(__dirname, "..", "config.json");
      if (fs.existsSync(oldConfig)) {
        fs.mkdirSync(userDataDir, { recursive: true });
        fs.copyFileSync(oldConfig, userDataConfig);
      }
    }

    return userDataConfig;
  }

  // Linux (non-AppImage) / other: next to the electron dir.
  return path.join(__dirname, "..", "config.json");
}

function buildApplicationMenu() {
  if (process.platform !== "darwin") {
    return null;
  }

  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    },
  ]);
}

function isDevMode() {
  return process.argv.includes("--dev") || process.env.AGENTDECK_DEV === "1";
}

function appendAssetDirArg(args, flag, dir, requiredFile) {
  if (fs.existsSync(path.join(dir, requiredFile))) {
    args.push(flag, dir);
  }
}

async function startApp() {
  const port = await findFreePort();
  const binaryPath = path.join(__dirname, "agentdeck");
  const configPath = getConfigPath();
  const devMode = isDevMode();
  const monacoDir = path.join(__dirname, "node_modules", "monaco-editor", "min", "vs");
  const sqlFormatterDir = path.join(__dirname, "node_modules", "sql-formatter", "dist");
  const goArgs = [
    "--host", SERVER_HOST,
    "--port", String(port),
    "--config", configPath,
  ];
  appendAssetDirArg(goArgs, "--monaco-dir", monacoDir, "loader.js");
  appendAssetDirArg(goArgs, "--sql-formatter-dir", sqlFormatterDir, "sql-formatter.min.js");

  if (devMode) {
    goArgs.push("--dev-static-dir", path.join(__dirname, "..", "cmd", "agentdeck", "static"));
  }

  goProcess = spawn(binaryPath, goArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  goProcess.stdout.on("data", (data) => {
    process.stdout.write(data);
  });

  goProcess.stderr.on("data", (data) => {
    process.stderr.write(data);
  });

  goProcess.on("exit", (code) => {
    console.log(`Go process exited with code ${code}`);
    goProcess = null;
    releasePowerBlocker();
  });

  await waitForServer(port);

  startPowerPolling(port);

  // Keep Edit-role shortcuts on macOS; hide menu on other platforms.
  Menu.setApplicationMenu(buildApplicationMenu());

  ipcMain.handle("open-external", async (_event, url) => {
    if (!url || typeof url !== "string") {
      return { ok: false, error: "Missing URL" };
    }
    return openUrl(url.trim());
  });

  ipcMain.handle("open-folder", async (_event, folderPath) => {
    return openFolder(folderPath);
  });

  ipcMain.handle("select-folder", async (_event, options) => {
    return selectFolder(options && typeof options === "object" ? options : {});
  });

  ipcMain.handle("select-file", async (_event, options) => {
    return selectFile(options && typeof options === "object" ? options : {});
  });

  ipcMain.handle("show-notification", (_event, payload) => {
    return showNotification(payload && typeof payload === "object" ? payload : {});
  });

  ipcMain.handle("clipboard-read-text", () => {
    return clipboard.readText();
  });

  ipcMain.handle("clipboard-write-text", (_event, text) => {
    clipboard.writeText(typeof text === "string" ? text : "");
    return true;
  });

  ipcMain.handle("sql-format", (_event, sql, options) => {
    return formatSQL(sql, options);
  });

  ipcMain.handle("window-control", (_event, action) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "Window unavailable" };
    }
    switch (action) {
      case "minimize":
        mainWindow.minimize();
        break;
      case "toggle-maximize":
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
        break;
      case "close":
        mainWindow.close();
        return { ok: true };
      default:
        return { ok: false, error: "Unknown action" };
    }
    return { ok: true, maximized: mainWindow.isMaximized() };
  });

  ipcMain.handle("window-state", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "Window unavailable" };
    }
    return {
      ok: true,
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    };
  });

  const windowOptions = {
    width: 1400,
    height: 900,
    backgroundColor: "#1a1b26",
    webPreferences: {
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  };

  if (process.platform === "darwin") {
    // Keep native traffic-light buttons (top-left) while reusing our dark
    // title-bar row. trafficLightPosition centers the ~14px lights in the
    // 34px bar.
    windowOptions.titleBarStyle = "hiddenInset";
    windowOptions.trafficLightPosition = { x: 12, y: 10 };
  } else {
    // Linux/Windows: frameless window with our custom HTML window controls.
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (devMode) {
    await mainWindow.webContents.session.clearCache();
  }

  mainWindow.loadURL(`http://${SERVER_HOST}:${port}`);

  const appOrigin = `http://${SERVER_HOST}:${port}`;

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && url !== "about:blank" && !url.startsWith(appOrigin)) {
      void openUrl(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
      if (url && url !== "about:blank") {
        void openUrl(url);
      }
    }
  });

  mainWindow.webContents.on("new-window", (event, url) => {
    event.preventDefault();
    if (url && url !== "about:blank" && !url.startsWith(appOrigin)) {
      void openUrl(url);
    }
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isPrimaryModifier = process.platform === "darwin" ? input.meta : input.control;
    const key = typeof input.key === "string" ? input.key.toLowerCase() : "";

    if (input.type === "keyDown" && isPrimaryModifier && input.shift && key === "w") {
      event.preventDefault();
      mainWindow.webContents.send("shortcut-input", {
        key: input.key,
        code: input.code,
        ctrlKey: !!input.control,
        metaKey: !!input.meta,
        shiftKey: !!input.shift,
        altKey: !!input.alt,
        type: "keydown",
      });
    }
  });

  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("window-state", {
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    });
  };
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);
  mainWindow.webContents.on("did-finish-load", emitWindowState);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function killGoProcess() {
  releasePowerBlocker();
  if (goProcess) {
    goProcess.kill("SIGTERM");
    goProcess = null;
  }
}

app.on("ready", () => {
  startApp().catch((err) => {
    console.error("Failed to start:", err);
    killGoProcess();
    app.quit();
  });
});

app.on("window-all-closed", () => {
  killGoProcess();
  app.quit();
});

app.on("before-quit", () => {
  killGoProcess();
});
