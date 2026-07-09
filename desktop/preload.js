/**
 * AnswerSnap Desktop — Preload Script
 *
 * Exposes a safe IPC bridge between the renderer and main process.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cheatly", {
  onState: (callback) => {
    ipcRenderer.on("state", (_event, data) => callback(data));
  },
  hideOverlay: () => {
    ipcRenderer.send("hide-overlay");
  },
  setIgnoreMouse: (ignore) => {
    ipcRenderer.send("set-ignore-mouse", ignore);
  },
});
