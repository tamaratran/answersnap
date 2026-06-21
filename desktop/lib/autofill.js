/**
 * Auto-fill module.
 *
 * Provides OS-level keyboard simulation to type answers into
 * whatever application/field currently has focus.
 *
 * Two modes:
 * 1. Clipboard (default): copies answer to clipboard — user pastes manually or
 *    we simulate Ctrl+V
 * 2. Type-out: types the answer character-by-character via simulated keystrokes
 */

const { clipboard } = require("electron");

let nutKeyboard = null;

async function getNutKeyboard() {
  if (!nutKeyboard) {
    try {
      const { keyboard } = require("@nut-tree-fork/nut-js");
      keyboard.config.autoDelayMs = 20; // Fast but not instant
      nutKeyboard = keyboard;
    } catch (err) {
      console.error("nut-js not available for typing simulation:", err.message);
      return null;
    }
  }
  return nutKeyboard;
}

/**
 * Copy the answer to clipboard. Always works, no native deps needed.
 */
function copyToClipboard(text) {
  clipboard.writeText(text);
}

/**
 * Type the answer into the currently focused field using OS-level keystrokes.
 * Falls back to clipboard copy if nut-js is not available.
 */
async function typeAnswer(text) {
  const kb = await getNutKeyboard();
  if (!kb) {
    // Fallback: just copy to clipboard
    copyToClipboard(text);
    return { method: "clipboard", success: true };
  }

  try {
    await kb.type(text);
    return { method: "typed", success: true };
  } catch (err) {
    // Fallback to clipboard on error
    copyToClipboard(text);
    return { method: "clipboard", success: true, fallback: true, error: err.message };
  }
}

/**
 * Simulate Ctrl+V (paste from clipboard) in the currently focused app.
 */
async function simulatePaste() {
  const kb = await getNutKeyboard();
  if (!kb) return false;

  try {
    const { Key } = require("@nut-tree-fork/nut-js");
    await kb.pressKey(Key.LeftControl);
    await kb.pressKey(Key.V);
    await kb.releaseKey(Key.V);
    await kb.releaseKey(Key.LeftControl);
    return true;
  } catch (err) {
    console.error("Paste simulation failed:", err.message);
    return false;
  }
}

module.exports = { copyToClipboard, typeAnswer, simulatePaste };
