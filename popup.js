/**
 * AnswerSnap — Popup Script
 *
 * Manages extension settings via chrome.storage.local.
 */

const enabledToggle = document.getElementById("enabled-toggle");
const modeBtns = document.querySelectorAll(".mode-btn");
const statusEl = document.getElementById("status");

let currentMode = "homework";

// ── Load Settings ─────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
  if (!settings) return;

  enabledToggle.checked = settings.enabled;
  currentMode = settings.displayMode || "homework";

  modeBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === currentMode);
  });

  updateStatus(settings);
});

// ── Save Settings ─────────────────────────────────────────────────────────

function saveSettings() {
  const settings = {
    enabled: enabledToggle.checked,
    displayMode: currentMode,
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

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    saveSettings();
  });
});
