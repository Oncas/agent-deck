const { contextBridge, ipcRenderer, webUtils } = require("electron");

function sqlFormatterOptions(options) {
  if (!options || typeof options !== "object") return {};
  const out = {};
  ["language", "keywordCase", "tabWidth", "linesBetweenQueries"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(options, key)) out[key] = options[key];
  });
  return out;
}

contextBridge.exposeInMainWorld("electronOpenExternal", (url) => {
  return ipcRenderer.invoke("open-external", url);
});

contextBridge.exposeInMainWorld("electronGetPathForFile", (file) => {
  try {
    return webUtils.getPathForFile(file);
  } catch (_) {
    return "";
  }
});

contextBridge.exposeInMainWorld("electronOpenFolder", (folderPath) => {
  return ipcRenderer.invoke("open-folder", folderPath);
});

contextBridge.exposeInMainWorld("electronSelectFolder", (options) => {
  return ipcRenderer.invoke("select-folder", options && typeof options === "object" ? options : {});
});

contextBridge.exposeInMainWorld("electronSelectFile", (options) => {
  return ipcRenderer.invoke("select-file", options && typeof options === "object" ? options : {});
});

contextBridge.exposeInMainWorld("electronNotify", (payload) => {
  return ipcRenderer.invoke("show-notification", payload && typeof payload === "object" ? payload : {});
});

contextBridge.exposeInMainWorld("electronOnNotificationClick", (callback) => {
  if (typeof callback !== "function") return () => {};
  const handler = (_event, payload) => callback(payload || {});
  ipcRenderer.on("notification-click", handler);
  return () => ipcRenderer.removeListener("notification-click", handler);
});

contextBridge.exposeInMainWorld("electronClipboard", {
  readText: () => ipcRenderer.invoke("clipboard-read-text"),
  writeText: (text) => ipcRenderer.invoke("clipboard-write-text", typeof text === "string" ? text : ""),
});

contextBridge.exposeInMainWorld("sqlFormatter", {
  format: (sql, options) => ipcRenderer.invoke("sql-format", typeof sql === "string" ? sql : "", sqlFormatterOptions(options)),
});

contextBridge.exposeInMainWorld("electronShortcutInput", (callback) => {
  if (typeof callback !== "function") return () => {};
  const handler = (_event, input) => callback(input || {});
  ipcRenderer.on("shortcut-input", handler);
  return () => ipcRenderer.removeListener("shortcut-input", handler);
});

contextBridge.exposeInMainWorld("electronPlatform", process.platform);

contextBridge.exposeInMainWorld("electronWindowControl", (action) => {
  return ipcRenderer.invoke("window-control", action);
});

contextBridge.exposeInMainWorld("electronGetWindowState", () => {
  return ipcRenderer.invoke("window-state");
});

contextBridge.exposeInMainWorld("electronOnWindowState", (callback) => {
  if (typeof callback !== "function") return () => {};
  const handler = (_event, state) => callback(state || {});
  ipcRenderer.on("window-state", handler);
  return () => ipcRenderer.removeListener("window-state", handler);
});
