---
name: testing-answersnap
description: End-to-end test the AnswerSnap/Cheatly Chrome extension (double-click answer flow, auto-fill, service-worker wake) and the landing/checkout flow. Use when verifying extension, backend, or landing changes.
---

# Testing AnswerSnap (Cheatly)

## Setup
1. Backend: the extension calls `https://cheatly-backend.fly.dev` (see `BACKEND_URL` in `background.js`). Check it first: `curl https://cheatly-backend.fly.dev/health` should return `{"status":"ok"}`.
2. Running the backend locally (`backend/main.py`, FastAPI):
   - Install deps: `pip install fastapi uvicorn aiosqlite bcrypt PyJWT stripe httpx`
   - Set `DB_PATH` to a writable file (the default `/data/cheatly.db` is unwritable on the box), plus `OPENAI_API_KEY` (secret: `ANSWERSNAP_OPENAI_KEY`), `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `LANDING_URL`.
   - Example: `DB_PATH=/tmp/cheatly.db LANDING_URL=http://localhost:8098 uvicorn main:app --port 8100`
3. Load the extension: `chrome://extensions` → enable Developer mode → Load unpacked → select the repo root (folder containing `manifest.json`).
   - The native folder-picker dialog can be flaky when typing paths: clicking sidebar "Home" then double-clicking through folders (repos → answersnap) and clicking "Open" is the most reliable path. Typing a path with Enter may leave the dialog stuck.
4. Create a simple local quiz page (`file:///.../quiz.html`) with radio groups, checkboxes, and a text input — the content script auto-fills these.

## Test accounts
- Creator account (active subscription, works against the live backend): `creator@cheatly.io` — password provided by the user in-session.
- `devin-pr95@...` style unsubscribed accounts are useful for verifying the paywall/subscribe UI states (popup shows "Start Free Trial" hint only when logged in without a subscription).

## Stripe / checkout testing
- The Stripe keys on the box (`STRIPE_SECRET_KEY`, `STRIPE_SECRET_KEY_NEW`) are **sk_live keys for a different Stripe account** (Manhattan Labs, WePlay-Premium prices) — NOT the Cheatly (Lumini Labs) account. Never complete a payment with them.
- To verify what the Stripe-hosted Checkout page *displays* (trial length, $ due today, first-charge date), you can create a temporary $25/mo price on that account, point the local backend's `STRIPE_PRICE_ID` at it, hit `/checkout`, and inspect the hosted page — then deactivate/archive the temporary price afterwards. Do not enter a card.
- Completing checkout with the `4242 4242 4242 4242` test card requires an sk_test key for the Cheatly account (not currently available as a secret).
- `landing/checkout.html` requires a logged-in landing session (its auth.js hits the live backend) — log in with an unsubscribed account first.

## Key test: inactive service worker
The critical scenario is double-clicking a question while the MV3 service worker is asleep (it idles out after ~30s). On `chrome://extensions` wait until the extension card shows "service worker (Inactive)" (refresh the page to update the label), then double-click a question. A correct implementation wakes the worker (content.js uses `chrome.runtime.connect()` port messaging) and auto-fills the answer in ~5–10s. A broken one shows a "Failed to capture screenshot" toast.

## Assertions
- Correct radio/checkbox/text answer auto-filled near the double-clicked question.
- Previously filled answers preserved (one question answered per double-click).
- No error toasts on the happy path; error states (logged out, no subscription, disabled, timeout) each show a toast.

## Notes
- `Alt+A` toggles the extension; `Escape` closes the overlay. Display modes (invisible/sneaky/homework) are set via the popup.
- No CI workflows exist for runtime behavior — testing must be manual/visual.

## Devin Secrets Needed
- `ANSWERSNAP_OPENAI_KEY` — only if running the backend locally; the deployed Fly.io backend already has a key configured.
- A Cheatly-account `STRIPE_TEST_SECRET_KEY` (sk_test) would enable full checkout completion tests; not currently provisioned.
