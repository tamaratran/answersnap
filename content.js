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
    // Auto-fill answers on the page
    autoFillAnswers(answer);

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

  // ── Auto-Fill Logic ──────────────────────────────────────────────────────

  function autoFillAnswers(answerText) {
    const parsed = parseAnswerLines(answerText);
    const groups = collectOptionGroups();
    const textInputs = collectTextInputs();

    let textInputIdx = 0;
    const DELAY_MS = 1500;

    parsed.reduce((promise, entry, i) => {
      return promise.then(() => new Promise((resolve) => {
        setTimeout(() => {
          if (entry.letter) {
            const el = selectChoice(groups, entry);
            if (el) highlightElement(el);
          } else if (entry.value) {
            const input = textInputs[textInputIdx];
            fillText(textInputs, textInputIdx, entry.value);
            if (input) highlightElement(input);
            textInputIdx++;
          }
          resolve();
        }, i === 0 ? 0 : DELAY_MS);
      }));
    }, Promise.resolve());
  }

  function highlightElement(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const target = el.closest("label") || el.closest("div") || el;
    const prev = target.style.cssText;
    target.style.transition = "background-color 0.4s ease, outline 0.2s ease";
    target.style.backgroundColor = "rgba(66, 133, 244, 0.35)";
    target.style.outline = "2px solid rgba(66, 133, 244, 0.7)";
    target.style.outlineOffset = "2px";
    target.style.borderRadius = "4px";
    setTimeout(() => {
      target.style.backgroundColor = "";
      target.style.outline = "";
      target.style.outlineOffset = "";
      setTimeout(() => { target.style.cssText = prev; }, 400);
    }, 1000);
  }

  function parseAnswerLines(answerText) {
    const lines = answerText.split("\n").filter((l) => l.trim());
    const results = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Match numbered answer: "1. C. Mitochondria" or "5. 6"
      const numberedMatch = trimmed.match(/^(\d+)\.\s*(.+)/);
      let questionNum = null;
      let answerPart = trimmed;

      if (numberedMatch) {
        questionNum = parseInt(numberedMatch[1]);
        answerPart = numberedMatch[2].trim();
      }

      // Check if it starts with a letter option: "C. Mitochondria"
      const letterMatch = answerPart.match(/^([A-Za-z])\.\s*(.*)/);

      if (letterMatch) {
        results.push({
          questionNum,
          letter: letterMatch[1].toUpperCase(),
          text: letterMatch[2].trim(),
          value: null,
        });
      } else {
        results.push({
          questionNum,
          letter: null,
          text: null,
          value: answerPart,
        });
      }
    }
    return results;
  }

  function collectOptionGroups() {
    const groups = [];

    // Standard HTML radio groups
    const radioNames = new Set();
    document.querySelectorAll('input[type="radio"]').forEach((r) => {
      if (r.name) radioNames.add(r.name);
    });

    for (const name of radioNames) {
      const radios = [...document.querySelectorAll(`input[type="radio"][name="${name}"]`)];
      const options = radios.map((radio) => {
        const label =
          document.querySelector(`label[for="${radio.id}"]`) ||
          radio.closest("label") ||
          radio.parentElement?.querySelector("label");
        const text = label?.textContent?.trim() || "";
        return { element: radio, label, text };
      });
      groups.push({ type: "radio", options });
    }

    // Google Forms: div[role="radiogroup"] with div[role="radio"] children
    document.querySelectorAll('[role="radiogroup"]').forEach((rg) => {
      const items = [...rg.querySelectorAll('[role="radio"], [data-value]')];
      if (!items.length) return;
      const options = items.map((el) => {
        const text = el.textContent?.trim() || el.getAttribute("data-value") || "";
        return { element: el, label: el, text };
      });
      groups.push({ type: "gforms-radio", options });
    });

    // Google Forms: div[role="listbox"] with div[role="option"]
    document.querySelectorAll('[role="listbox"]').forEach((lb) => {
      const items = [...lb.querySelectorAll('[role="option"]')];
      if (!items.length) return;
      const options = items.map((el) => ({
        element: el,
        label: el,
        text: el.textContent?.trim() || "",
      }));
      groups.push({ type: "gforms-select", options });
    });

    // Checkbox groups
    const checkNames = new Set();
    document.querySelectorAll('input[type="checkbox"]').forEach((c) => {
      if (c.name && !c.closest("#answersnap-overlay")) checkNames.add(c.name);
    });
    for (const name of checkNames) {
      const checks = [
        ...document.querySelectorAll(`input[type="checkbox"][name="${name}"]`),
      ];
      const options = checks.map((cb) => {
        const label =
          document.querySelector(`label[for="${cb.id}"]`) ||
          cb.closest("label") ||
          cb.parentElement?.querySelector("label");
        return { element: cb, label, text: label?.textContent?.trim() || "" };
      });
      groups.push({ type: "checkbox", options });
    }

    return groups;
  }

  function collectTextInputs() {
    const inputs = [];
    document
      .querySelectorAll(
        'input[type="text"]:not(#answersnap-overlay input), textarea:not(#answersnap-overlay textarea)'
      )
      .forEach((el) => {
        if (!el.closest("#answersnap-overlay")) inputs.push(el);
      });
    return inputs;
  }

  function matchOptionByLetter(options, letter) {
    // Match label text that starts with the letter: "C. Mitochondria", "(C)", etc.
    const patterns = [
      new RegExp(`^${letter}[.):\\s]`, "i"),
      new RegExp(`\\(${letter}\\)`, "i"),
    ];
    for (const opt of options) {
      for (const pat of patterns) {
        if (pat.test(opt.text.trim())) return opt;
      }
    }
    return null;
  }

  function matchOptionByText(options, text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    // Exact substring match
    for (const opt of options) {
      if (opt.text.toLowerCase().includes(lower)) return opt;
    }
    return null;
  }

  function clickElement(el) {
    if (el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox")) {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.click();
    } else {
      // Google Forms custom elements
      el.click();
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  }

  function selectChoice(groups, entry) {
    // Priority 1: match by both letter AND text for highest confidence
    if (entry.letter && entry.text) {
      for (const group of groups) {
        const byLetter = matchOptionByLetter(group.options, entry.letter);
        if (byLetter && byLetter.text.toLowerCase().includes(entry.text.toLowerCase())) {
          clickElement(byLetter.element);
          return byLetter.element;
        }
      }
    }

    // Priority 2: if we have a question number, try the corresponding group
    if (entry.questionNum && groups[entry.questionNum - 1]) {
      const group = groups[entry.questionNum - 1];
      const match = matchOptionByLetter(group.options, entry.letter);
      if (match) {
        clickElement(match.element);
        return match.element;
      }
    }

    // Priority 3: match by text content across all groups
    if (entry.text) {
      for (const group of groups) {
        const match = matchOptionByText(group.options, entry.text);
        if (match) {
          clickElement(match.element);
          return match.element;
        }
      }
    }

    // Priority 4: fallback to letter-only match on first unselected group
    for (const group of groups) {
      const alreadySelected = group.options.some(
        (o) => o.element.checked || o.element.getAttribute("aria-checked") === "true"
      );
      if (alreadySelected) continue;
      const match = matchOptionByLetter(group.options, entry.letter);
      if (match) {
        clickElement(match.element);
        return match.element;
      }
    }
    return null;
  }

  function fillText(textInputs, idx, value) {
    const input = textInputs[idx];
    if (!input) return;

    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set || Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ── Double-Click Handler ────────────────────────────────────────────────

  document.addEventListener("dblclick", async (e) => {
    if (!enabled || isLoading) return;

    // Don't trigger on our own overlay
    if (e.target.closest("#answersnap-overlay")) return;

    const selectedText = window.getSelection()?.toString()?.trim() || "";

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
        screenshot,
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
