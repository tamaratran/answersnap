/**
 * AnswerSnap — Content Script
 *
 * Injected into every page. Listens for double-click events,
 * communicates with the background service worker, and delivers
 * answers via clipboard + toast notification.
 */

(() => {
  "use strict";

  let enabled = true;
  let isLoading = false;

  // ── Toast Notification ──────────────────────────────────────────────────

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

  // ── Auto-Click Logic ──────────────────────────────────────────────────

  function autoClickAnswer(response, clickTarget) {
    const type = (response.type || "").toLowerCase();

    if (type === "multiple_choice" && response.letter) {
      return clickMultipleChoice(response.letter, response.answerText, clickTarget);
    }

    if (type === "multiple_select" && response.letters?.length) {
      return clickMultipleSelect(response.letters, response.answerText, clickTarget);
    }

    if (type === "fill_in_blank" && response.answer) {
      return fillInBlank(response.answer, clickTarget);
    }

    return false;
  }

  function clickMultipleChoice(letter, answerText, clickTarget) {
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
    const container = findQuestionContainer(clickTarget);
    const inputs = container.querySelectorAll(
      'input[type="text"], input:not([type]), textarea, [contenteditable="true"]'
    );

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
      const inputs = current.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (inputs.length >= 2) return current;
      current = current.parentElement;
    }

    return el.closest("form") || el.closest("fieldset") || el.closest("section") || document.body;
  }

  function findOptionElements(container) {
    const options = [];

    const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    for (const input of inputs) {
      const label = input.closest("label") || container.querySelector(`label[for="${input.id}"]`);
      options.push({ element: label || input, input, text: (label || input.parentElement)?.textContent?.trim() || "" });
    }

    if (options.length === 0) {
      const optionEls = container.querySelectorAll(
        '[class*="option"], [class*="answer"], [class*="choice"], [role="option"], [role="radio"], li'
      );
      for (const el of optionEls) {
        options.push({ element: el, input: null, text: el.textContent?.trim() || "" });
      }
    }

    return options;
  }

  function matchesOption(option, letter, answerText) {
    const text = option.text.toLowerCase();
    const letterLower = letter.toLowerCase();

    const letterPatterns = [
      `${letterLower}.`, `${letterLower})`, `(${letterLower})`,
      `${letterLower} `, `${letter}.`, `${letter})`, `(${letter})`,
    ];

    for (const pattern of letterPatterns) {
      if (text.startsWith(pattern)) {
        return true;
      }
    }

    if (answerText && text.includes(answerText.toLowerCase())) {
      return true;
    }

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
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();

    if (option.input) {
      option.input.checked = true;
      option.input.dispatchEvent(new Event("change", { bubbles: true }));
      option.input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // ── Double-Click Handler ────────────────────────────────────────────────

  document.addEventListener("dblclick", async (e) => {
    if (!enabled || isLoading) return;

    // Don't trigger on our own elements
    if (e.target.closest(".answersnap-toast")) return;

    const selectedText = window.getSelection()?.toString()?.trim() || "";
    const clickTarget = e.target;

    isLoading = true;

    let screenshot;
    try {
      screenshot = await sendMessage({ type: "CAPTURE_SCREENSHOT" });
      if (screenshot?.error) throw new Error(screenshot.error);
    } catch {
      showToast("Failed to capture screenshot.");
      isLoading = false;
      return;
    }

    try {
      const response = await sendMessage({
        type: "ANSWER_REQUEST",
        selectedText,
        screenshot,
      });

      if (response.error) {
        showToast(response.error);
      } else {
        const clicked = autoClickAnswer(response, clickTarget);

        if (clicked) {
          showToast("Answer selected!");
        } else {
          navigator.clipboard.writeText(response.answer).catch(() => {});
          showToast("Answer copied to clipboard");
        }
      }
    } catch (_err) {
      showToast("Failed to get answer. Check your settings.");
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "TOGGLE_STATE") {
      enabled = message.enabled;
      showToast(enabled ? "AnswerSnap ON" : "AnswerSnap OFF");
    }
  });

  // ── Init ────────────────────────────────────────────────────────────────

  sendMessage({ type: "GET_SETTINGS" })
    .then((settings) => {
      enabled = settings.enabled;
    })
    .catch(() => {});
})();
