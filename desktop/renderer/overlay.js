/**
 * Cheatly Desktop — Overlay Renderer
 *
 * Receives state updates from the main process and updates the UI.
 */

const idleEl = document.getElementById("idle");
const loadingEl = document.getElementById("loading");
const answerEl = document.getElementById("answer");
const answerTextEl = document.getElementById("answer-text");
const errorEl = document.getElementById("error");
const errorTextEl = document.getElementById("error-text");
const copyBtn = document.getElementById("copy-btn");
const closeBtn = document.getElementById("close-btn");

function showState(stateName) {
  idleEl.classList.add("hidden");
  loadingEl.classList.add("hidden");
  answerEl.classList.add("hidden");
  errorEl.classList.add("hidden");

  switch (stateName) {
    case "idle":
      idleEl.classList.remove("hidden");
      break;
    case "loading":
      loadingEl.classList.remove("hidden");
      break;
    case "answer":
      answerEl.classList.remove("hidden");
      break;
    case "error":
      errorEl.classList.remove("hidden");
      break;
  }
}

// Listen for state updates from main process
window.cheatly.onState((data) => {
  switch (data.type) {
    case "loading":
      showState("loading");
      break;
    case "answer":
      answerTextEl.textContent = data.answer;
      showState("answer");
      break;
    case "error":
      errorTextEl.textContent = data.message;
      showState("error");
      // Auto-revert to idle after 5s
      setTimeout(() => showState("idle"), 5000);
      break;
  }
});

// Copy button
copyBtn.addEventListener("click", () => {
  const text = answerTextEl.textContent;
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.innerHTML = "&#10003;";
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      }, 1500);
    });
  }
});

// Close button
closeBtn.addEventListener("click", () => {
  window.cheatly.hideOverlay();
});

// Keyboard: Escape to hide
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.cheatly.hideOverlay();
  }
});
