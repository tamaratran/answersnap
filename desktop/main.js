/**
 * AnswerSnap Desktop — Main Process
 *
 * A screenshot-based AI study assistant that works outside the browser.
 * The overlay is hidden by default and only shown when the user explicitly
 * asks for it.
 */

const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
const path = require("path");
const { captureScreen } = require("./lib/capture");
const { queryBackend, locateAnswer } = require("./lib/backend");
const { copyToClipboard, typeAnswer, clickAtPosition, isMCAnswer, stripQuotes } = require("./lib/autofill");
const { startDoubleClickListener, stopDoubleClickListener, setSuppressed } = require("./lib/dblclick");

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let overlayWindow = null;
let isQuerying = false;
let lastAnswer = "";

// When true, double-clicking anywhere on screen triggers an answer. Toggle with
// Ctrl+Shift+D.
let doubleClickEnabled = true;

// ── App Configuration ────────────────────────────────────────────────────────

if (process.platform === "darwin") {
  app.dock.hide();
}

// ── Windows ──────────────────────────────────────────────────────────────────

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 380,
    height: 260,
    x: screenWidth - 400,
    y: 20,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: "#0f0f19",
    alwaysOnTop: false,
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

  // Content protection hides the overlay's own UI from screen-recording apps
  // the user may be running (e.g. OBS, video calls). It is not an anti-proctor
  // mechanism.
  overlayWindow.setContentProtection(true);

  // On Linux, showing once during the initial ready-to-show event makes later
  // show() calls work reliably; immediately hide it so it never appears on
  // startup.
  overlayWindow.once("ready-to-show", () => {
    overlayWindow.show();
    overlayWindow.hide();
  });

  overlayWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      hideOverlay();
    }
  });

  overlayWindow.loadFile(path.join(__dirname, "renderer", "overlay.html"));
}

function showOverlay() {
  if (!overlayWindow) return;
  overlayWindow.show();
  overlayWindow.setAlwaysOnTop(true);
  overlayWindow.focus();
  overlayWindow.setVisibleOnAllWorkspaces(true);
}

function hideOverlay() {
  if (!overlayWindow) return;
  overlayWindow.setAlwaysOnTop(false);
  overlayWindow.hide();
}

// ── Hotkeys ──────────────────────────────────────────────────────────────────

function registerHotkeys() {
  // Capture screen + get answer
  globalShortcut.register("CommandOrControl+Shift+A", async () => {
    await captureAndAnswer();
  });

  // Show/hide the overlay on demand
  globalShortcut.register("CommandOrControl+Shift+H", () => {
    if (!overlayWindow) return;
    if (overlayWindow.isVisible()) {
      hideOverlay();
    } else {
      showOverlay();
    }
  });

  // Copy the last answer to clipboard manually (do not show the overlay)
  globalShortcut.register("CommandOrControl+Shift+C", () => {
    if (!lastAnswer) return;
    copyToClipboard(lastAnswer);
    if (overlayWindow) {
      overlayWindow.webContents.send("state", {
        type: "copied",
        status: "Copied to clipboard",
      });
    }
  });

  // Type the last answer into the focused field
  globalShortcut.register("CommandOrControl+Shift+T", async () => {
    if (!lastAnswer) return;
    hideOverlay();
    await new Promise((r) => setTimeout(r, 200));
    const result = await typeAnswer(lastAnswer);
    if (overlayWindow) {
      overlayWindow.webContents.send("state", {
        type: "typed",
        method: result.method,
      });
    }
  });

  // Toggle double-click-to-answer mode
  globalShortcut.register("CommandOrControl+Shift+D", () => {
    doubleClickEnabled = !doubleClickEnabled;
    if (overlayWindow) {
      overlayWindow.webContents.send("state", {
        type: "mode",
        doubleClick: doubleClickEnabled,
      });
    }
  });

  // Hide overlay
  globalShortcut.register("CommandOrControl+Shift+E", () => {
    hideOverlay();
  });

  // Quit the app
  globalShortcut.register("CommandOrControl+Shift+Q", () => {
    app.isQuitting = true;
    app.quit();
  });
}

// ── Global Double-Click ──────────────────────────────────────────────────────

