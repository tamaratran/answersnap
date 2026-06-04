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

  // ── Auto-Click Logic ────────────────────────────────────────────────────

  function autoClickAnswer(response, clickTarget) {
    const { type, letter, letters, answerText, answer } = response;

    if (type === "multiple_choice" && letter) {
      const result = clickMultipleChoice(letter, answerText, clickTarget);
      if (result) return true;
    }

    if (type === "multiple_select" && letters && letters.length > 0) {
      const result = clickMultipleSelect(letters, answerText, clickTarget);
      if (result) return true;
    }

    if (type === "fill_in_blank" && answer) {
      return fillInBlank(answer, clickTarget);
    }

    // Fallback: try to match answer text directly against options on the page.
    // This handles cases where the backend returns answer text but no letter/letters
    // (e.g., Google Forms which doesn't use A/B/C/D labels).
    if (answer || answerText) {
      const textResult = clickByAnswerText(answer || answerText, clickTarget);
      if (textResult) return true;
    }

    // Last resort: try filling a text input if one exists near the click target
    if (answer) {
      const filled = fillInBlank(answer, clickTarget);
      if (filled) return true;
    }

    return false;
  }

  function clickByAnswerText(answerStr, clickTarget) {
    const container = findQuestionContainer(clickTarget);
    const options = findOptionElements(container);
    if (options.length === 0) return false;

    // Split comma-separated answers (e.g., "Nucleus, Mitochondria, Ribosome")
    const answerParts = answerStr.split(/,\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
    let clicked = false;

    for (const option of options) {
      const optText = option.text.toLowerCase();
      for (const part of answerParts) {
        if (optText === part || optText.includes(part) || part.includes(optText)) {
          clickElement(option);
          clicked = true;
          break;
        }
      }
    }
    return clicked;
  }

  function clickMultipleChoice(letter, answerText, clickTarget) {
    // Find the question container — look up from click target
    const container = findQuestionContainer(clickTarget);
    const options = findOptionElements(container);

    for (const option of options) {
      if (matchesOption(option, letter, answerText)) {
        clickElement(option);
        return true;
      }
    }
    return false;
  }

  function clickMultipleSelect(letters, _answerText, clickTarget) {
    const container = findQuestionContainer(clickTarget);
    const options = findOptionElements(container);
    let clicked = false;

    for (const option of options) {
      for (const letter of letters) {
        if (matchesOption(option, letter, null)) {
          clickElement(option);
          clicked = true;
          break;
        }
      }
    }
    return clicked;
  }

  function fillInBlank(answer, clickTarget) {
    const inputSelector = 'input[type="text"], input:not([type]), textarea, [contenteditable="true"]';
    // Find nearest input/textarea to the click target
    const container = findQuestionContainer(clickTarget);
    let inputs = container.querySelectorAll(inputSelector);

    // If no inputs found in container, walk up from the click target more aggressively
    if (inputs.length === 0) {
      let parent = clickTarget;
      for (let i = 0; i < 15 && parent && parent !== document.body; i++) {
        inputs = parent.querySelectorAll(inputSelector);
        if (inputs.length > 0) break;
        parent = parent.parentElement;
      }
    }

    if (inputs.length > 0) {
      const input = inputs[0];
      if (input.getAttribute("contenteditable") === "true") {
        input.textContent = answer;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        const nativeInputValueSetter = input instanceof HTMLTextAreaElement
          ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
          : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, answer);
        } else {
          input.value = answer;
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }
    return false;
  }

  function findQuestionContainer(el) {
    // Walk up the DOM to find a container that likely holds the question + options
    let current = el;
    const containerSelectors = [
      "[class*='question']", "[class*='Question']",
      "[class*='problem']", "[class*='Problem']",
      "[role='group']", "[role='radiogroup']",
      "fieldset", "form",
      "[class*='quiz']", "[class*='Quiz']",
      "[class*='item']", "[class*='card']",
    ];

    for (let i = 0; i < 10 && current && current !== document.body; i++) {
      for (const sel of containerSelectors) {
        if (current.matches(sel)) return current;
      }
      // If current element contains multiple radio/checkbox inputs, it's likely the container
      const inputs = current.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (inputs.length >= 2) return current;
      // Google Forms uses div[role="radio"] and div[role="checkbox"] instead of inputs
      const ariaInputs = current.querySelectorAll('[role="radio"], [role="checkbox"]');
      if (ariaInputs.length >= 2) return current;
      current = current.parentElement;
    }

    // Fallback: return a wide area around the click
    return el.closest("form") || el.closest("fieldset") || el.closest("section") || document.body;
  }

  function findOptionElements(container) {
    // Gather all clickable option-like elements
    const options = [];

    // Radio buttons and checkboxes (with labels)
    const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    for (const input of inputs) {
      const label = input.closest("label") || container.querySelector(`label[for="${input.id}"]`);
      options.push({ element: label || input, input, text: (label || input.parentElement)?.textContent?.trim() || "" });
    }

    // If no inputs found, look for clickable option elements (custom UIs)
    if (options.length === 0) {
      const optionEls = container.querySelectorAll(
        '[class*="option"], [class*="answer"], [class*="choice"], [role="option"], [role="radio"], [role="checkbox"], li'
      );
      for (const el of optionEls) {
        const text = el.textContent?.trim()
          || el.getAttribute("data-value")
          || el.getAttribute("aria-label")
          || "";
        options.push({ element: el, input: null, text });
      }
    }

    return options;
  }

  function matchesOption(option, letter, answerText) {
    const text = option.text.toLowerCase();
    const letterLower = letter.toLowerCase();

    // Match by letter prefix: "A.", "A)", "A ", "(A)"
    const letterPatterns = [
      `${letterLower}.`, `${letterLower})`, `(${letterLower})`,
      `${letterLower} `, `${letter}.`, `${letter})`, `(${letter})`,
    ];

    for (const pattern of letterPatterns) {
      if (text.startsWith(pattern)) {
        return true;
      }
    }

    // Match by answer text content
    if (answerText && text.includes(answerText.toLowerCase())) {
      return true;
    }

    // Match by input value attribute
    if (option.input) {
      const val = (option.input.value || "").toLowerCase();
      if (val === letterLower || val === answerText?.toLowerCase()) {
        return true;
      }
    }

    return false;
  }

  function clickElement(option) {
    const el = option.input || option.element;
    // Dispatch mouse events in natural order for frameworks that listen on these
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();

    // For inputs, ensure change event fires
    if (option.input) {
      option.input.checked = true;
      option.input.dispatchEvent(new Event("change", { bubbles: true }));
      option.input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // ── Double-Click Handler ────────────────────────────────────────────────

  document.addEventListener("dblclick", async (e) => {
    if (!enabled || isLoading) return;

    // Don't trigger on our own overlay
    if (e.target.closest("#answersnap-overlay")) return;

    const selectedText = window.getSelection()?.toString()?.trim() || "";
    const clickTarget = e.target;

    isLoading = true;

    // Capture screenshot BEFORE showing the loading overlay so it doesn't
    // appear in the image sent to the AI.
    let screenshot;
    try {
      screenshot = await sendMessage({ type: "CAPTURE_SCREENSHOT" });
    } catch {
      showError("Failed to capture screenshot.");
      isLoading = false;
      return;
    }

    // Now show the loading indicator
    let displayMode = "homework";
    try {
      const settings = await sendMessage({ type: "GET_SETTINGS" });
      displayMode = settings.displayMode;
      showLoading(displayMode);
    } catch {
      showLoading("homework");
    }

    try {
      const response = await sendMessage({
        type: "ANSWER_REQUEST",
        selectedText,
        screenshot,
      });

      if (response.error) {
        showError(response.error);
      } else {
        // Try to auto-click the correct answer
        const clicked = autoClickAnswer(response, clickTarget);

        if (clicked) {
          showToast("Answer selected!");
          hideOverlay();
        } else {
          // Fallback: show the answer in overlay (for non-clickable questions)
          showAnswer(response.answer, response.displayMode);
        }
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
