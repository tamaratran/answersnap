---
name: testing-desktop-app
description: Test the Cheatly Electron desktop app end-to-end (double-click / hotkey to answer, invisible overlay). Use when verifying changes under desktop/.
---

# Testing the Cheatly desktop app

The desktop app (`desktop/`) is an Electron overlay that captures the screen, sends it
to `answersnap-backend.fly.dev`, and shows the answer in an always-on-top window. It
mirrors the Chrome extension's **double-click any question to answer** gesture using a
global OS-level mouse hook (`uiohook-napi`), plus hotkeys.

## Setup
1. `cd desktop && npm install` (installs Electron + native `uiohook-napi`).
2. Launch on the Linux desktop: `DISPLAY=:0 nohup npm start > /tmp/electron.log 2>&1 &`
   - GPU / dbus / `thread priority` warnings in the log are harmless.
   - The overlay starts hidden; it appears after a trigger or `Ctrl+Shift+H`.
3. Backend is public — no secret needed. Sanity check: `curl -s https://answersnap-backend.fly.dev/health` → `{"status":"ok"}`.
4. The backend URL is overridable via `CHEATLY_BACKEND_URL` (see `desktop/lib/backend.js`).
   To test backend changes without a fly deploy, run `backend/main.py` locally
   (needs `fastapi uvicorn httpx pydantic opencv-python-headless numpy`) and launch the
   app with `CHEATLY_BACKEND_URL=http://127.0.0.1:<port>`. A tiny proxy can split routes
   (e.g. `/answer` → prod for the real OpenAI key, `/locate` → local).

## Deterministic test page
Create a local MC quiz HTML (e.g. "What is the powerhouse of the cell?" with options
A–D incl. C. Mitochondria) and open `file:///.../quiz.html` in Chrome. A known-answer
question makes the pass/fail criterion concrete.

## Triggers to verify
- **Double-click** the question text → overlay shows the correct answer within ~2-6s.
  A single click must NOT trigger, so an appearing overlay proves the global hook fired.
- `Ctrl+Shift+A` — same as double-click (hotkey path).
- `Ctrl+Shift+D` — toggles double-click mode; overlay idle view shows `(on)`/`(off)`.
- `Ctrl+Shift+H` show/hide, `Ctrl+Shift+E` emergency hide, `Ctrl+Shift+Q` quit.

## Known caveats / possible gotchas
- **Auto-fill DOES work on Linux** — if the overlay shows "Could not locate option —
  answer copied", suspect the backend `/locate` endpoint rather than the OS. Past causes:
  the deployed Docker image missing `opencv-python-headless`/`numpy` (import crash → 500),
  and HoughCircles mistaking letter "o" glyphs for radio buttons (wrong option clicked).
  Verify `/locate` directly with a screenshot payload before blaming the client.
- **Verify the RIGHT option gets selected, not just that something was clicked.** The
  overlay can say "Auto-clicked!" while the wrong radio is filled. Always screenshot the
  radio group after the flow and compare against the known correct answer.
- After a test run, reload the quiz with a changed URL (e.g. `?fresh=1`) — Chrome
  restores radio selections across F5, which would contaminate the next run's precondition.
- `setContentProtection` (capture-invisibility) is a no-op on Linux, so the overlay is
  visible in screenshots here — good for testing, but don't claim capture-invisibility
  was verified. It only truly applies on Windows 10 v2004+/macOS.
- The double-click also selects text in the browser (normal browser behavior); ignore that.
- If the global hook seems dead, confirm `uiohook-napi` loaded (check `/tmp/electron.log`)
  and that a window manager is active on `:0` so synthetic clicks reach the page.

## Devin Secrets Needed
- None for the desktop app itself (backend is public). `ANSWERSNAP_OPENAI_KEY` is only
  relevant if testing the backend directly.
