/**
 * AnswerSnap — Popup Script
 *
 * Manages extension settings via chrome.storage.local.
 */

const enabledToggle = document.getElementById("enabled-toggle");
const modeBtns = document.querySelectorAll(".mode-btn");
const statusEl = document.getElementById("status");
const apiKeyInput = document.getElementById("api-key");
const toggleKeyBtn = document.getElementById("toggle-key");

let currentMode = "homework";

// ── Load Settings ─────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
  if (!settings) return;

  enabledToggle.checked = settings.enabled;
  currentMode = settings.displayMode || "homework";
  apiKeyInput.value = settings.apiKey || "";

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
    apiKey: apiKeyInput.value.trim(),
  };

  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
    updateStatus(settings);
  });
}

function updateStatus(settings) {
  if (!settings.enabled) {
    statusEl.textContent = "Extension is disabled";
    statusEl.className = "status";
  } else if (!settings.apiKey) {
    statusEl.textContent = "Enter your OpenAI API key above";
    statusEl.className = "status error";
  } else {
    statusEl.textContent = "Ready — double-click any question";
    statusEl.className = "status success";
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────

enabledToggle.addEventListener("change", saveSettings);

apiKeyInput.addEventListener("change", saveSettings);

toggleKeyBtn.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
});

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    saveSettings();
  });
});
