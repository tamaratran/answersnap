/**
 * Backend communication module.
 *
 * Sends screenshots to the existing Cheatly backend (same endpoint
 * the Chrome extension uses) and returns the AI-generated answer.
 */

const BACKEND_URL = process.env.CHEATLY_BACKEND_URL || "https://answersnap-backend.fly.dev";

async function queryBackend(screenshotDataUrl) {
  const response = await fetch(`${BACKEND_URL}/answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      screenshot: screenshotDataUrl,
      selectedText: "", // Desktop app has no click context
    }),
  });

  if (!response.ok) {
    let detail = `Backend error: ${response.status}`;
    try {
      const err = await response.json();
      detail = err.detail || detail;
    } catch (_) {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  const data = await response.json();
  return data.answer || "No answer returned.";
}

/**
 * Ask the backend to locate where to click for an MC answer.
 * Returns {x, y, confidence} or null on failure.
 */
async function locateAnswer(screenshotDataUrl, answer, screenWidth, screenHeight) {
  try {
    const response = await fetch(`${BACKEND_URL}/locate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        screenshot: screenshotDataUrl,
        answer,
        screenWidth,
        screenHeight,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return { x: data.x, y: data.y, confidence: data.confidence };
  } catch (_) {
    return null;
  }
}

module.exports = { queryBackend, locateAnswer };
