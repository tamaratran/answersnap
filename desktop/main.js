/**
 * Cheatly Desktop — Main Process
 *
 * Creates an invisible overlay window that is excluded from screen capture.
 * Registers global hotkeys for triggering AI answers.
 */

const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
const path = require("path");
const { captureScreen } = require("./lib/capture");
const { queryBackend } = require("./lib/backend");

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let overlayWindow = null;
let isQuerying = false;

// ── App Configuration ────────────────────────────────────────────────────────

// Hide from dock on macOS
if (process.platform === "darwin") {
  app.dock.hide();
}

// ── Window Creation ──────────────────────────────────────────────────────────

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 380,
    height: 260,
    x: screenWidth - 400, // Bottom-right corner
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // THE KEY LINE — makes window invisible to all screen capture/recording
  overlayWindow.setContentProtection(true);

  // Don't appear in Alt+Tab
  overlayWindow.setSkipTaskbar(true);

  // Start hidden
  overlayWindow.hide();

  // Prevent the window from being closed, just hide it
  overlayWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      overlayWindow.hide();
    }
  });

  overlayWindow.loadFile(path.join(__dirname, "renderer", "overlay.html"));
}

// ── Hotkey Registration ──────────────────────────────────────────────────────

function registerHotkeys() {
  // Main action: capture screen + get AI answer
  globalShortcut.register("CommandOrControl+Shift+A", async () => {
    await captureAndAnswer();
  });

  // Toggle overlay visibility
  globalShortcut.register("CommandOrControl+Shift+H", () => {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();
    }
  });

  // Emergency hide — instant vanish
  globalShortcut.register("CommandOrControl+Shift+E", () => {
    overlayWindow.hide();
  });

  // Quit the app entirely
  globalShortcut.register("CommandOrControl+Shift+Q", () => {
    app.isQuitting = true;
    app.quit();
  });
}

// ── Core Logic ───────────────────────────────────────────────────────────────

async function captureAndAnswer() {
  if (isQuerying) return; // Prevent double-trigger
  isQuerying = true;

  try {
    // Show overlay with loading state
    overlayWindow.show();
    overlayWindow.webContents.send("state", { type: "loading" });

    // Capture the screen (overlay is automatically excluded due to content protection)
    const screenshotBase64 = await captureScreen();

    // Send to backend
    const answer = await queryBackend(screenshotBase64);

    // Display the answer
    overlayWindow.webContents.send("state", { type: "answer", answer });
  } catch (err) {
    overlayWindow.webContents.send("state", {
      type: "error",
      message: err.message || "Failed to get answer",
    });
  } finally {
    isQuerying = false;
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.on("hide-overlay", () => {
  overlayWindow.hide();
});

ipcMain.on("set-ignore-mouse", (_event, ignore) => {
  if (ignore) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    overlayWindow.setIgnoreMouseEvents(false);
  }
});

// ── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createOverlayWindow();
  registerHotkeys();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Don't quit when all windows are closed (we're a background app)
  if (process.platform !== "darwin") {
    // Actually do nothing — keep running
  }
});
