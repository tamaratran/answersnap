---
name: testing-stripe-checkout
description: Test the Cheatly (formerly AnswerSnap) Stripe checkout flow end-to-end (landing page Get Started -> Stripe Checkout). Use when verifying checkout, pricing, landing-page, or backend /checkout changes.
---

# Testing the Cheatly Stripe Checkout

## Architecture
- Landing page (`landing/`, deployed via Vercel project "answersnap", prod: https://cheatly.xyz, also https://answersnap.vercel.app). PRs get preview URLs in the Vercel bot PR comment.
- Vercel preview URLs may return 401 to curl (deployment protection). Workaround: drive the session Chrome via Playwright over CDP (`chromium.connect_over_cdp("http://localhost:29229")`, then `b.contexts[0]`) — it inherits the browser's Vercel auth. Useful for asserting meta tags or residual-text checks programmatically.
- The landing checkout CTAs ("Try Free for 7 Days" / "Get Started") link to `/checkout` on the backend (`backend/main.py`), which creates a Stripe Checkout Session (7-day free trial) via the Stripe REST API and 303-redirects to checkout.stripe.com.
- **Two DISTINCT Fly apps (do not assume they're the same — they diverged):**
  - `cheatly-backend.fly.dev` = **canonical / active**, runs current code (has `/auth/me`, `/auth/cancel`, `/webhook/stripe`, `/checkout/session`). The extension, account page, download page, and webhook all use it. `backend/fly.toml` `app` = `cheatly-backend` (as of PR #71).
  - `answersnap-backend.fly.dev` = **stale/old** app running old code (those newer routes 404). Historically the site's checkout CTAs pointed here, whose `success_url` LACKED `session_id` — silently breaking post-payment account creation + the browser Purchase pixel. PR #71 repointed all CTAs to cheatly-backend.
  - Quick way to tell which app a host runs: `curl -s -o /dev/null -w '%{http_code}' https://<host>/auth/me` → 401 = current code, 404 = stale.
- Backend env (Fly secrets on `cheatly-backend`): `STRIPE_SECRET_KEY` (Lumini sk_live), `STRIPE_PRICE_ID` (must be the $25/mo `price_1TlX3E…`, NOT the old weekly `price_1ThMQz…`), `LANDING_URL`, `STRIPE_WEBHOOK_SECRET`, plus Meta/TikTok tracking secrets.

## Quick verification (shell)
```
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://cheatly-backend.fly.dev/checkout
```
Expect `303 https://checkout.stripe.com/...cs_live_...`. A 500 with "Stripe not configured" means Fly secrets are missing. To confirm the PRICE without paying: grab the `cs_live_...` id from the redirect and query `GET /v1/checkout/sessions/<id>/line_items` with the Lumini key → price should be $25.00/month (`price_1TlX3E…`), not $9.99/week.

**UI gotcha:** the Stripe checkout page geolocates and may default to a local currency (e.g. AED 95.48 ≈ $25). Click the **USD** currency toggle to assert "$25.00 per month" cleanly.

## UI test (record this)
1. Open the Vercel preview (or prod) landing page; click "Get Started" (hero or pricing section CTA) → goes to `onboarding.html`. Select a platform and click "Continue to Free Trial".
2. Assert the Stripe page shows "Try Cheatly Pro", "7 days free", "$25.00 per month", "Total due today $0.00", and merchant "Lumini Labs, LLC".
3. Assert the submit button reads "Start trial" (not "Subscribe" or "Pay").
4. Click the merchant back link; assert return to landing with `?checkout=cancelled`.
5. Do NOT submit the payment form — the Stripe account is in LIVE mode; a real card would be charged.

## Post-checkout download page (since PR #47)
- After successful Stripe payment, users are redirected to `/download.html` (previously `/?checkout=success`).
- The download page has: "You're In" badge, "Install Cheatly" heading, download button for `cheatly-extension.zip` (~25 KB), 3-step load-unpacked instructions, and a quick-start section (Double-Click + Alt+A).
- The ZIP is a pre-built bundle of the extension files (11 files matching `scripts/pack.js` includeFiles). When extension code changes, the ZIP must be rebuilt: `node scripts/pack.js && cp dist/cheatly-*.zip landing/cheatly-extension.zip`.
- To test: navigate directly to `preview-url/download.html`, click the download button, extract the ZIP, and load unpacked at `chrome://extensions`. Verify the extension card shows "Cheatly — AI Answer Any Question" with no errors.
- The actual Stripe checkout → redirect to `/download.html` is untestable without a real payment (live mode). Verify the `success_url` code change in `backend/main.py` via diff.

## Onboarding platform selection page (since PR #53)
- Some landing page CTAs say "Get Started" and link to `onboarding.html`, but the hero/pricing/sticky "Try Free for 7 Days" CTAs in `index.html` currently link DIRECTLY to `cheatly-backend.fly.dev/checkout` (verify per-PR — the flow has changed back and forth).
- Flow (onboarding variant): Landing page "Get Started" → `onboarding.html` (platform selection) → "Continue to Free Trial" → Stripe Checkout.
- `onboarding.html` shows a grid of 12 platform cards: Canvas, Blackboard, Google Forms, Google Classroom, Quizlet, Moodle, Kahoot, Coursera, Khan Academy, McGraw-Hill, Pearson MyLab, D2L Brightspace.
- Clicking a card: green border + checkmark badge animates in (popIn 0.4s), CTA section appears with "[Platform] — Supported with 100% accuracy" and "Continue to Free Trial" button.
- Clicking a different card: previous deselects, new one selects, CTA text updates.
- Search/type-in field below grid: type a custom platform name → "Checking compatibility..." spinner (800ms) → green checkmark + "[Platform] — Supported with 100% accuracy" → CTA appears.
- "Continue to Free Trial" button links to the backend `/checkout` (now `cheatly-backend.fly.dev/checkout`).
- Progress indicator at top: step 1 (active) → step 1 (checkmark) + step 2 (active) after selection.
- Platform cards use branded SVG logos (`landing/logos/*.svg`) with distinct brand colors (e.g. Canvas red, Blackboard dark, Quizlet blue). These replaced the old generic monochrome outline SVGs. The `.platform-icon` CSS no longer has `background: var(--accent-glow)` — logos carry their own color.
- The landing page "Works On:" trust bar (`index.html`) also shows small (18x18) logos inline with platform names using `display: inline-flex` + `gap: 5px`. "Any Website" remains text-only.
- Files: `landing/onboarding.html`, `landing/onboarding.css`, `landing/onboarding.js`, `landing/logos/*.svg`.

## Testing onboarding flow checklist
1. Verify the landing page CTAs link where the PR intends (either `onboarding.html` or directly to `cheatly-backend/checkout`)
2. Click "Get Started" → onboarding page loads with 12 platform cards + search field
3. Click a platform card (e.g. Canvas) → green border, checkmark, CTA with "Canvas — Supported with 100% accuracy"
4. Click a different card (e.g. Kahoot) → previous deselects, CTA updates
5. Type custom platform in search → spinner appears → checkmark + "Supported with 100% accuracy"
6. "Continue to Free Trial" button → navigates to Stripe checkout
7. Progress indicator updates correctly (step 1 checkmark, step 2 active)

## Landing-page conversion elements (since PR #29, updated PR #49, PR #53)
- The landing page `#pricing` section shows: "50% Off — Limited Time" urgency badge (gold/yellow, with pulse animation), "$50" strikethrough anchor price before "$25/month", trial messaging ("Try free for 7 days — cancel anytime before your trial ends"), CTA, and "No charge for 7 days" trust line.
- The hero section has a "100% Accuracy" green pill badge between the heading and subtitle, plus the primary CTA.
- A sticky bottom CTA bar (position:fixed, z-index:99) with "Start Free Trial — 7 Days Free" text and a button is always visible at the bottom of the viewport. It persists through full page scroll. The footer has extra bottom padding (80px) so it's not hidden behind the bar.
- The backend adds `subscription_data[trial_period_days]=7` to the Stripe checkout session, so Stripe renders trial-specific UI ("7 days free", "$0.00 due today", "Start trial" button).
- The backend `cancel_url`/`success_url` point at the PROD `LANDING_URL` (https://cheatly.xyz), so cancelling checkout from a Vercel preview returns to PROD, not the preview. Expected behavior — and note PROD may still show old CTA hrefs until the PR merges.
- On mobile (max-width 768px), the sticky CTA bar hides the text and shows only the full-width button.

## Testing conversion elements checklist
When testing landing page conversion changes, verify:
1. Hero "100% Accuracy" green badge between heading and subtitle
2. Pricing badge reads "50% Off — Limited Time" with pulse animation
3. "$50" strikethrough appears before "$25/month" in pricing
4. Sticky CTA bar stays fixed at bottom through all sections
5. Sticky CTA button links to the intended target
6. Footer text fully visible above sticky bar (not hidden behind it)
7. Compare preview vs production to confirm changes are isolated to the PR

## GA4 Analytics tracking (since PR #54)
- GA4 (Google Analytics 4) is added to all 3 landing pages: `index.html`, `onboarding.html`, `download.html`.
- Measurement ID: `G-CF2V24H2RE`. The gtag.js snippet is in the `<head>` of each page.
- Custom events tracked:
  - `click_get_started` with `cta_location` parameter (`hero`, `pricing`, `sticky_bar`) — fired on CTA clicks on index.html.
  - `click_continue_trial` with `cta_location=onboarding` — fired on "Continue to Free Trial" click on onboarding.html.
  - `page_view` — automatic on every page load.
- Footer padding is scoped via `.has-sticky-cta` body class: index.html has `padding-bottom: 80px` (sticky bar present), download.html and onboarding.html have default `padding-bottom: 32px` (no sticky bar).
- GA4 dashboard: https://analytics.google.com/analytics (Cheatly property under tranjtamara@gmail.com).

## Testing GA4 events checklist
Best approach: use Playwright via CDP to intercept `google-analytics.com/g/collect` requests programmatically. Filter captured URLs for event name (`en=`) and custom params (`ep.cta_location=`).
1. Navigate to index.html → verify `en=page_view` collect request fires with `tid=G-CF2V24H2RE`
2. Click hero CTA → verify `en=click_get_started` with `cta_location=hero`
3. Click pricing CTA → verify `en=click_get_started` with `cta_location=pricing`
4. Click sticky bar CTA → verify `en=click_get_started` with `cta_location=sticky_bar`
5. Navigate to onboarding.html, select platform, click "Continue to Free Trial" → verify `en=click_continue_trial` with `cta_location=onboarding`
6. Check footer padding on download.html: `getComputedStyle(footer).paddingBottom === '32px'`
7. Check footer padding on index.html: `getComputedStyle(footer).paddingBottom === '80px'`

**Tip:** Chrome DevTools Network tab filtered for `google-analytics` works for manual inspection but events may show as "(cancelled)" when the click triggers navigation. Playwright CDP request interception captures the request URL even if it's cancelled, making it more reliable. Enable "Preserve log" in Network tab if testing manually.

## Branding (since PR #32)
- The site is branded "Cheatly" on the cheatly.xyz domain; the page title/og tags/share image should all say Cheatly. Internal repo identifiers may still say "answersnap"; the backend now lives at `cheatly-backend.fly.dev`.
- Product copy in Stripe (name/description) is live config edited via the Stripe API, not code; check it separately when testing rebrand-type changes.

## Fly.io deploy notes
- The backend lives under the Fly account `${DELTA_LOGIN_EMAIL}`, accessed via "Sign in with GitHub" (GitHub user `tamaratran`, already signed in to the session browser). The Google login `tranjtamara@gmail.com` creates a DIFFERENT, empty Fly account — don't use it.
- Org tokens can be created at https://fly.io/dashboard/tamara-tran/tokens (value shown once; copy from the dialog).
- Deploy: `export PATH="$HOME/.fly/bin:$PATH"; export FLY_API_TOKEN=...; cd backend && flyctl deploy --app cheatly-backend --remote-only`. flyctl may need installing (`curl -L https://fly.io/install.sh | sh`). `backend/fly.toml` now targets `cheatly-backend`, so a plain `flyctl deploy` from `backend/` also hits the right app.
- `flyctl auth whoami` hangs interactively if unauthenticated — set `FLY_API_TOKEN` first.

## Stripe notes
- Account: Lumini Labs, LLC (login tamarajtran9@gmail.com; 2FA via user's Authy — codes last 30s, be at the input before requesting one).
- Product "Cheatly Pro" (prod_UgjuJkIaHmWJUt).
- Current price: price_1TlX3EACGCy0Kx8oCr9JVegl ($25/month with 7-day free trial).
- Old price: price_1ThMQzACGCy0Kx8oxbHsAZbK ($9.99/week, no longer used but not archived). If a checkout ever shows $9.99/week, the backend's `STRIPE_PRICE_ID` secret is stale.
- Stripe dashboard login may hit hard Arkose captchas; prefer using the API key directly when possible.

## Account funnel (since PR #37)
- Landing CTAs go to `signup.html` (NOT directly to `/checkout`). Flow: signup → `dashboard.html` paywall → "Subscribe to Cheatly Pro" → Stripe Checkout tied to the account.
- Backend has `POST /api/signup|login|logout`, `GET /api/me`, `POST /stripe/webhook`; SQLite at `/data/cheatly.db` on a Fly volume (`cheatly_data`), single machine (`flyctl deploy --ha=false` — HA deploys fail without a second volume).
- Session is an HMAC cookie `cheatly_session` (SameSite=None) — cross-origin from Vercel pages to fly.dev; works on previews thanks to the `.vercel.app` CORS regex.
- A logged-in `/checkout` carries `client_reference_id`=user id + prefilled `customer_email`. Verify via Stripe API: `GET /v1/checkout/sessions?limit=1`.
- Webhook (`checkout.session.completed`) only fires on a real payment — to test the subscribed dashboard state, flip the DB directly (label it "simulated webhook"):
  `flyctl ssh console -a cheatly-backend -C "python -c \"import sqlite3;c=sqlite3.connect('/data/cheatly.db');c.execute('UPDATE users SET subscription_status=? WHERE email=?',('active','EMAIL'));c.commit()\""`
- Use throwaway emails like `cheatly-e2e-<timestamp>@example.com`. Checkout success/cancel URLs return to PROD `LANDING_URL` dashboard.html — 404 if the funnel pages aren't deployed to prod yet.
- New Fly secrets: `SESSION_SECRET`, `STRIPE_WEBHOOK_SECRET`. The **live/correct** Lumini webhook is `we_1Tr3Lq…` → `https://cheatly-backend.fly.dev/webhook/stripe` (event `checkout.session.completed`). An old dead endpoint pointing at `/stripe/webhook` (route no longer exists → 404) was deleted in this session; if you see a webhook pointing at `/stripe/webhook`, it's stale.

## Subscription cancel/resume flow (since PR #71)
- Page: `landing/account.html` (linked in the landing footer + nav as "Manage Subscription", shown only when logged in). Talks to `cheatly-backend.fly.dev`.
- Flow: sign in (`POST /auth/login`) → `GET /auth/me` → `renderStatus()` shows a badge (`Free Trial`/`Active`/`Cancelling`), plan, and date, then either a single **Cancel Subscription** or **Resume Subscription** button. Cancel opens a confirm modal → "Yes, Cancel" → `POST /auth/cancel`; Resume → `POST /auth/resume`. Both set `stripe.Subscription.modify(sub_id, cancel_at_period_end=True/False)` (cancel at period end, no proration).
- Nav gating: `landing/auth.js` stores the JWT in `localStorage['cheatly_token']` on login and reveals "Manage Subscription" links only when a non-expired token is present (client-side `exp` check). Sign-out clears it.
- Test with a JWT-auth account linked to a Stripe customer that has a trialing/active sub. Create test data with the Lumini `sk_live` key: register via `POST /auth/register`, then create a subscription on the same customer. Verify independently with the Stripe API: `GET /v1/subscriptions/<id>` → check `cancel_at_period_end` flips true/false.
- **CSS `hidden` gotcha:** account.html toggles visibility via the `hidden` attribute, but element classes like `.btn {display:inline-flex}` / `.cancel-modal {display:flex}` override `hidden` (higher specificity than the UA `[hidden]` rule), so hidden elements still show. The repo now has a global `[hidden]{display:none!important}` in `style.css:3`. If you see the modal on load or BOTH cancel+resume buttons at once, this rule was likely removed/overridden.
- **Stripe SDK `current_period_end` gotcha (important):** in newer Stripe API versions `current_period_end` is NOT on the subscription object — it's on the subscription **item** (`sub.items.data[0].current_period_end`). `check_stripe_subscription()` in `backend/main.py` reads it via `_subscription_period_end()` (item first, top-level fallback). If `/auth/me` returns **500** for subscribed users (also breaks the extension paywall check), this is the cause. The raw REST API may still return the top-level field under the account's default API version, so reproduce with the actual `stripe` Python SDK, or just watch `fly logs -a cheatly-backend` for `AttributeError: current_period_end`.
- Vercel preview has deployment protection: the session Chrome (logged into Vercel) can load it, but `curl` gets an SSO redirect page — don't trust curl for asserting preview HTML/CSS.

## Devin Secrets Needed
- `FLY_API_TOKEN` — Fly.io org token for cheatly-backend deploys.
- `STRIPE_SECRET_KEY` (sk_live, Lumini Labs) — only needed if re-setting Fly secrets; never print or commit.
