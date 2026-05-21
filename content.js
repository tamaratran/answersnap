/**
 * AnswerSnap — Content Script
 *
 * Injected into every page. Listens for double-click events,
 * communicates with the background service worker, and renders
 * the answer overlay.
 */

(() => {
  "use strict";

  let enabled = true;
  let isLoading = false;

  // ── Overlay DOM ──────────────────────────────────────────────────────────

  function createOverlay() {
    const existing = document.getElementById("answersnap-overlay");
    if (existing) return existing;

    const overlay = document.createElement("div");
    overlay.id = "answersnap-overlay";
    overlay.className = "answersnap-overlay answersnap-hidden";
    overlay.innerHTML = `
      <div class="answersnap-header">
        <span class="answersnap-title">AnswerSnap</span>
        <div class="answersnap-actions">
          <button class="answersnap-copy" title="Copy answer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
          <button class="answersnap-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="answersnap-body">
        <div class="answersnap-answer"></div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    overlay.querySelector(".answersnap-close").addEventListener("click", () => {
      hideOverlay();
    });

    overlay.querySelector(".answersnap-copy").addEventListener("click", () => {
      const answer = overlay.querySelector(".answersnap-answer").textContent;
      navigator.clipboard.writeText(answer).then(() => {
        const btn = overlay.querySelector(".answersnap-copy");
        btn.innerHTML = "&#10003;";
        setTimeout(() => {
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        }, 1500);
      });
    });

    return overlay;
  }

  function showLoading(mode) {
    if (mode === "invisible") return;

    const overlay = createOverlay();
    const answerEl = overlay.querySelector(".answersnap-answer");
    answerEl.innerHTML = `
      <div class="answersnap-loading">
        <div class="answersnap-spinner"></div>
        <span>Analyzing...</span>
      </div>
    `;

    overlay.classList.remove("answersnap-hidden");

    if (mode === "sneaky") {
      overlay.classList.add("answersnap-sneaky");
    } else {
      overlay.classList.remove("answersnap-sneaky");
    }
  }

  function showAnswer(answer, mode) {
    if (mode === "invisible") {
      navigator.clipboard.writeText(answer).catch(() => {});
      showToast("Answer copied to clipboard");
      return;
    }

    const overlay = createOverlay();
    const answerEl = overlay.querySelector(".answersnap-answer");
    answerEl.textContent = answer;

    overlay.classList.remove("answersnap-hidden", "answersnap-sneaky");

    if (mode === "sneaky") {
      overlay.classList.add("answersnap-sneaky");
    }
  }

  function showError(message) {
    const overlay = createOverlay();
    const answerEl = overlay.querySelector(".answersnap-answer");
    answerEl.innerHTML = `<span class="answersnap-error">${escapeHtml(message)}</span>`;
    overlay.classList.remove("answersnap-hidden", "answersnap-sneaky");
  }

  function hideOverlay() {
    const overlay = document.getElementById("answersnap-overlay");
    if (overlay) {
      overlay.classList.add("answersnap-hidden");
    }
  }

  function showToast(text) {
    const toast = document.createElement("div");
    toast.className = "answersnap-toast";
    toast.textContent = text;
    document.documentElement.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("answersnap-toast-visible");
    });

    setTimeout(() => {
      toast.classList.remove("answersnap-toast-visible");
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Double-Click Handler ────────────────────────────────────────────────

  document.addEventListener("dblclick", async (e) => {
    if (!enabled || isLoading) return;

    // Don't trigger on our own overlay
    if (e.target.closest("#answersnap-overlay")) return;

    const selectedText = window.getSelection()?.toString()?.trim() || "";

    isLoading = true;

    // Get display mode first
    try {
      const settings = await sendMessage({ type: "GET_SETTINGS" });
      showLoading(settings.displayMode);
    } catch {
      showLoading("homework");
    }

    try {
      const response = await sendMessage({
        type: "ANSWER_REQUEST",
        selectedText,
      });

      if (response.error) {
        showError(response.error);
      } else {
        showAnswer(response.answer, response.displayMode);
      }
    } catch (_err) {
      showError("Failed to get answer. Check your settings.");
    } finally {
      isLoading = false;
    }
  });

  // ── Message Helpers ─────────────────────────────────────────────────────

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // Listen for toggle commands from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "TOGGLE_STATE") {
      enabled = message.enabled;
      if (!enabled) hideOverlay();
      showToast(enabled ? "AnswerSnap ON" : "AnswerSnap OFF");
    }
  });

  // ── Keyboard Shortcut: Escape to close ─────────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideOverlay();
    }
  });

  // ── Init ────────────────────────────────────────────────────────────────

  sendMessage({ type: "GET_SETTINGS" })
    .then((settings) => {
      enabled = settings.enabled;
    })
    .catch(() => {});
})();
