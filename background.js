/**
 * Cheatly — Background Service Worker
 *
 * Handles:
 * 1. Screenshot capture via chrome.tabs.captureVisibleTab
 * 2. AI vision API call (OpenAI GPT-4o)
 * 3. Message routing between content script and popup
 */

const BACKEND_URL = "https://cheatly-backend.fly.dev";

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
    format: "jpeg",
    quality: 80,
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

// ── Port Handler (content script) ────────────────────────────────────────────
// Content script uses chrome.runtime.connect() which reliably wakes the
// service worker even after it goes inactive in MV3.

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "answersnap") return;

  port.onMessage.addListener((message) => {
    handlePortMessage(message, port);
  });
});

async function handlePortMessage(message, port) {
  try {
    if (message.type === "CAPTURE_SCREENSHOT") {
      const result = await captureScreenshot().catch((err) => ({ error: err.message }));
      port.postMessage(result);
    } else if (message.type === "ANSWER_REQUEST") {
      const settings = await getSettings();
      if (!settings.enabled) {
        port.postMessage({ error: "Cheatly is disabled." });
        return;
      }
      // Capture screenshot here so it never round-trips through the content script
      const screenshot = await captureScreenshot();
      const answer = await queryBackend(screenshot, message.selectedText);

      port.postMessage({ answer, displayMode: settings.displayMode });
    } else if (message.type === "GET_SETTINGS") {
      const settings = await getSettings();
      port.postMessage(settings);
    } else if (message.type === "SAVE_SETTINGS") {
      await chrome.storage.local.set({ settings: message.settings });
      port.postMessage({ ok: true });
    }
  } catch (err) {
    port.postMessage({ error: err.message });
  }
}

// ── Message Handler (popup) ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
