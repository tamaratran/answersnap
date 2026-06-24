---
name: testing-desktop-app
description: Test the Cheatly Desktop App (Electron invisible overlay with global hotkeys, screen capture, AI answers, and auto-fill typing). Use when verifying desktop app changes, hotkey registration, overlay UI, or auto-fill functionality.
---

# Testing the Cheatly Desktop App

## Launch

```bash
cd /home/ubuntu/repos/answersnap/desktop
npm install  # only needed first time or after dependency changes
npx electron .
```

- D-Bus errors on Linux (`Failed to connect to the bus`) are expected and harmless — the app launches fine despite them.
- The app starts **hidden** — no window appears until a hotkey is pressed.
- Verify the process is running: `pgrep -f "electron ."` should return a PID.

## Hotkeys

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Capture screen → AI answer → display in overlay |
| `Ctrl+Shift+T` | Type last answer into focused field (auto-fill) |
| `Ctrl+Shift+H` | Toggle overlay visibility |
| `Ctrl+Shift+E` | Emergency hide (instant vanish) |
| `Ctrl+Shift+Q` | Quit app |

## Testing the Capture + Answer Flow

1. Have a quiz/question visible on screen (Google Forms works well)
2. Press `Ctrl+Shift+A`
3. Overlay appears top-right with "Thinking..." spinner
4. Within ~5-10s, AI answer appears (e.g. "A, C, E")
5. Footer shows green "Copied to clipboard" text
6. Verify clipboard: `DISPLAY=:0 xclip -selection clipboard -o`

**Backend:** Uses `answersnap-backend.fly.dev/answer` (same as Chrome extension). If you get "exceeded quota" errors, the OpenAI API key needs more credits.

## Testing Auto-Fill Typing (Ctrl+Shift+T)

1. First trigger `Ctrl+Shift+A` to populate `lastAnswer`
2. Open a page with a text input field (e.g. `file:///home/ubuntu/typing-test.html`)
3. Click the input to focus it
4. Press `Ctrl+Shift+T`
5. The overlay hides briefly, answer is typed into the field via OS-level keystrokes
6. Overlay reappears with "Typed into field" status

**Fallback:** If nut-js typing fails, it falls back to clipboard copy. The overlay will show "Copied to clipboard (paste with Ctrl+V)" instead.

## Testing Overlay Visibility

- `Ctrl+Shift+H` toggles: visible → hidden → visible
- After toggling back, the answer state should be preserved (not reset to idle)
- `Ctrl+Shift+E` is emergency hide — same as H but one-way (hide only)

## Key Gotchas

- **setContentProtection:** `BrowserWindow.setContentProtection(true)` makes the overlay invisible to screen capture/recording on Windows and macOS. On Linux, this has no effect — the overlay IS visible in screenshots. Don't test capture invisibility on Linux.
- **nut-js on Linux:** Uses `@nut-tree-fork/nut-js` (not the original). Requires X11 (Wayland may not work). Verify with: `node -e "const { keyboard } = require('@nut-tree-fork/nut-js'); console.log('OK')"`
- **Hotkey conflicts:** If Chrome has `Ctrl+Shift+T` bound (reopen closed tab), Electron's globalShortcut should take precedence. If not, close Chrome first and re-test.
- **Global hotkeys require focus somewhere:** On some Linux WMs, global shortcuts may not register if no window has focus. Click somewhere first.
- **Quiz page for testing:** The Google Forms quiz at `https://docs.google.com/forms/d/1v2D_IutqUmaV93HZmXERfUKJKDOBFZ_JSKRXlingIw0/preview` has planets (checkbox) and primes (checkbox) questions.

## Typing Test Page

Create `/home/ubuntu/typing-test.html` with a simple text input:
```html
<!DOCTYPE html>
<html><body style="padding: 40px;">
  <h2>Auto-Fill Typing Test</h2>
  <input type="text" style="width: 400px; padding: 12px; font-size: 16px;" placeholder="Answer will appear here..." />
</body></html>
```

## Devin Secrets Needed

- None for desktop app testing (backend is already deployed)
- `FLY_API_TOKEN` only if backend redeploy is needed
