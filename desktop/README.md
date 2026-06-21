# Cheatly Desktop

Standalone desktop app that works inside lockdown browser environments (Respondus, ExamSoft, SEB, Proctorio, Honorlock).

Uses an invisible overlay window that is excluded from all screen capture, recording, and sharing via OS-level APIs.

## How It Works

1. Press **Ctrl+Shift+A** — captures your screen
2. Screenshot sent to AI backend (same as the Chrome extension)
3. Answer appears in an invisible overlay (only you can see it)
4. Proctoring software sees nothing

## Hotkeys

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Capture screen + get answer |
| `Ctrl+Shift+T` | Type answer into focused field (auto-fill) |
| `Ctrl+Shift+H` | Show/hide overlay |
| `Ctrl+Shift+E` | Emergency hide (instant) |
| `Ctrl+Shift+Q` | Quit |

## Auto-Fill

When you get an answer:
1. It's automatically **copied to clipboard** (just Ctrl+V to paste)
2. Press **Ctrl+Shift+T** to **type it directly** into whatever text field is focused (simulates keystrokes)

For multiple choice questions, read the answer from the overlay and click the option yourself.

## Development

```bash
cd desktop
npm install
npm start
```

## Build

```bash
# Windows installer + portable
npm run build:win

# macOS
npm run build:mac
```

Output goes to `desktop/dist/`.

## Stealth Features

- Window invisible to screen capture (`SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`)
- No taskbar icon
- No Alt+Tab entry
- Generic process name ("System Service Host")
- No system tray icon
- No log files or registry entries
- Emergency hide hotkey (instant vanish)

## Requirements

- Windows 10 v2004+ (build 19041+) for full capture exclusion
- macOS 14+ (partial — macOS 15+ has ScreenCaptureKit limitations)
- Internet connection to reach the AI backend
