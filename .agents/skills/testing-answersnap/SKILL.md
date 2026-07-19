---
name: testing-answersnap
description: End-to-end test the AnswerSnap/Cheatly Chrome extension (double-click answer flow, auto-fill, service-worker wake, Web Store version). Use when verifying extension or backend changes.
---

# Testing AnswerSnap / Cheatly

## Two different extension builds — pick the right one
- **Repo (unpacked) build**: `BACKEND_URL = https://answersnap-backend.fly.dev` (old, keyless backend). Load unpacked from the repo root.
- **Chrome Web Store build**: "Cheatly — AI Answer Any Question", id `pgljbingjokidaklhfhndnfofldajafh` (https://chromewebstore.google.com/detail/pgljbingjokidaklhfhndnfofldajafh). Uses `https://cheatly-backend.fly.dev` and REQUIRES login + an active/trialing Stripe subscription. To inspect the published code, download the CRX: `curl -sL -o c.crx "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=126.0&acceptformat=crx3&x=id%3Dpgljbingjokidaklhfhndnfofldajafh%26uc"` then `unzip`.
- The session Chrome (Chrome for Testing) CAN install from the Web Store despite the "Switch to Chrome" banner — just click Add to Chrome.

## Subscription gating on the store build (IMPORTANT)
- `/answer` returns 401 without a JWT (toast "Log in to Cheatly to use this feature") and 403 "Subscription inactive" for registered-but-unsubscribed users (toast "Subscribe to Cheatly to get answers").
- Register via popup Sign Up (any email/password ≥6 chars, no email verification). Fresh accounts get NO trial — trial only starts via live-mode Stripe Checkout ($25/mo, real card). Do NOT submit checkout.
- To unlock the happy path without paying: add the test email to the `WHITELISTED_EMAILS` Fly secret on `cheatly-backend` (whitelisted emails bypass subscription + rate limit), or create a trialing subscription for the user's Stripe customer with the Lumini Labs sk_live key. NOTE: the `STRIPE_SECRET_KEY`/`STRIPE_SECRET_KEY_NEW` Devin secrets belong to "Manhattan Labs, Inc." — the WRONG Stripe account for this backend. Stripe dashboard logins in secrets are 2FA-blocked (TOTP-only). No FLY_API_TOKEN exists; Fly GitHub SSO is blocked by GitHub passkey 2FA.

- A subscribed test account exists: `creator@cheatly.io` (Creator plan, bypasses the paywall) — ask the user for its password if not already provided.
- Google Forms is a good real-world target: use a public quiz form (e.g. the CKAD Knowledge Quiz form) — double-click a question title; radios/checkboxes/text answers auto-fill without needing a Google login. Don't submit third-party forms. Note the AI occasionally auto-clicks a WRONG option — verify answer correctness, not just that something was clicked.
- Typing long URLs char-by-char with computer-use can drop characters; verify the final URL or navigate via `location.href` in the console for setup steps.

## Setup (repo build)
1. Backend health: `curl https://answersnap-backend.fly.dev/health` (or cheatly-backend for the store build) should return `{"status":"ok"}`. If down, run `backend/` locally with `OPENAI_API_KEY` (secret: `ANSWERSNAP_OPENAI_KEY`) and point `BACKEND_URL` at it.
2. Load the extension: `chrome://extensions` → Developer mode → Load unpacked → repo root. The native folder picker is flaky when typing paths: click sidebar "Home" then double-click through folders and click "Open".
3. Quiz page: create a local HTML quiz with radio groups, checkboxes, and a text input. Serve it over HTTP (`python3 -m http.server`) — content scripts do NOT run on `file://` URLs by default (double-click silently does nothing there).

## Key test: inactive service worker
Double-click a question while the MV3 service worker is asleep (idles out after ~30s; chrome://extensions shows "service worker (Inactive)" after refresh). Correct behavior: worker wakes via `chrome.runtime.connect()` and the answer auto-fills in ~5–10s. Broken: "Failed to capture screenshot" toast.

## Assertions
- Correct radio/checkbox/text answer auto-filled near the double-clicked question; previous answers preserved; no error toasts.
- Error toasts auto-hide after ~2.5s — screenshot within ~1–2s of the double-click or you'll miss them. For deterministic capture, poll `document.querySelector('.answersnap-toast')` from the console.

## Notes
- `Alt+A` toggles the extension; `Escape` closes the overlay. Display modes (invisible/sneaky/homework) set via popup (store build shows them only for subscribed accounts).
- No CI workflows for runtime behavior — manual/visual testing only.

## Devin Secrets Needed
- `ANSWERSNAP_OPENAI_KEY` — only if running the backend locally.
- For the store build happy path: a Lumini Labs Stripe sk_live key or `FLY_API_TOKEN` (tamara-tran org), or ask the user to whitelist a test email via `WHITELISTED_EMAILS`.
