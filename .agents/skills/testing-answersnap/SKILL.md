---
name: testing-answersnap
description: Test the AnswerSnap Chrome extension end-to-end on Google Forms. Use when verifying auto-fill, service worker reliability, or backend integration changes.
---

# Testing AnswerSnap Chrome Extension

## Overview
AnswerSnap is a Chrome extension (Manifest V3) that auto-fills quiz answers via GPT-4o Vision. Double-click a question → screenshot captured → sent to backend → answer auto-filled on page.

## Devin Secrets Needed
- `ANSWERSNAP_OPENAI_KEY` — OpenAI API key (set as Fly.io secret on backend, NOT needed in extension)

## Architecture
- **Content script** (`content.js`): Handles dblclick events, sends messages to service worker via `chrome.runtime.connect()` (port-based messaging)
- **Service worker** (`background.js`): Captures screenshots via `chrome.tabs.captureVisibleTab()`, routes requests to backend
- **Backend**: FastAPI on Fly.io (`answersnap-backend.fly.dev`), holds OpenAI API key server-side
- **Popup** (`popup.html/js`): Toggle enable/disable, display mode selector. Uses `chrome.runtime.sendMessage()` (different path from content script)

## Test Environment Setup
1. Extension should be loaded as unpacked in `chrome://extensions` from the repo directory
2. Developer mode must be ON in chrome://extensions
3. After loading/reloading, the service worker link appears under the extension card

## Key Test: Service Worker Inactivity
The most critical test scenario is verifying the extension works when the MV3 service worker is **inactive** (asleep). Chrome puts the SW to sleep after ~30 seconds of no activity.

### How to test:
1. Reload the extension in `chrome://extensions`
2. Navigate to a Google Form quiz
3. **Wait 40+ seconds** without interacting with the extension
4. Check `chrome://extensions` — the service worker link should say **(Inactive)**
5. Go back to the form and double-click a question
6. If the fix works: answer auto-fills silently. If broken: "Failed to capture screenshot" error appears.

### Why this matters:
- `chrome.runtime.sendMessage()` fails silently when SW is asleep — this was the root cause of the user's "fail to capture screenshot" bug
- `chrome.runtime.connect()` (port-based) always wakes the SW, even from fully inactive state
- **Do NOT click the "service worker" link** in chrome://extensions before testing — this wakes the SW and keeps it alive via DevTools, defeating the test

## Test Form
Pop Quiz Google Form: `https://docs.google.com/forms/d/e/1FAIpQLSfAekuJyZhgJgjh5n1pTIwvuYy-g4yg-nWF4L5BgIwjMWtclw/viewform`

Question types:
- Q1: Radio buttons ("What's 6+7?" → answer: 11)
- Q2: Radio buttons (derivative question)
- Q3: Checkboxes ("Which organelles..." → Nucleus, Ribosome)
- Q4: Short text input ("What sound does a dog make?" → Bark)

## Testing Checklist
1. Clear all form answers before testing (scroll to bottom → "Clear form")
2. Test each question type independently via double-click
3. Verify no cross-question pollution (filling Q3 shouldn't change Q1/Q2)
4. Verify no error toasts appear
5. Test popup opens and shows toggle + display mode (regression)
6. For service worker tests: always verify SW shows "(Inactive)" BEFORE double-clicking

## Common Issues
- **"Failed to capture screenshot"**: Service worker was asleep and messaging failed. Should be fixed by port-based messaging.
- **"API key not set"**: Old code on main branch. Pull latest main which routes through backend.
- **Answer goes to wrong question**: Proximity matching bug. Check `findNearestGroup()` in content.js.
- **Checkbox not checked**: The AI might return text that doesn't fuzzy-match the checkbox labels. Check fuzzy matching logic.
- **First double-click fails after fresh install**: Storage is wiped on reinstall. Extension should work immediately since API key is server-side now.

## Recording Tips
- Always start recording AFTER the service worker goes inactive and you've verified it
- Show chrome://extensions with "(Inactive)" status as proof before testing
- Annotate each question fill as a separate test
- Show all 4 questions filled at end by scrolling through the form
