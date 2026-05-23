# AnswerSnap

AI-powered Chrome extension that gives you instant answers on any question. Double-click any question on your screen to get the answer.

## Features

- **Double-click to answer** — Double-click any question on any webpage
- **Screenshot + AI Vision** — Captures the visible tab and sends to GPT-4o for analysis
- **Multiple question types** — Multiple choice, multiple select, fill-in-the-blank, matching, short answer, essay
- **3 display modes:**
  - **Invisible** — Answer copied to clipboard, nothing on screen
  - **Sneaky** — Tiny dot in the corner, hover to reveal
  - **Homework** — Full overlay panel with the answer
- **Keyboard shortcut** — `Alt+A` to toggle on/off, `Escape` to close overlay
- **Works everywhere** — Canvas, Blackboard, Google Forms, any website

## Quick Start

### 1. Install the Extension

```bash
git clone https://github.com/tamaratran/answersnap.git
```

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `answersnap` folder (the root with `manifest.json`)

### 2. Configure

1. Click the AnswerSnap extension icon in your toolbar
2. Enter your [OpenAI API key](https://platform.openai.com/api-keys)
3. Choose your display mode
4. Toggle the extension on

### 3. Use It

Navigate to any page with a question. **Double-click** on or near the question. The answer appears in 2-5 seconds.

## Project Structure

```
answersnap/
├── manifest.json          # Chrome Extension manifest (v3)
├── background.js          # Service worker: screenshot capture + AI API
├── content.js             # Content script: double-click listener + overlay
├── content.css            # Overlay and toast styles
├── popup.html             # Extension popup UI
├── popup.js               # Popup settings logic
├── popup.css              # Popup styles
├── privacy-policy.html    # Privacy policy (required for Chrome Web Store)
├── icons/                 # Extension icons (16, 48, 128 px)
├── scripts/               # Build & release tooling
│   ├── pack.js            # Package extension into a ZIP for CWS upload
│   └── bump-version.js    # Bump version across manifest + package.json
├── store/                 # Chrome Web Store listing assets & copy
│   └── LISTING.md         # Store description, permission justifications, etc.
└── landing/               # Marketing landing page
    ├── index.html
    ├── style.css
    └── script.js
```

## How It Works

1. **Content script** (`content.js`) listens for `dblclick` events on any page
2. Sends a message to the **background service worker** (`background.js`)
3. Background captures a screenshot via `chrome.tabs.captureVisibleTab()`
4. Screenshot is sent to the **OpenAI GPT-4o Vision API** with a prompt optimized for question answering
5. The answer is returned to the content script
6. Content script displays the answer based on the selected display mode

## Display Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| Invisible | Answer goes to clipboard only | Maximum stealth |
| Sneaky | Tiny dot, hover to expand | In-person situations |
| Homework | Full overlay panel | Solo studying |

## API Key

You need an OpenAI API key. Get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

Cost is typically a few cents per question (GPT-4o vision pricing).

## Chrome Web Store Submission

### Package the extension

```bash
npm run pack:zip
# Creates dist/answersnap-<version>.zip
```

### Submit to Chrome Web Store

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click **New Item** → upload `dist/answersnap-<version>.zip`
3. Fill in the listing fields using the copy in [`store/LISTING.md`](store/LISTING.md)
4. **Privacy Policy URL** — host `privacy-policy.html` (e.g. via GitHub Pages) and paste the URL
5. Upload 1-5 screenshots (1280×800 or 640×400)
6. **Category**: Productivity
7. Submit for review

### Bump version for updates

```bash
npm run version:bump patch   # 1.0.0 → 1.0.1
npm run version:bump minor   # 1.0.0 → 1.1.0
npm run version:bump major   # 1.0.0 → 2.0.0
```

Then re-run `npm run pack:zip` and upload the new ZIP.

## Landing Page

The `landing/` directory contains a marketing page. To view:

```bash
cd landing
python3 -m http.server 8080
# Open http://localhost:8080
```

## License

MIT
