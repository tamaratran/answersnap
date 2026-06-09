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

  function showAnswer(answer, mode, clickTarget) {
    // Auto-fill the answer on the page for the clicked question
    autoFillAnswers(answer, clickTarget);

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

  function autoFillAnswers(answerText, clickTarget) {
    const parsed = parseAnswerLines(answerText);
    if (parsed.length === 0) return;

    const groups = collectOptionGroups();

    // Check if this is a multi-select answer (multiple entries with letters)
    if (parsed.length > 1 && parsed.every((e) => e.letter)) {
      // Multi-select: check each matching checkbox/option
      for (const entry of parsed) {
        const el = selectChoice(groups, entry, clickTarget);
        if (el) highlightElement(el);
      }
      return;
    }

    const entry = parsed[0];

    if (entry.letter) {
      const el = selectChoice(groups, entry, clickTarget);
      if (el) highlightElement(el);
    } else if (entry.value) {
      const input = findNearestTextInput(clickTarget);
      if (input) {
        fillTextInput(input, entry.value);
        highlightElement(input);
      }
    }
  }

  function findNearestTextInput(clickTarget) {
    if (!clickTarget) {
      const inputs = collectTextInputs();
      return inputs[0] || null;
    }
    let el = clickTarget;
    for (let i = 0; i < 15 && el && el !== document.body; i++) {
      const input = el.querySelector('input[type="text"]:not(#answersnap-overlay input), textarea:not(#answersnap-overlay textarea)');
      if (input) return input;
      el = el.parentElement;
    }
    const inputs = collectTextInputs();
    return inputs[0] || null;
  }

  function fillTextInput(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, "value"
    )?.set || Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, "value"
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
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

      // Check for comma-separated multi-select: "A, C" or "A, C, D"
      const multiMatch = trimmed.match(/^([A-Za-z])(?:\s*,\s*[A-Za-z])+$/);
      if (multiMatch) {
        const letters = trimmed.split(/\s*,\s*/);
        for (const l of letters) {
          results.push({ questionNum: null, letter: l.trim().toUpperCase(), text: null, value: null });
        }
        continue;
      }

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
        const label = el.closest("label");
        const text = el.textContent?.trim() || el.getAttribute("data-value") || el.getAttribute("aria-label") || label?.textContent?.trim() || "";
        return { element: el, label: label || el, text };
      });
      groups.push({ type: "gforms-radio", options });
    });

    // Google Forms: checkbox groups (div[role="group"] with div[role="checkbox"])
    document.querySelectorAll('[role="group"]').forEach((cg) => {
      const items = [...cg.querySelectorAll('[role="checkbox"]')];
      if (!items.length) return;
      const options = items.map((el) => {
        const label = el.closest("label");
        const text = el.textContent?.trim() || el.getAttribute("data-value") || el.getAttribute("aria-label") || label?.textContent?.trim() || "";
        return { element: el, label: label || el, text };
      });
      groups.push({ type: "gforms-checkbox", options });
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

  function matchOptionByPosition(options, letter) {
    const idx = letter.charCodeAt(0) - "A".charCodeAt(0);
    if (idx >= 0 && idx < options.length) return options[idx];
    return null;
  }

  function matchOptionByText(options, text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    // Exact substring match
    for (const opt of options) {
      if (opt.text.toLowerCase().includes(lower)) return opt;
    }
    // Reverse: check if option text is a substring of the answer
    for (const opt of options) {
      if (opt.text && lower.includes(opt.text.toLowerCase())) return opt;
    }
    // Fuzzy: normalize whitespace/special chars and compare
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normText = normalize(text);
    let bestMatch = null;
    let bestScore = 0;
    for (const opt of options) {
      if (!opt.text) continue;
      const normOpt = normalize(opt.text);
      if (!normOpt) continue;
      // Check if one contains the other after normalization
      if (normOpt.includes(normText) || normText.includes(normOpt)) return opt;
      // Token overlap score
      const tWords = new Set(text.toLowerCase().split(/\s+/));
      const oWords = opt.text.toLowerCase().split(/\s+/);
      const overlap = oWords.filter((w) => tWords.has(w)).length;
      const score = overlap / Math.max(tWords.size, oWords.length);
      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestMatch = opt;
      }
    }
    return bestMatch;
  }

  function clickElement(el) {
    if (el.tagName === "INPUT" && el.type === "radio") {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.click();
    } else if (el.tagName === "INPUT" && el.type === "checkbox") {
      // For checkboxes, only click if not already checked (click toggles state)
      if (!el.checked) {
        el.click();
      }
    } else {
      // Google Forms custom elements
      el.click();
    }
  }

  function selectChoice(groups, entry, clickTarget) {
    // Sort groups by proximity to click target so we pick the nearest question
    const sorted = clickTarget
      ? [...groups].sort((a, b) => {
          const aEl = a.options[0]?.element;
          const bEl = b.options[0]?.element;
          if (!aEl || !bEl) return 0;
          const aRect = aEl.getBoundingClientRect();
          const bRect = bEl.getBoundingClientRect();
          const clickRect = clickTarget.getBoundingClientRect();
          const aDist = Math.abs(aRect.top - clickRect.top);
          const bDist = Math.abs(bRect.top - clickRect.top);
          return aDist - bDist;
        })
      : groups;

    // Priority 1: match by both letter AND text for highest confidence
    if (entry.letter && entry.text) {
      for (const group of sorted) {
        const byLetter = matchOptionByLetter(group.options, entry.letter);
        if (byLetter && byLetter.text.toLowerCase().includes(entry.text.toLowerCase())) {
          clickElement(byLetter.element);
          return byLetter.element;
        }
      }
    }

    // Priority 2: letter match on nearest group
    if (entry.letter) {
      for (const group of sorted) {
        const match = matchOptionByLetter(group.options, entry.letter);
        if (match) {
          clickElement(match.element);
          return match.element;
        }
      }
    }

    // Priority 3: match by text content across all groups
    if (entry.text) {
      for (const group of sorted) {
        const match = matchOptionByText(group.options, entry.text);
        if (match) {
          clickElement(match.element);
          return match.element;
        }
      }
    }

    // Priority 4: positional fallback (A=1st, B=2nd) on nearest group
    if (entry.letter) {
      for (const group of sorted) {
        const match = matchOptionByPosition(group.options, entry.letter);
        if (match) {
          clickElement(match.element);
          return match.element;
        }
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
        showAnswer(response.answer, response.displayMode, clickTarget);
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
