---
name: testing-answersnap
description: End-to-end test the AnswerSnap Chrome extension (double-click answer flow, auto-fill, service-worker wake). Use when verifying extension or backend changes.
---

# Testing AnswerSnap

## Setup
1. Backend: the extension calls `https://answersnap-backend.fly.dev` (see `BACKEND_URL` in `background.js`). Check it first: `curl https://answersnap-backend.fly.dev/health` should return `{"status":"ok"}`. If down, run the FastAPI app in `backend/` locally with `OPENAI_API_KEY` set (secret: `ANSWERSNAP_OPENAI_KEY`) and temporarily point `BACKEND_URL` at it.
2. Load the extension: `chrome://extensions` → enable Developer mode → Load unpacked → select the repo root (folder containing `manifest.json`).
   - The native folder-picker dialog can be flaky when typing paths: clicking sidebar "Home" then double-clicking through folders (repos → answersnap) and clicking "Open" is the most reliable path. Typing a path with Enter may leave the dialog stuck.
3. Create a simple local quiz page (`file:///.../quiz.html`) with radio groups, checkboxes, and a text input — the content script auto-fills these.

## Key test: inactive service worker
The critical scenario is double-clicking a question while the MV3 service worker is asleep (it idles out after ~30s). On `chrome://extensions` wait until the AnswerSnap card shows "service worker (Inactive)" (refresh the page to update the label), then double-click a question. A correct implementation wakes the worker (content.js uses `chrome.runtime.connect()` port messaging) and auto-fills the answer in ~5–10s. A broken one shows a "Failed to capture screenshot" toast.

## Assertions
- Correct radio/checkbox/text answer auto-filled near the double-clicked question.
- Previously filled answers preserved (one question answered per double-click).
- No error toasts.

## Notes
- `Alt+A` toggles the extension; `Escape` closes the overlay. Display modes (invisible/sneaky/homework) are set via the popup.
- No CI workflows exist for runtime behavior — testing must be manual/visual.

## Devin Secrets Needed
- `ANSWERSNAP_OPENAI_KEY` — only if running the backend locally; the deployed Fly.io backend already has a key configured.
