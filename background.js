/**
 * AnswerSnap — Background Service Worker
 *
 * Handles:
 * 1. Screenshot capture via chrome.tabs.captureVisibleTab
 * 2. Backend API call for AI-powered answers
 * 3. Message routing between content script and popup
 */

const API_BASE_URL = "https://answersnap.onrender.com";

const DEFAULT_SETTINGS = {
  enabled: true,
  displayMode: "homework", // "invisible" | "sneaky" | "homework"
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSettings() {
  const result = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...result.settings };
}

const MAX_SCREENSHOT_WIDTH = 1280;
const JPEG_QUALITY = 0.5;

async function captureScreenshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "jpeg",
    quality: 50,
  });

  return resizeScreenshot(dataUrl);
}

async function resizeScreenshot(dataUrl) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);

  if (bitmap.width <= MAX_SCREENSHOT_WIDTH) {
    bitmap.close();
    return dataUrl;
  }

  const scale = MAX_SCREENSHOT_WIDTH / bitmap.width;
  const width = MAX_SCREENSHOT_WIDTH;
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const resizedBlob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: JPEG_QUALITY,
  });

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(resizedBlob);
  });
}

async function queryBackend(screenshotDataUrl, selectedText) {
  const response = await fetch(`${API_BASE_URL}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      screenshot: screenshotDataUrl,
      selectedText: selectedText || "",
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Server error: ${response.status}`);
  }

  return await response.json();
}

// ── Message Handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CAPTURE_SCREENSHOT") {
    captureScreenshot().then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (message.type === "ANSWER_REQUEST") {
    handleAnswerRequest(message, sendResponse);
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    chrome.storage.local.set({ settings: message.settings }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function handleAnswerRequest(message, sendResponse) {
  try {
    const settings = await getSettings();

    if (!settings.enabled) {
      sendResponse({ error: "AnswerSnap is disabled." });
      return;
    }

    const screenshot = message.screenshot || await captureScreenshot();
    const result = await queryBackend(screenshot, message.selectedText);

    sendResponse({
      answer: result.answer,
      type: result.type,
      letter: result.letter,
      letters: result.letters,
      answerText: result.answerText,
      displayMode: settings.displayMode,
    });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

// ── Keyboard Shortcut ───────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-extension") {
    const settings = await getSettings();
    settings.enabled = !settings.enabled;
    await chrome.storage.local.set({ settings });

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "TOGGLE_STATE",
        enabled: settings.enabled,
      });
    }
  }
});
