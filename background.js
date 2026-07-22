/**
 * Cheatly — Background Service Worker
 *
 * Handles:
 * 1. Screenshot capture via chrome.tabs.captureVisibleTab
 * 2. AI vision API call (OpenAI GPT-4.1)
 * 3. Auth token management + subscription gating
 * 4. Message routing between content script and popup
 */

const BACKEND_URL = "https://cheatly-backend.fly.dev";

const AUTO_DISABLE_ALARM = "auto-disable";
const AUTO_DISABLE_MINUTES = 60; // 1 hour

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

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

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
  if (response.status === 429) {
    throw new Error("RATE_LIMITED");
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
      let answer;
      try {
        answer = await queryBackend(screenshot, message.selectedText);
      } catch (err) {
        if (err.message !== "RATE_LIMITED") throw err;
        // Locally enabled but the server usage window has expired — the two
        // can drift apart (extension reinstalled, alarm lost, clock skew),
        // which otherwise leaves the user stuck on 429 with no way out
        // except toggling. Start a fresh window and retry once.
        await resetServerSession();
        startAutoDisableTimer();
        answer = await queryBackend(screenshot, message.selectedText);
      }

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
    chrome.storage.local.set({ settings: message.settings }).then(async () => {
      // Manage auto-disable timer on settings change from popup
      if (message.settings.enabled) {
        startAutoDisableTimer();
        // Reset server-side session when user re-enables
        await resetServerSession();
      } else {
        clearAutoDisableTimer();
      }
      // Content scripts cache `enabled`; without this, open tabs keep the
      // stale value until reload and double-clicks silently do nothing.
      await broadcastToggleState(message.settings.enabled);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "RESTART_EXTENSION") {
    // One-click recovery from the popup: force-enable, start a fresh
    // server usage window, and sync every open tab.
    (async () => {
      const settings = await getSettings();
      settings.enabled = true;
      await chrome.storage.local.set({ settings });
      await resetServerSession();
      startAutoDisableTimer();
      await broadcastToggleState(true);
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// ── Tab Broadcast ────────────────────────────────────────────────────────────

async function broadcastToggleState(enabled) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_STATE",
      enabled,
    }).catch(() => {});
  }
}

// ── Server Session Reset ────────────────────────────────────────────────────

async function resetServerSession() {
  const token = await getAuthToken();
  if (!token) return;
  try {
    await fetch(`${BACKEND_URL}/auth/reset-session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (_err) {
    // Non-critical — server will start a new session on next /answer call
  }
}

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
  if (!settings.enabled) return; // Already off

  settings.enabled = false;
  await chrome.storage.local.set({ settings });

  // Notify every tab — each content script caches `enabled`, and a tab
  // that misses this update keeps double-click handling silently dead.
  await broadcastToggleState(false);
});

// Start timer on install/startup if enabled
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

    // Manage auto-disable timer
    if (settings.enabled) {
      startAutoDisableTimer();
      resetServerSession();
    } else {
      clearAutoDisableTimer();
    }

    await broadcastToggleState(settings.enabled);
  }
});
