/**
 * Cheatly — Background Service Worker
 *
 * Handles:
 * 1. Screenshot capture via chrome.tabs.captureVisibleTab
 * 2. AI vision API call (OpenAI GPT-4o)
 * 3. Auth token management + subscription gating
 * 4. Message routing between content script and popup
 */

const BACKEND_URL = "https://answersnap-backend.fly.dev";

const AUTO_DISABLE_ALARM = "auto-disable";
const AUTO_DISABLE_MINUTES = 120; // 2 hours

const DEFAULT_SETTINGS = {
  enabled: true,
  displayMode: "homework", // "invisible" | "sneaky" | "homework"
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSettings() {
  const result = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...result.settings };
}

async function getAuthToken() {
  const result = await chrome.storage.local.get("authToken");
  return result.authToken || null;
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
  const token = await getAuthToken();
  if (!token) {
    throw new Error("LOGIN_REQUIRED");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(`${BACKEND_URL}/answer`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      screenshot: screenshotDataUrl,
      selectedText: selectedText || "",
    }),
  });

  if (response.status === 401) {
    throw new Error("LOGIN_REQUIRED");
  }
  if (response.status === 403) {
    throw new Error("SUBSCRIPTION_REQUIRED");
  }

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
      const screenshot = await captureScreenshot();
      const answer = await queryBackend(screenshot, message.selectedText);
      port.postMessage({ answer, displayMode: settings.displayMode });
    } else if (message.type === "GET_SETTINGS") {
      const settings = await getSettings();
      port.postMessage(settings);
    } else if (message.type === "SAVE_SETTINGS") {
      await chrome.storage.local.set({ settings: message.settings });
      port.postMessage({ ok: true });
    } else if (message.type === "CHECK_AUTH") {
      const token = await getAuthToken();
      port.postMessage({ authenticated: !!token });
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
      if (message.settings.enabled) {
        startAutoDisableTimer();
      } else {
        clearAutoDisableTimer();
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "AUTH_CHANGED") {
    sendResponse({ ok: true });
    return false;
  }
});

// ── Auto-Disable Timer ──────────────────────────────────────────────────────

function startAutoDisableTimer() {
  chrome.alarms.create(AUTO_DISABLE_ALARM, {
    delayInMinutes: AUTO_DISABLE_MINUTES,
  });
}

function clearAutoDisableTimer() {
  chrome.alarms.clear(AUTO_DISABLE_ALARM);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_DISABLE_ALARM) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  settings.enabled = false;
  await chrome.storage.local.set({ settings });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_STATE",
      enabled: false,
    }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (settings.enabled) startAutoDisableTimer();
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  if (settings.enabled) startAutoDisableTimer();
});

// ── Keyboard Shortcut ───────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-extension") {
    const settings = await getSettings();
    settings.enabled = !settings.enabled;
    await chrome.storage.local.set({ settings });

    if (settings.enabled) {
      startAutoDisableTimer();
    } else {
      clearAutoDisableTimer();
    }

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
