# Chrome Web Store Listing — Cheatly

Use this file when filling out the Chrome Web Store Developer Dashboard.

---

## Extension Name
Cheatly

## Short Description (132 chars max)
AI-powered quiz helper. Double-click any question to instantly get the answer. Auto-clicks multiple choice, fills in blanks, and more.

## Detailed Description

Cheatly is an AI-powered Chrome extension that answers quiz questions instantly. Just double-click any question on any webpage — Cheatly screenshots the page, sends it to an AI vision model, and automatically selects the correct answer for you.

**How it works:**
1. Double-click on any quiz question
2. AI analyzes the screenshot in seconds
3. The correct answer is auto-clicked or typed for you

**Supported question types:**
- Multiple choice — auto-clicks the correct radio button
- Multiple select — checks all correct checkboxes
- Fill-in-the-blank — types the answer into the input field
- Short answer / essay — shows the answer in a discreet overlay

**Features:**
- Works on any website (Canvas, Google Forms, Quizlet, W3Schools, etc.)
- No API key needed — just install and go
- 3 display modes: Invisible (clipboard only), Sneaky (tiny dot), Homework (full overlay)
- Keyboard shortcut: Alt+A to toggle on/off
- Fast responses (1-2 seconds)
- Privacy-friendly: screenshots are processed server-side and not stored

**Display Modes:**
- Invisible: Answer copied to clipboard only — nothing visible on screen
- Sneaky: Tiny dot in the corner, hover to reveal the answer
- Homework: Full overlay with the answer displayed

No setup required. Install the extension and start double-clicking questions.

## Category
Productivity

## Language
English

## URLs
- Homepage / official website: https://cheatly.io
- Privacy policy: https://cheatly.io/privacy-policy.html
- Support: https://cheatly.io (or the GitHub repository issues page)

## Assets

| Asset | File | Dimensions |
|-------|------|------------|
| Extension icon (16px) | `icons/icon16.png` | 16x16 |
| Extension icon (48px) | `icons/icon48.png` | 48x48 |
| Extension icon (128px) | `icons/icon128.png` | 128x128 |
| Store icon | `icons/icon128.png` | 128x128 |
| Small promo tile | `store-assets/promo-small-440x280.png` | 440x280 |
| Marquee promo | `store-assets/promo-marquee-1400x560.png` | 1400x560 |
| Screenshot | `store-assets/screenshot-1280x800.png` | 1280x800 |

## Privacy

**Single Purpose Description:**
Cheatly helps users answer quiz questions by analyzing screenshots of quiz pages using AI and automatically selecting or typing the correct answer.

**Permissions Justification:**
- `activeTab`: To capture a screenshot of the current tab when the user double-clicks
- `storage`: To save user preferences (display mode, on/off state)
- `scripting`: To inject the content script that detects double-clicks and auto-clicks answers
- `<all_urls>` host permission: To work on any quiz website the user visits

**Data Usage:**
- Screenshots are sent to our backend server for AI processing
- No user data is stored permanently
- No personal information is collected
- No data is sold to third parties
