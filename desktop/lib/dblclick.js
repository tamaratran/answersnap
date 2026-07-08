/**
 * Global double-click detection.
 *
 * Replicates the Chrome extension's "double-click any question to answer"
 * behaviour at the OS level. Uses uiohook-napi to listen for mouse clicks
 * anywhere on screen (in any application, including lockdown browsers) and
 * fires a callback when two clicks land close together in space and time.
 */

let uIOhook = null;
let Mouse = null;

function loadHook() {
  if (uIOhook) return true;
  try {
    const mod = require("uiohook-napi");
    uIOhook = mod.uIOhook;
    Mouse = mod.UiohookMouseButton || null;
    return true;
  } catch (err) {
    console.error("uiohook-napi not available:", err.message);
    return false;
  }
}

// Tuning: two clicks are a "double-click" when they happen within this many
// milliseconds and within this many pixels of each other.
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_RADIUS_PX = 8;

let started = false;
let suppressed = false;
let lastClick = { time: 0, x: 0, y: 0 };

/**
 * Start listening for global double-clicks.
 *
 * @param {(pos: {x: number, y: number}) => void} onDoubleClick
 *   Called with the screen coordinates of the second click.
 * @param {() => boolean} [shouldIgnore]
 *   Optional predicate. Return true to ignore the current click (e.g. when the
 *   click lands on our own overlay window, or a query is already in flight).
 * @returns {boolean} whether the listener was successfully started.
 */
function startDoubleClickListener(onDoubleClick, shouldIgnore) {
  if (started) return true;
  if (!loadHook()) return false;

  const handler = (e) => {
    // Only react to the primary (left) button.
    if (Mouse && e.button !== Mouse.Left) return;
    if (suppressed) return;

    const now = Date.now();
    const dt = now - lastClick.time;
    const dist = Math.hypot(e.x - lastClick.x, e.y - lastClick.y);

    const isDouble = dt <= DOUBLE_CLICK_MS && dist <= DOUBLE_CLICK_RADIUS_PX;

    // Reset so a triple-click doesn't fire twice.
    lastClick = { time: isDouble ? 0 : now, x: e.x, y: e.y };

    if (!isDouble) return;
    if (typeof shouldIgnore === "function" && shouldIgnore({ x: e.x, y: e.y })) return;

    onDoubleClick({ x: e.x, y: e.y });
  };

  uIOhook.on("click", handler);

  try {
    uIOhook.start();
    started = true;
    return true;
  } catch (err) {
    console.error("Failed to start uiohook:", err.message);
    return false;
  }
}

/**
 * Temporarily ignore clicks — used while the app performs its own synthetic
 * clicks (auto-fill) so they don't get interpreted as a user double-click.
 */
function setSuppressed(value) {
  suppressed = Boolean(value);
}

function stopDoubleClickListener() {
  if (!started || !uIOhook) return;
  try {
    uIOhook.stop();
  } catch (_) {
    // ignore
  }
  started = false;
}

module.exports = {
  startDoubleClickListener,
  stopDoubleClickListener,
  setSuppressed,
};
