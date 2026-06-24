# Cheatly Desktop App — MVP Specification

## Overview

A standalone desktop application that replicates the Chrome extension's core functionality (screenshot a question → AI answer → display/auto-fill) but works **inside lockdown browser environments** where Chrome extensions cannot run.

The app uses OS-level APIs to create an invisible overlay window that is physically visible to the user but excluded from all screen capture, recording, and sharing — making it undetectable by proctoring software.

---

## Goals

### MVP (v1.0)
1. User presses a global hotkey → app captures the screen
2. Screenshot is sent to the existing backend (`answersnap-backend.fly.dev/answer`)
3. AI answer is displayed in an invisible overlay window
4. The overlay is excluded from all screen capture/recording
5. Works on **Windows 10 v2004+** (primary target)
6. Stealth: generic process name, no taskbar icon, no system tray

### Post-MVP
- macOS support (requires private API workarounds for macOS 15+)
- Region selection (snip tool) instead of full-screen capture
- Auto-fill mode (simulate keyboard input to type answers)
- On-device AI fallback for environments that block internet (ExamSoft)
- Account/subscription integration (same accounts as Chrome extension)

---

## Current Chrome Extension Functionality (What We're Replicating)

| Feature | Chrome Extension | Desktop App Equivalent |
|---------|-----------------|----------------------|
| Trigger | Double-click question text | Global hotkey (Ctrl+Shift+A) |
| Screenshot | `chrome.tabs.captureVisibleTab()` (JPEG q80) | Native screen capture (full screen or region) |
| AI Backend | POST to `/answer` with screenshot + selectedText | Same — POST to `/answer` with screenshot |
| Answer Display | Auto-fills MC/checkboxes/text inputs on page | Overlay window showing the answer text |
| Auto-Fill | Clicks radio buttons, checkboxes, types in inputs | Phase 2: simulate keyboard/mouse input |
| Toggle | Alt+A keyboard shortcut | Hotkey to show/hide overlay |
| Prompt | Identifies question nearest to double-click | Sends full screen — AI identifies visible question |

### Key Differences from Extension

1. **No DOM access** — the desktop app cannot read or manipulate the page DOM. It can only see pixels (screenshots). This means:
   - No auto-clicking radio buttons or checkboxes
   - No auto-filling text inputs
   - The user reads the answer from the overlay and manually selects/types it
   - Phase 2 can add simulated keyboard input (type the answer via OS-level keystrokes)

2. **No "nearest question" context** — without knowing where the user clicked, the AI sees the full screen. The prompt must be adjusted to answer ALL visible questions or let the user select a region.

3. **Works anywhere** — not limited to Chrome. Works inside Respondus, ExamSoft, SEB, or any application.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User's Desktop                           │
│                                                             │
│  ┌──────────────────────┐     ┌──────────────────────────┐ │
│  │   Lockdown Browser   │     │   Cheatly Desktop App    │ │
│  │   (Respondus/SEB/    │     │   (Electron)             │ │
│  │    ExamSoft)          │     │                          │ │
│  │                      │     │  ┌────────────────────┐  │ │
│  │   ┌──────────────┐  │     │  │  Invisible Overlay │  │ │
│  │   │  Exam Page   │  │     │  │  (answer display)  │  │ │
│  │   │  with        │  │     │  │                    │  │ │
│  │   │  questions   │  │     │  │  WDA_EXCLUDE...    │  │ │
│  │   └──────────────┘  │     │  └────────────────────┘  │ │
│  └──────────────────────┘     │                          │ │
│                               │  Global Hotkey Listener  │ │
│                               │  Screen Capture Engine   │ │
│                               └──────────┬───────────────┘ │
└──────────────────────────────────────────┼─────────────────┘
                                           │
                                           │ HTTPS POST /answer
                                           │ (screenshot JPEG)
                                           ▼
                              ┌──────────────────────────┐
                              │  answersnap-backend      │
                              │  (Fly.io)                │
                              │                          │
                              │  OpenAI GPT-4o Vision    │
                              └──────────────────────────┘
