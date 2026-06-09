/**
 * AnswerSnap — Background Service Worker
 *
 * Handles:
 * 1. Screenshot capture via chrome.tabs.captureVisibleTab
 * 2. AI vision API call (OpenAI GPT-4o)
 * 3. Message routing between content script and popup
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  displayMode: "homework", // "invisible" | "sneaky" | "homework"
  apiKey: "",
  model: "gpt-4o",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSettings() {
  const result = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...result.settings };
}

async function captureScreenshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
    quality: 90,
  });
  return dataUrl;
}

function buildPrompt(selectedText) {
  const contextHint = selectedText
    ? `The user double-clicked near this text: "${selectedText}"\n\n`
    : "";

  return `${contextHint}You are an expert tutor. Look at this screenshot of a question (exam, quiz, homework, etc.).

Your job:
1. Identify the question(s) visible on screen.
2. Determine the correct answer(s).
3. Return ONLY the answer in a concise format.

Rules:
- For multiple choice: return the letter(s) and brief text, e.g. "C. 2x + 2"
- For multiple select: return all correct letters, e.g. "A, C"
- For fill-in-the-blank: return just the answer value
- For matching: return each pair, e.g. "CO2 → Reactant, H2O → Reactant, O2 → Product, C6H12O6 → Primary energy storage"
- For short answer / essay: provide a concise but complete answer (2-4 sentences for short answer, a paragraph for essay)
- If multiple questions are visible, answer ALL of them, numbered.
- Be direct. No preamble or explanation unless the question asks for it.
- If you cannot determine the answer with confidence, say "Uncertain: " followed by your best guess.`;
}

async function queryAI(screenshotDataUrl, selectedText, settings) {
  if (!settings.apiKey) {
    throw new Error("API key not set. Open the AnswerSnap popup to configure.");
  }

  const base64Image = screenshotDataUrl.split(",")[1];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildPrompt(selectedText),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      `OpenAI API error: ${response.status} — ${err.error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "No answer returned.";
}

// ── Message Handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CAPTURE_SCREENSHOT") {
    captureScreenshot().then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (message.type === "ANSWER_REQUEST") {
    handleAnswerRequest(message, sendResponse);
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    chrome.storage.local.set({ settings: message.settings }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function handleAnswerRequest(message, sendResponse) {
  try {
    const settings = await getSettings();

    if (!settings.enabled) {
      sendResponse({ error: "AnswerSnap is disabled." });
      return;
    }

    const screenshot = message.screenshot || await captureScreenshot();
    const answer = await queryAI(screenshot, message.selectedText, settings);

    sendResponse({ answer, displayMode: settings.displayMode });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

// ── Keyboard Shortcut ───────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-extension") {
    const settings = await getSettings();
    settings.enabled = !settings.enabled;
    await chrome.storage.local.set({ settings });

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "TOGGLE_STATE",
        enabled: settings.enabled,
      });
    }
  }
});
