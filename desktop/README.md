# AnswerSnap Desktop

A cross-platform desktop study assistant. Double-click any question on your screen, get an AI answer, and copy or type it into your work.

Works in normal browsers, PDF readers, IDEs, and other desktop applications. It does **not** work in or against proctored or lockdown exam environments.

## How It Works

1. **Double-click** a question text on your screen (or press **Ctrl+Shift+A**).
2. The app captures the screen and sends it to your chosen AI backend.
3. The AI returns an answer.
4. You decide what to do with it:
   - **Ctrl+Shift+C** — copy the answer
   - **Ctrl+Shift+T** — type it into the focused field
   - **Ctrl+Shift+H** — show/hide the answer window

The answer window stays hidden by default. Nothing happens automatically unless you press a shortcut or click a button.

## Hotkeys

| Shortcut | Action |
|----------|--------|
| Double-click | Capture screen + get answer |
| `Ctrl+Shift+A` | Capture screen + get answer |
| `Ctrl+Shift+C` | Copy the last answer to clipboard |
| `Ctrl+Shift+D` | Toggle double-click-to-answer mode |
| `Ctrl+Shift+T` | Type the last answer into the focused field |
| `Ctrl+Shift+H` | Show/hide the answer window |
| `Ctrl+Shift+E` | Hide the answer window |
| `Ctrl+Shift+Q` | Quit |

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

## Terms of Service

Use of AnswerSnap is governed by the [Terms of Service](../../TERMS_OF_SERVICE.md). By using the app, you agree that it is for personal study and unproctored homework only and may not be used in proctored, supervised, or lockdown exam environments.
