/**
 * AnswerSnap — Background Service Worker
 *
 * Handles:
 * 1. Screenshot capture via chrome.tabs.captureVisibleTab
 * 2. AI vision API call (OpenAI GPT-4o)
 * 3. Message routing between content script and popup
 */

const BACKEND_URL = "https://answersnap-backend.fly.dev";

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
  const response = await fetch(`${BACKEND_URL}/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      screenshot: screenshotDataUrl,
      selectedText: selectedText || "",
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      err.detail || `Backend error: ${response.status} — ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.answer || "No answer returned.";
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
    const answer = await queryBackend(screenshot, message.selectedText);

    sendResponse({ answer, displayMode: settings.displayMode });
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
