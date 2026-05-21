/**
 * AnswerSnap — Background Service Worker
 *
 * Handles:
 * 1. Screenshot capture via chrome.tabs.captureVisibleTab
 * 2. Backend API call for AI-powered answers
 * 3. Message routing between content script and popup
 */

const API_BASE_URL = "https://44a940115329-tunnel-ktznozzt.devinapps.com";
const API_AUTH = "Basic " + btoa("user:be68d497b75fa20a5357ef2d5ac88d1d");

const DEFAULT_SETTINGS = {
  enabled: true,
  displayMode: "homework", // "invisible" | "sneaky" | "homework"
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSettings() {
  const result = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...result.settings };
}

async function captureScreenshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
    quality: 90,
  });
  return dataUrl;
}

async function queryBackend(screenshotDataUrl, selectedText) {
  const response = await fetch(`${API_BASE_URL}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": API_AUTH },
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
