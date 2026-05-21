/**
 * AnswerSnap — Popup Script
 *
 * Manages extension settings via chrome.storage.local.
 */

const enabledToggle = document.getElementById("enabled-toggle");
const apiKeyInput = document.getElementById("api-key");
const toggleKeyBtn = document.getElementById("toggle-key-visibility");
const modelSelect = document.getElementById("model-select");
const modeBtns = document.querySelectorAll(".mode-btn");
const statusEl = document.getElementById("status");

let currentMode = "homework";

// ── Load Settings ─────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (settings) => {
  if (!settings) return;

  enabledToggle.checked = settings.enabled;
  apiKeyInput.value = settings.apiKey || "";
  modelSelect.value = settings.model || "gpt-4o";
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
    apiKey: apiKeyInput.value.trim(),
    model: modelSelect.value,
    displayMode: currentMode,
  };

  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
    updateStatus(settings);
  });
}

function updateStatus(settings) {
  if (!settings.apiKey) {
    statusEl.textContent = "Enter your API key to get started";
    statusEl.className = "status error";
  } else if (!settings.enabled) {
    statusEl.textContent = "Extension is disabled";
    statusEl.className = "status";
  } else {
    statusEl.textContent = "Ready — double-click any question";
    statusEl.className = "status success";
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────

enabledToggle.addEventListener("change", saveSettings);

apiKeyInput.addEventListener("input", debounce(saveSettings, 500));

modelSelect.addEventListener("change", saveSettings);

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    saveSettings();
  });
});

toggleKeyBtn.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
});

// ── Utilities ─────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