```

---

## Technology Choice: Electron

### Why Electron (not Tauri)

| Factor | Electron | Tauri |
|--------|----------|-------|
| `setContentProtection` | Built-in, one-liner | Built-in, one-liner |
| Language | JavaScript/TypeScript (same as extension) | Rust backend + JS frontend |
| Development speed | Fast — familiar stack | Slower — Rust learning curve |
| Binary size | ~150MB (includes Chromium) | ~5-10MB |
| Process detectability | Chromium process tree (fixable) | Lightweight native process |
| Windows support | Excellent | Excellent |
| macOS support | Good (with caveats on 15+) | Same caveats |
| `globalShortcut` | Built-in API | Built-in API |
| Screen capture | `desktopCapturer` or native | Requires plugin |

**Decision:** Electron for MVP (speed of development with familiar JS stack). Consider migrating to Tauri post-MVP for smaller binary and better stealth.

---

## Core Components

### 1. Main Process (`main.js`)

Responsibilities:
- Create the invisible overlay `BrowserWindow`
- Register global hotkeys
- Capture screenshots
- Send to backend
- Manage stealth properties (process name, taskbar, etc.)

```javascript
// Pseudocode — main.js
const { app, BrowserWindow, globalShortcut, screen, desktopCapturer } = require('electron');
const path = require('path');

let overlayWindow = null;

app.whenReady().then(() => {
  createOverlayWindow();
  registerHotkeys();
});

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 400,
    height: 300,
    x: 50,               // Position in corner
    y: 50,
    frame: false,         // No title bar
    transparent: true,    // Transparent background
    alwaysOnTop: true,    // Always visible above lockdown browser
    skipTaskbar: true,    // Not in taskbar
    focusable: false,     // Don't steal focus from exam
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // THE KEY LINE — makes window invisible to screen capture
  overlayWindow.setContentProtection(true);
  
  // Don't show in Alt+Tab
  overlayWindow.setSkipTaskbar(true);
  
  // Click-through when not interacting
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  
  overlayWindow.loadFile('overlay.html');
  overlayWindow.hide(); // Hidden until hotkey pressed
}

function registerHotkeys() {
  // Main trigger: capture + answer
  globalShortcut.register('CommandOrControl+Shift+A', async () => {
    await captureAndAnswer();
  });
  
  // Toggle overlay visibility
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();
    }
  });
  
  // Emergency hide (instant vanish)
  globalShortcut.register('CommandOrControl+Shift+E', () => {
    overlayWindow.hide();
  });
}

async function captureAndAnswer() {
  // 1. Capture the primary display
  const screenshot = await captureScreen();
  
  // 2. Show loading state in overlay
  overlayWindow.show();
  overlayWindow.webContents.send('loading');
  
  // 3. Send to backend
  const answer = await queryBackend(screenshot);
  
  // 4. Display answer
  overlayWindow.webContents.send('answer', answer);
}
```

### 2. Screen Capture

**Approach:** Use `screenshot-desktop` or native screenshot (not `desktopCapturer`) because:
- `desktopCapturer` requires user permission dialogs
- We need the screen content WITHOUT our overlay (content protection handles this automatically)
- Native screenshot via `robotjs` or `screenshot-desktop` is simpler

```javascript
const screenshot = require('screenshot-desktop');

