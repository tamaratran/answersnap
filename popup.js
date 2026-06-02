/**
 * AnswerSnap — Popup Script
 *
 * Manages extension settings via chrome.storage.local.
 */

const enabledToggle = document.getElementById("enabled-toggle");
const statusEl = document.getElementById("status");

// ── Load Settings ─────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
  if (!settings) return;

  enabledToggle.checked = settings.enabled;
  updateStatus(settings);
});

// ── Save Settings ─────────────────────────────────────────────────────────

function saveSettings() {
  const settings = {
    enabled: enabledToggle.checked,
    displayMode: "invisible",
  };

  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
    updateStatus(settings);
  });
}

function updateStatus(settings) {
  if (!settings.enabled) {
    statusEl.textContent = "Extension is disabled";
    statusEl.className = "status";
  } else {
    statusEl.textContent = "Ready — double-click any question";
    statusEl.className = "status success";
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────

enabledToggle.addEventListener("change", saveSettings);
