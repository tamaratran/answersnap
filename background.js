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
3. Return a JSON response so the extension can AUTO-CLICK the correct answer.

You MUST respond with valid JSON in this exact format:
{
  "type": "multiple_choice" | "multiple_select" | "fill_in_blank" | "short_answer" | "matching",
  "answer": "the answer text",
  "letter": "C",
  "letters": ["A", "C"],
  "answerText": "the full text of the correct option"
}

Rules:
- For multiple choice: set type="multiple_choice", letter to the correct letter (A/B/C/D), and answerText to the full option text (e.g. "2x + 2")
- For multiple select: set type="multiple_select", letters to array of correct letters, and answerText to comma-separated correct option texts
- For fill-in-the-blank: set type="fill_in_blank", answer to the value to type
- For short answer / essay: set type="short_answer", answer to the full response
- For matching: set type="matching", answer to the pairs description
- Always set "answer" to a human-readable string of the answer regardless of type
- If you cannot determine the answer with confidence, prefix answer with "Uncertain: "
- Return ONLY the JSON object. No markdown, no backticks, no explanation.`;
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
  const rawContent = data.choices?.[0]?.message?.content?.trim() || "";

  if (!rawContent) return { type: "short_answer", answer: "No answer returned." };

  // Try to parse as JSON for structured auto-click support
  try {
    const cleaned = rawContent.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && parsed.answer) return parsed;
  } catch {
    // AI returned plain text — wrap it in a simple structure
  }

  return { type: "short_answer", answer: rawContent };
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
    const result = await queryAI(screenshot, message.selectedText, settings);

    sendResponse({
      answer: result.answer,
      type: result.type,
      letter: result.letter,
      letters: result.letters,
      answerText: result.answerText,
      displayMode: settings.displayMode,
    });
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