async function captureScreen() {
  // Captures the screen as a Buffer (PNG/JPEG)
  // Our overlay window is automatically excluded due to setContentProtection
  const imgBuffer = await screenshot({ format: 'jpg' });
  const base64 = imgBuffer.toString('base64');
  return `data:image/jpeg;base64,${base64}`;
}
```

**Alternative (region capture):** For post-MVP, add a "snip" mode where user drags to select a region (like Windows Snipping Tool), then only that region is sent to AI.

### 3. Backend Communication

Reuses the exact same endpoint the Chrome extension uses:

```javascript
async function queryBackend(screenshotDataUrl) {
  const response = await fetch('https://answersnap-backend.fly.dev/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      screenshot: screenshotDataUrl,
      selectedText: '', // No selected text in desktop mode
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Error: ${response.status}`);
  }

  const data = await response.json();
  return data.answer;
}
```

### 4. Overlay UI (`overlay.html`)

Minimal, dark, semi-transparent overlay showing the AI answer:

```html
<!-- overlay.html -->
<div id="app">
  <div id="header">
    <span class="drag-handle">⠿</span>
    <span class="title">Cheatly</span>
    <button id="close-btn">×</button>
  </div>
  <div id="content">
    <div id="loading" class="hidden">Thinking...</div>
    <div id="answer"></div>
  </div>
</div>
```

Styling: dark semi-transparent background (rgba(20, 20, 30, 0.92)), white text, small font, rounded corners. Draggable via header. User can resize and position it wherever they want on screen.

### 5. Stealth Features

```javascript
// In package.json — set the executable name
{
  "name": "system-service-host",  // Generic process name
  "productName": "System Service Host",
  ...
}

// In main.js
app.on('ready', () => {
  // Hide from dock (macOS)
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
  
  // No tray icon by default
  // Window is skipTaskbar: true
  // No Alt+Tab entry (handled by OS flags)
});
```

---

## User Flow

### First Launch
1. User downloads `CheatlyDesktop-Setup.exe` from website
2. Runs installer (or portable .exe — no install needed)
3. App starts silently — no visible window, no tray icon
4. Small first-time tooltip explains hotkeys, then disappears

### During Exam
1. Lockdown browser launches and locks the screen
2. User presses **Ctrl+Shift+A**
3. Screen is captured (overlay excluded automatically)
4. "Thinking..." appears in overlay (top-left corner by default)
5. Answer appears in overlay within 2-4 seconds
6. User reads the answer and manually selects it in the exam
7. User presses **Ctrl+Shift+H** to hide overlay, or **Ctrl+Shift+E** for emergency hide

### Hotkeys

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Capture screen + get answer (main action) |
| `Ctrl+Shift+H` | Toggle overlay visibility |
| `Ctrl+Shift+E` | Emergency hide (instant vanish, no animation) |
| `Ctrl+Shift+Q` | Quit the app entirely |

---

## Stealth Measures (MVP)

| Measure | Implementation |
|---------|---------------|
| Invisible to screen capture | `win.setContentProtection(true)` → `WDA_EXCLUDEFROMCAPTURE` |
| No taskbar presence | `skipTaskbar: true` |
| No Alt+Tab entry | Frameless + skipTaskbar + tool window style |
| Generic process name | Rename executable to "System Service Host.exe" |
| No system tray icon | No `Tray` instance created |
| No desktop shortcut | Portable app or hidden install location |
| Emergency hide | Ctrl+Shift+E instantly hides, no animation |
| No file traces | No log files, no cache, no registry entries |

---

## Backend Changes Required

**None for MVP.** The existing `/answer` endpoint already accepts a screenshot and returns an answer. The desktop app sends the exact same payload as the Chrome extension.

The only difference: the Chrome extension sends `selectedText` (the double-clicked text) which helps the AI identify which question to answer. The desktop app won't have this context, so the AI will answer the most prominent visible question. This is fine for most exam scenarios (one question visible at a time).

**Post-MVP enhancement:** Adjust the prompt for desktop mode to say "Answer all visible questions" and return a numbered list, or add region selection so the user can highlight which question they want answered.

---

## File Structure

```
desktop/
├── package.json
├── main.js              # Electron main process
├── preload.js           # IPC bridge
├── renderer/
│   ├── overlay.html     # Overlay UI
│   ├── overlay.css      # Styling
│   └── overlay.js       # Renderer logic
├── lib/
│   ├── capture.js       # Screen capture utilities
│   ├── backend.js       # API communication
│   └── stealth.js       # Stealth configuration
├── assets/
│   └── icon.ico         # App icon
├── build/
│   └── installer.nsh    # NSIS installer config (Windows)
└── electron-builder.yml # Build configuration
```

---

## Dependencies

```json
{
  "dependencies": {
    "electron": "^33.x",
    "screenshot-desktop": "^1.15.0"
  },
  "devDependencies": {
    "electron-builder": "^25.x"
  }
}
```

Minimal dependency tree — only Electron + one native screenshot package.

---

## Build & Distribution

### Windows (primary)
- Build with `electron-builder` targeting NSIS installer or portable .exe
- Rename output executable to generic name
- No code signing for MVP (may trigger Windows SmartScreen — acceptable for early users)
- Post-MVP: purchase Authenticode certificate (~$200/yr) to suppress SmartScreen

### macOS (post-MVP)
- `setContentProtection` works against most capture on macOS ≤14
- macOS 15+ broke this (ScreenCaptureKit ignores the flag)
- Competitors (LDBypass) use private WindowServer APIs — would need to research
- Could also use a Tauri build for macOS (smaller, less detectable)

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Respondus adds our process to blacklist | Medium | Generic process name + can rename per-release |
| Windows SmartScreen blocks unsigned exe | Medium | Instruct users to click "Run anyway"; sign post-MVP |
| macOS 15+ breaks content protection | High (macOS only) | Focus on Windows first; research private APIs later |
| Antivirus flags stealth behavior | Medium | Submit to AV vendors for whitelisting; sign binary |
| Backend rate limiting under load | Low | Same infrastructure as extension — already scaled |
| User's firewall blocks HTTPS to backend | Low | Most lockdown browsers allow HTTPS (only ExamSoft blocks all internet) |

---

## Development Timeline

### Week 1: Core Functionality
- [ ] Electron project setup with TypeScript
- [ ] `BrowserWindow` with `setContentProtection(true)`
- [ ] `globalShortcut` registration (Ctrl+Shift+A, H, E, Q)
- [ ] Screen capture via `screenshot-desktop`
- [ ] Backend API integration (POST /answer)
- [ ] Basic overlay UI (display answer text)

### Week 2: Stealth & Polish
- [ ] Process name customization
- [ ] skipTaskbar + no Alt+Tab
- [ ] Emergency hide behavior
- [ ] Draggable/resizable overlay
- [ ] Loading state + error handling
- [ ] Multiple-answer display (formatted list)

### Week 3: Build & Test
- [ ] electron-builder config for Windows portable + installer
- [ ] Test against Respondus LockDown Browser
- [ ] Test against Proctorio (Chrome extension proctoring)
- [ ] Test screen capture exclusion (verify overlay doesn't appear in recordings)
- [ ] Performance optimization (startup time, capture speed)

---

## Testing Plan

### Functional Tests
1. **Hotkey works globally** — press Ctrl+Shift+A while lockdown browser is focused → capture triggers
2. **Screen capture** — captured image contains the exam content, NOT the overlay
3. **Backend response** — answer displays correctly in overlay
4. **Overlay positioning** — draggable, stays on top, doesn't steal focus
5. **Emergency hide** — Ctrl+Shift+E instantly hides, no trace

### Stealth Tests
1. **Screen recording** — record screen with OBS/Zoom → overlay NOT visible in recording
2. **Respondus LockDown Browser** — install and run alongside → no "blocked application" warning
3. **Proctorio** — start proctored exam with Proctorio active → overlay not visible in screen share
4. **Task Manager** — process appears with generic name, no suspicious indicators
5. **Alt+Tab** — overlay does NOT appear in Alt+Tab switcher

### Integration Tests
1. **Full flow** — Respondus exam active → Ctrl+Shift+A → answer appears in overlay → user selects correct answer
2. **Multiple questions** — capture shows multiple questions → AI answers the most prominent one
3. **Error handling** — backend timeout → graceful error message in overlay
4. **Rapid usage** — press hotkey multiple times quickly → no crashes, latest answer wins

---

## Comparison: Extension vs Desktop App

| Aspect | Chrome Extension | Desktop App |
|--------|-----------------|-------------|
| **Works in lockdown browsers** | No | Yes |
| **Auto-fills answers on page** | Yes (clicks/types) | No (user reads + manually enters) |
| **Trigger mechanism** | Double-click text | Global hotkey |
| **AI context** | Selected text + screenshot | Screenshot only |
| **Visibility** | Has Chrome extension icon | Completely invisible |
| **Install friction** | Chrome Web Store | Download exe from website |
| **Update mechanism** | Chrome auto-update | Manual or auto-updater |
| **Platform** | Any Chrome browser | Windows (MVP), macOS (later) |
| **Detection risk** | Medium (extension visible in chrome://extensions) | Very low (invisible process + window) |

---

## Open Questions for Post-MVP

1. **Subscription gating** — How to verify the user has a valid Cheatly subscription before the desktop app works? Options: login flow in overlay, license key, device fingerprint.
2. **Auto-fill via simulated input** — Should the app type answers using simulated keystrokes? This would make it functionally equivalent to the extension but risks detection if lockdown browsers monitor input devices.
3. **Region selection** — Should we add a snip tool (drag to select area) for better AI accuracy? Or is full-screen capture good enough?
4. **macOS strategy** — Wait for Apple to stabilize APIs, or invest in private API research now?
5. **Mobile companion** — Build a phone app as a second-device alternative? Different product or same subscription?
