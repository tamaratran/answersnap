---
name: testing-landing-site
description: Test the Cheatly landing/marketing site (landing/ directory) locally, including the social-proof purchase toast, onboarding flow, and other static pages. Use when verifying changes to landing/*.html/js/css.
---

# Testing the Cheatly Landing Site

## Running locally
The landing site is fully static — no build step:

```bash
cd /path/to/answersnap/landing
python3 -m http.server 8777
```

Then open `http://localhost:8777/index.html` (or `onboarding.html`, `signup.html`, etc.) in Chrome. Lint with `npm run lint` from the repo root.

CI provides a Vercel preview deployment on PRs — the preview URL appears in PR checks and can be used instead of a local server.

## Social-proof purchase toast (`landing/social-proof.js`)
- Included on `index.html` and `onboarding.html`. First toast ~8s after load, then every 20–45s; each toast is visible for only ~6s.
- Dismissal (× button) sets `sessionStorage.cheatly_sp_dismissed`; the script exits early on load if set. sessionStorage is per-tab — open a new tab to get a fresh state.
- The script also exits early under `prefers-reduced-motion`.

### Testing tips (timing pitfalls)
- The 6s visibility window is shorter than typical screenshot-poll latency, so toasts are easy to miss between screenshots. Check state programmatically via the browser console: `document.querySelector('.sp-toast').classList.contains('sp-visible')` and `.sp-title` text — the last-shown name persists in the DOM even after hiding.
- Clicking the small × within the 6s window via automation is flaky. For dismiss tests, temporarily raise the hide timeout (e.g. `6000` → `30000`) and lower the first-show delay (`8000` → `4000`) in `social-proof.js` — the dismissal logic is unchanged. Revert with `git checkout landing/social-proof.js` afterward and disclose the temporary edit in the test report.
- To verify "stays dismissed": dismiss, confirm the sessionStorage flag is `1`, reload the same tab, and wait past the first-show delay.

## Onboarding demo + success stories (`landing/onboarding.js`)
- Clicking any `.platform-card` (or typing in the platform search and waiting ~800ms) calls `showDemo(platform)`: reveals the animated quiz demo, stats/story cards, and the trial CTA, and advances the 3-step progress indicator.
- The demo is a ~7s timed animation (`runDemo`); the correct option is the one with `data-correct`. A "Replay demo" button appears at the end.
- The story card matching the selected platform is moved to the front of `#stories-grid`; search queries with no matching card leave the order unchanged.
- Don't click "Continue to Free Trial" during tests — it goes to the live Stripe checkout.

## Devin Secrets Needed
None — the landing site is static and needs no credentials. (Backend testing needs `ANSWERSNAP_OPENAI_KEY`; extension store work needs the `TRANJTAMARA_GOOGLE_PASSWORD` secret + SMS 2FA from the user.)
