# Chrome Web Store Listing — AnswerSnap

Use this document when filling out the Chrome Web Store Developer Dashboard.

---

## Extension Name

AnswerSnap — AI Answer Any Question

## Short Description (132 chars max)

Double-click any question on screen to get instant AI-powered answers. Supports multiple choice, fill-in-the-blank, essays, and more.

## Detailed Description

AnswerSnap uses AI vision to give you instant answers to any question on your screen.

**How It Works**
1. Double-click any question on any webpage.
2. AnswerSnap captures the visible page and sends it to GPT-4o for analysis.
3. The answer appears in seconds — in the mode you choose.

**Supported Question Types**
• Multiple choice (single and multi-select)
• Fill-in-the-blank
• Matching
• Short answer
• Essay
• Math, science, history, and more

**Three Display Modes**
• Invisible — Answer is silently copied to your clipboard.
• Sneaky — A tiny dot appears in the corner; hover to reveal the answer.
• Homework — Full overlay panel with the answer displayed.

**Works Everywhere**
Canvas, Blackboard, Google Forms, Coursera, edX, and any other website.

**Keyboard Shortcuts**
• Alt+A — Toggle extension on/off
• Escape — Close the answer overlay

**Your API Key, Your Control**
AnswerSnap requires your own OpenAI API key. Your key is stored locally in your browser and is never sent to any server other than OpenAI. No accounts, no sign-ups, no tracking.

**Privacy First**
• No data collection or analytics
• No external servers beyond the OpenAI API
• Screenshots are processed in real-time and never stored
• Uninstalling removes all data

---

## Category

Productivity

## Language

English

## Privacy Policy URL

Host `privacy-policy.html` from this repo (e.g. on GitHub Pages) and paste the URL during submission. Example:
https://tamaratran.github.io/answersnap/privacy-policy.html

## Single Purpose Description (required by Chrome Web Store)

This extension provides instant AI-generated answers to questions visible on any webpage by analyzing a screenshot of the current tab via the OpenAI API.

## Permission Justifications

| Permission | Justification |
|---|---|
| `activeTab` | Needed to capture a screenshot of the current tab when the user double-clicks a question. |
| `storage` | Needed to store the user's API key and display mode preferences locally. |
| `scripting` | Needed to inject the content script that listens for double-click events on webpages. |
| `host_permissions: <all_urls>` | The content script must run on all websites because questions can appear on any page (LMS platforms, Google Forms, educational sites, etc.). |

## Remote Code Policy

This extension does **not** load or execute any remote code. All JavaScript is bundled in the extension package. The only external network request is to the OpenAI API (`api.openai.com`) for processing screenshots.

## Screenshots (required: 1-5, size: 1280×800 or 640×400)

You will need to provide screenshots showing:
1. The popup settings panel
2. A question being answered in "Homework" mode (full overlay)
3. The "Sneaky" mode dot indicator
4. The extension working on a real quiz/form page

Take these by loading the extension locally and using Chrome's screenshot tools or a screen capture tool.

## Promotional Tile (optional, 440×280)

Create a simple branded tile showing the AnswerSnap logo and tagline: "AI-powered instant answers."