function shouldIgnoreClick(pos) {
  if (!doubleClickEnabled) return true;
  if (isQuerying) return true;
  if (overlayWindow && overlayWindow.isVisible()) {
    try {
      const b = screen.dipToScreenRect(overlayWindow, overlayWindow.getBounds());
      if (
        pos.x >= b.x &&
        pos.x <= b.x + b.width &&
        pos.y >= b.y &&
        pos.y <= b.y + b.height
      ) {
        return true;
      }
    } catch (_) {
      // ignore
    }
  }
  return false;
}

function registerDoubleClick() {
  const ok = startDoubleClickListener((pos) => {
    captureAndAnswer(pos);
  }, shouldIgnoreClick);
  if (!ok) {
    console.error("Global double-click listener unavailable — use Ctrl+Shift+A instead.");
  }
}

// ── Core Logic ─────────────────────────────────────────────────────────────────

async function captureAndAnswer({ x = -1, y = -1 } = {}) {
  const clickX = x;
  const clickY = y;
  if (isQuerying) return;
  isQuerying = true;

  let screenshotBase64 = null;

  try {
    setSuppressed(true);
    hideOverlay();
    await new Promise((r) => setTimeout(r, 100));

    screenshotBase64 = await captureScreen();
    const { answer, optionIndex } = await queryBackend(screenshotBase64, "", clickX, clickY);

    lastAnswer = answer;

    if (overlayWindow) {
      overlayWindow.webContents.send("state", {
        type: "answer",
        answer,
        status: "Answer ready",
      });
    }

    await autoFillAnswer(answer, optionIndex, screenshotBase64, clickX, clickY);
  } catch (err) {
    if (overlayWindow) {
      overlayWindow.webContents.send("state", {
        type: "error",
        message: err.message || "Failed to get answer",
      });
    }
  } finally {
    isQuerying = false;
    setSuppressed(false);
  }
}

async function autoFillAnswer(answer, optionIndex, screenshotBase64, clickX = -1, clickY = -1) {
  try {
    if (optionIndex > 0 || isMCAnswer(answer)) {
      const cleanAnswer = stripQuotes(answer);
      if (overlayWindow) {
        overlayWindow.webContents.send("state", {
          type: "answer",
          answer,
          status: "Locating option...",
        });
      }

      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;

      const coords = await locateAnswer(screenshotBase64, cleanAnswer, width, height, optionIndex, clickX, clickY);
      console.log(`[LOCATE] Screen: ${width}x${height}, Answer: "${cleanAnswer}", OptionIndex: ${optionIndex}, Coords:`, coords);

      if (coords && coords.x && coords.y) {
        hideOverlay();
        await new Promise((r) => setTimeout(r, 150));

        const clicked = await clickAtPosition(coords.x, coords.y);
        if (overlayWindow) {
          overlayWindow.webContents.send("state", {
            type: "answer",
            answer,
            status: clicked ? "Auto-clicked!" : "Click failed — answer ready",
          });
        }
      } else if (overlayWindow) {
        overlayWindow.webContents.send("state", {
          type: "answer",
          answer,
          status: "Could not locate option — answer ready",
        });
      }
    } else {
      hideOverlay();
      await new Promise((r) => setTimeout(r, 200));

      const result = await typeAnswer(answer);
      if (overlayWindow) {
        overlayWindow.webContents.send("state", {
          type: "answer",
          answer,
          status: result.method === "typed" ? "Auto-typed!" : "Type unavailable — press Ctrl+Shift+C to copy",
        });
      }
    }
  } catch (err) {
    console.error("Auto-fill error:", err.message);
    if (overlayWindow) {
      overlayWindow.webContents.send("state", {
        type: "answer",
        answer,
        status: "Auto-fill failed — press Ctrl+Shift+C to copy",
      });
    }
  }
}

// ── IPC Handlers ───────────────────────────────────────────────────────────────

ipcMain.on("hide-overlay", () => {
  hideOverlay();
});

ipcMain.on("set-ignore-mouse", (_event, ignore) => {
  if (!overlayWindow) return;
  if (ignore) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    overlayWindow.setIgnoreMouseEvents(false);
  }
});

// ── App Lifecycle ──────────────────────────────────────────────────────────────

function initApp() {
  createOverlayWindow();
  registerHotkeys();
  registerDoubleClick();
}

app.whenReady().then(() => {
  initApp();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopDoubleClickListener();
});

app.on("window-all-closed", () => {
  // Keep the app running as a background helper while the user is studying.
});
