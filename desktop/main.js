/**
 * Cheatly Desktop — Main Process
 *
 * Creates an invisible overlay window that is excluded from screen capture.
 * Registers global hotkeys for triggering AI answers.
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

// When true, double-clicking anywhere on screen triggers an answer (mirrors the
// Chrome extension). Toggle with Ctrl+Shift+D.
let doubleClickEnabled = true;

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

  // Type the last answer into focused field
  globalShortcut.register("CommandOrControl+Shift+T", async () => {
    if (!lastAnswer) return;
    // Hide overlay so it doesn't interfere, wait a moment for focus
    overlayWindow.hide();
    await new Promise((r) => setTimeout(r, 200));
    const result = await typeAnswer(lastAnswer);
    overlayWindow.webContents.send("state", {
      type: "typed",
      method: result.method,
    });
    overlayWindow.show();
  });

  // Toggle double-click-to-answer mode
  globalShortcut.register("CommandOrControl+Shift+D", () => {
    doubleClickEnabled = !doubleClickEnabled;
    overlayWindow.show();
    overlayWindow.webContents.send("state", {
      type: "mode",
      doubleClick: doubleClickEnabled,
    });
  });

  // Quit the app entirely
  globalShortcut.register("CommandOrControl+Shift+Q", () => {
    app.isQuitting = true;
    app.quit();
  });
}

// ── Global Double-Click ──────────────────────────────────────────────────────

/**
 * Decide whether a global click should be ignored: while a query is running,
 * when double-click mode is off, or when the click lands on our own overlay.
 */
function shouldIgnoreClick(pos) {
  if (!doubleClickEnabled) return true;
  if (isQuerying) return true;
  if (overlayWindow && overlayWindow.isVisible()) {
    try {
      const b = screen.dipToScreenRect(overlayWindow, overlayWindow.getBounds());
      if (pos.x >= b.x && pos.x <= b.x + b.width && pos.y >= b.y && pos.y <= b.y + b.height) {
        return true;
      }
    } catch (_) {
      // If conversion fails, fall through and don't ignore.
    }
  }
  return false;
}

function registerDoubleClick() {
  const ok = startDoubleClickListener(() => {
    captureAndAnswer();
  }, shouldIgnoreClick);
  if (!ok) {
    console.error("Global double-click listener unavailable — use Ctrl+Shift+A instead.");
  }
}

// ── Core Logic ───────────────────────────────────────────────────────────────

async function captureAndAnswer() {
  if (isQuerying) return; // Prevent double-trigger
  isQuerying = true;

  let screenshotBase64 = null;

  try {
    // Ignore our own synthetic clicks (auto-fill) so they aren't read as a
    // user double-click.
    setSuppressed(true);

    // Hide overlay during capture to prevent it from appearing in screenshot
    // (content protection only works on Windows/macOS, not Linux)
    overlayWindow.hide();
    await new Promise((r) => setTimeout(r, 100));

    // Capture the screen
    screenshotBase64 = await captureScreen();

    // Now show overlay with loading state
    overlayWindow.show();
    overlayWindow.webContents.send("state", { type: "loading" });

    // Send to backend
    const answer = await queryBackend(screenshotBase64);

    // Store the answer and auto-copy to clipboard
    lastAnswer = answer;
    copyToClipboard(answer);

    // Display the answer
    overlayWindow.webContents.send("state", { type: "answer", answer, copied: true });

    // ── Auto-fill the answer ───────────────────────────────────────────────
    await autoFillAnswer(answer, screenshotBase64);
  } catch (err) {
    overlayWindow.webContents.send("state", {
      type: "error",
      message: err.message || "Failed to get answer",
    });
  } finally {
    isQuerying = false;
    setSuppressed(false);
  }
}

/**
 * Automatically fill the answer into the focused application.
 * - For MC answers: use CV-based radio button detection to click exact position
 * - For text answers: type into the focused field
 */
async function autoFillAnswer(answer, screenshotBase64) {
  try {
    if (isMCAnswer(answer)) {
      // Multiple choice — locate and click the correct option
      const cleanAnswer = stripQuotes(answer);
      overlayWindow.webContents.send("state", {
        type: "answer",
        answer,
        copied: true,
        status: "Clicking answer...",
      });

      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;

      const coords = await locateAnswer(screenshotBase64, cleanAnswer, width, height);
      console.log(`[LOCATE] Screen: ${width}x${height}, Answer: "${cleanAnswer}", Coords:`, coords);
      if (coords && coords.x && coords.y) {
        // Hide overlay so it doesn't intercept the click
        overlayWindow.hide();
        await new Promise((r) => setTimeout(r, 150));

        // Click the exact radio button position (detected by computer vision)
        const clicked = await clickAtPosition(coords.x, coords.y);

        // Show overlay again with result
        await new Promise((r) => setTimeout(r, 300));
        overlayWindow.show();
        overlayWindow.webContents.send("state", {
          type: "answer",
          answer,
          copied: true,
          status: clicked ? "Auto-clicked!" : "Click failed — answer copied",
        });
      } else {
        overlayWindow.webContents.send("state", {
          type: "answer",
          answer,
          copied: true,
          status: "Could not locate option — answer copied",
        });
      }
    } else {
      // Text answer — type it into the focused field
      overlayWindow.hide();
      await new Promise((r) => setTimeout(r, 200));

      const result = await typeAnswer(answer);

      await new Promise((r) => setTimeout(r, 200));
      overlayWindow.show();
      overlayWindow.webContents.send("state", {
        type: "answer",
        answer,
        copied: true,
        status: result.method === "typed" ? "Auto-typed!" : "Copied to clipboard",
      });
    }
  } catch (err) {
    // Auto-fill is best-effort — don't fail the whole flow
    console.error("Auto-fill error:", err.message);
    overlayWindow.webContents.send("state", {
      type: "answer",
      answer,
      copied: true,
      status: "Auto-fill failed — answer copied",
    });
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
  registerDoubleClick();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopDoubleClickListener();
});

app.on("window-all-closed", () => {
  // Don't quit when all windows are closed (we're a background app)
  if (process.platform !== "darwin") {
    // Actually do nothing — keep running
  }
});
