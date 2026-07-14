/**
 * Auto-fill module.
 *
 * Provides OS-level keyboard and mouse simulation to fill answers into
 * whatever application/field currently has focus.
 *
 * Modes:
 * 1. Click: moves mouse to coordinates and clicks (for MC radio/checkbox)
 * 2. Type-out: types the answer character-by-character via simulated keystrokes
 * 3. Clipboard: copies answer to clipboard as fallback
 */

const { clipboard } = require("electron");

let nutKeyboard = null;
let nutMouse = null;

async function getNut() {
  if (!nutKeyboard) {
    try {
      const nut = require("@nut-tree-fork/nut-js");
      nut.keyboard.config.autoDelayMs = 20;
      nutKeyboard = nut.keyboard;
      nutMouse = nut.mouse;
    } catch (err) {
      console.error("nut-js not available:", err.message);
      return { keyboard: null, mouse: null };
    }
  }
  return { keyboard: nutKeyboard, mouse: nutMouse };
}

/**
 * Copy the answer to clipboard. Always works, no native deps needed.
 */
function copyToClipboard(text) {
  clipboard.writeText(text);
}

/**
 * Type the answer into the currently focused field using OS-level keystrokes.
 */
async function typeAnswer(text) {
  const { keyboard: kb } = await getNut();
  if (!kb) {
    return { method: "unavailable", success: false };
  }

  try {
    await kb.type(text);
    return { method: "typed", success: true };
  } catch (err) {
    return { method: "unavailable", success: false, error: err.message };
  }
}

/**
 * Simulate Ctrl+V (paste from clipboard) in the currently focused app.
 */
async function simulatePaste() {
  const { keyboard: kb } = await getNut();
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

/**
 * Click at specific screen coordinates to select an MC option.
 * Returns true on success, false on failure.
 */
async function clickAtPosition(x, y) {
  const { mouse } = await getNut();
  if (!mouse) return false;

  try {
    const { Point } = require("@nut-tree-fork/nut-js");
    await mouse.setPosition(new Point(x, y));
    // Give the OS cursor a moment to reach the target before clicking.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await mouse.leftClick();
    return true;
  } catch (err) {
    console.error("Mouse click failed:", err.message);
    return false;
  }
}

/**
 * Strip surrounding quotes from AI response (GPT sometimes wraps in quotes).
 */
function stripQuotes(text) {
  const t = text.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Detect whether an answer looks like a multiple-choice selection.
 * MC answers are typically: "B", "A, C, E", "C. 2x + 2"
 */
function isMCAnswer(answer) {
  const trimmed = stripQuotes(answer);
  // Single letter
  if (/^[A-E]$/i.test(trimmed)) return true;
  // Letter with explanation: "B. something"
  if (/^[A-E][.)]\s/i.test(trimmed)) return true;
  // Multiple letters: "A, C, E" or "A,C,E"
  if (/^[A-E](\s*,\s*[A-E])+$/i.test(trimmed)) return true;
  return false;
}

module.exports = { copyToClipboard, typeAnswer, simulatePaste, clickAtPosition, isMCAnswer, stripQuotes };
