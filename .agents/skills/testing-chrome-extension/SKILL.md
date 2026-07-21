---
name: testing-chrome-extension
description: Test the Cheatly Chrome extension (popup, double-click auto-answer, Alt+A toggle) loaded unpacked in the session browser. Use when verifying extension UI, branding, or content-script changes.
---

# Testing the Cheatly Chrome Extension

## Loading / reloading
- The extension is loaded unpacked from the repo root (`/home/ubuntu/repos/answersnap`, contains `manifest.json`). Check out the branch under test, then click Reload on the card at chrome://extensions (Developer mode must be on).
- The Reload icon button on the extensions card may not respond to DOM-targeted clicks; clicking by screen coordinates on the circular reload arrow tends to work. Verify the reload took by checking the card title/version actually changed — don't trust a single click.
- To confirm which directory Chrome loaded the extension from, read `~/.browser_data_dir/Default/Preferences` (JSON: `extensions.settings.<id>.path`).

## Exercising the extension
- Test page: prefer `http://localhost:8080/quiz.html` over `file:///home/ubuntu/quiz.html` — content scripts inject more reliably on `http://` URLs. Start a server with `python3 -m http.server 8080` from the home directory. The `file://` protocol may require explicitly enabling "Allow access to file URLs" in the extension details page, and even then can be flaky.
- For multi-select/checkbox testing, create a Google Form with a checkbox question (e.g. "Which are planets?") and open it in preview mode. The form preview URL pattern is `https://docs.google.com/forms/d/<ID>/preview`.
- After reloading the extension at chrome://extensions, you MUST refresh/reopen the test page — the old content script is orphaned and won't fire. Open a fresh tab or press F5.
- Answers are INTENTIONALLY silent: `showAnswer()` in content.js only auto-fills (radio click / text fill). The overlay element exists in code but is never displayed in any display mode — do not write test criteria expecting an "answer overlay".
- User-visible branded surfaces: extension card name, popup header, error toasts, and Alt+A toggle toasts ("Cheatly ON"/"Cheatly OFF"). Toasts last ~2s — screenshot immediately after the keypress.
- Open the popup via the puzzle-piece icon → extension entry, or navigate directly to `chrome-extension://<extension-id>/popup.html` in the address bar (more reliable for testing). Popup display-mode clicks may not persist on the first try; reopen the popup to confirm the selection stuck, or verify via the service worker: attach Playwright over CDP (`http://localhost:29229`), find the worker in `context.service_workers`, and `evaluate("() => chrome.storage.local.get(null)")`.
- AI answers can be wrong (e.g. simple arithmetic missed). Treat accuracy misses as backend/model findings, not extension-code failures — but always disclose them in the report.

## Auth + Subscription Testing
- **Paywall is enforced in production** (`AUTH_REQUIRED=true` on `cheatly-backend` since Jul 2026). Logged-out double-clicks show the "Log in to Cheatly to use this feature" toast; check the flag with `flyctl ssh console -a cheatly-backend -C "printenv AUTH_REQUIRED WHITELISTED_EMAILS"` if behavior differs.
- **Whitelisted creator account for testing:** `creator@cheatly.io` / `cheatly2026` (plan "Creator", bypasses subscription; 1-hour session rate limit still applies). Whitelisted accounts survive DB resets only if re-registered — if login fails with "Invalid email or password", re-register the same email (whitelisting comes from the `WHITELISTED_EMAILS` env var, not the DB).
- The extension has a login/register UI in the popup. When not authenticated, the popup shows "Log In" / "Sign Up" tabs with email/password forms and hint "7-day free trial, then $25/month".
- After registering or logging in, the popup shows the main view with the user's email, subscription status badge, and (if no subscription) a "Subscribe to unlock Cheatly" CTA with "Start Free Trial" button linking to cheatly.xyz.
- **Subscription gating:** Double-clicking a question when logged in but without a subscription shows a toast "Subscribe to Cheatly to get answers". When not logged in at all, the toast says "Log in to Cheatly to use this feature".
- **Backend DB persistence:** The backend uses SQLite on Fly.io with ephemeral storage. Test users may be lost after redeployment. Always re-register a test account at the start of each test session rather than assuming a previous test user exists.
- **Auth token storage:** JWT tokens are stored in `chrome.storage.local`. They persist across page reloads but may be lost if the extension is reloaded/reinstalled. The token has a 30-day expiry.
- **Error handling:** Invalid login shows a red error message "Invalid email or password" in the popup. The popup stays on the auth view and does NOT transition to the main view. "Email already registered" appears in red when trying to sign up with an existing email.
- **Pricing display:** The popup shows "7-day free trial, then $25/month" hint text and "Subscribe to unlock Cheatly" status for unsubscribed users.
- **Local backend testing:** To test auth without deploying, run `DB_PATH=/tmp/test-cheatly.db JWT_SECRET=testsecret123 uvicorn backend.main:app --host 0.0.0.0 --port 8000` and temporarily change BACKEND_URL in popup.js and background.js to `http://localhost:8000`. Remember to revert before committing.
- **JWT gotcha:** PyJWT requires the `sub` claim to be a string (per RFC 7519). If `create_jwt()` passes an integer user_id, `jwt.decode()` will raise `InvalidSubjectError`. Always cast to `str(user_id)` when creating tokens and `int(claims["sub"])` when reading them back.
- **Toast timing:** Subscription/auth toasts last ~2 seconds. Screenshot immediately after double-clicking to capture the toast. The DOM also reflects the toast text in the HTML output even if the visual has faded.

## Google Sign-In (popup "Continue with Google")
- The popup's Google login (v1.4.0+) uses `chrome.identity.launchWebAuthFlow` with `response_type=id_token`, then POSTs the token to `/auth/google` and stores the JWT under the same `authToken`/`authEmail` keys as password login.
- **Redirect URI must be authorized per extension ID:** the flow redirects to `https://<extension-id>.chromiumapp.org/`. An unpacked dev copy has a DIFFERENT ID than the store extension, so the GCP "Cheatly Web" OAuth client (project `idyllic-parser-503017-c9`) needs the dev ID's URI added under Authorized redirect URIs, or the flow fails with a redirect_uri_mismatch. Both the store ID (`pgljbing...`) and one dev ID were added Jul 2026; re-add if the unpacked path/ID changes. Google says changes may take 5 min–hours to propagate (usually instant).
- Find the unpacked extension's ID via `~/.browser_data_dir/Default/Preferences` → `extensions.settings` (look for the entry whose `path` is the repo).
- The unpacked copy may be DISABLED in the profile; enable it (and optionally disable the store copy to avoid duplicate content scripts) via a chrome://extensions page with Playwright: `chrome.management.setEnabled(id, true)` and reload with `chrome.developerPrivate.reload(id, {failQuietly:true})` — the reload also picks up new manifest versions.
- To test the fix's target case, use a Google account that signed up on the website via Google (no password) — e.g. tranjtamara@gmail.com already in the browser profile. Password login for such accounts should fail; the Google button should succeed.
- Log out first: `chrome.storage.local.remove(['authToken','authEmail'])` from the popup page (via Playwright), then reload the popup.

## Google Forms Testing
- **ALWAYS test on a real Google Form** (user requirement, Jul 2026): every extension/answer-flow test session must include at least one recorded run on a Google Form (`/viewform`), not just localhost quiz pages. Localhost pages are fine for quick iteration, but the final proof must be on a Google Form.
- Google Forms uses custom UI elements with `[role="radio"]` and `[role="checkbox"]` attributes instead of standard HTML `<input>` elements. The extension's `collectOptionGroups()` detects these correctly.
- **Trusted Types CSP:** Google Forms enforces a strict Content Security Policy requiring `TrustedHTML`/`TrustedScript`. Any DOM injection must use `createElement()`/`createTextNode()`/`appendChild()` — never `innerHTML`. CDP `Runtime.evaluate()` bypasses CSP entirely and is the recommended injection method in automated environments.
- **Chrome for Testing limitation:** The automation browser does not natively inject content scripts from installed extensions. To test on Google Forms (or any HTTPS page), manually inject the content script via CDP using `Runtime.evaluate()`. The injection script at `/home/ubuntu/reinject.py` demonstrates this pattern.
- **Screenshot provider loop:** Since the injected content script can't use `chrome.tabs.captureVisibleTab()` (no background script access), a Python loop polls `window.__cheatlyNeedScreenshot` and provides screenshot data via CDP `Page.captureScreenshot` → `window.__cheatlyScreenshotData`. This loop must run continuously during testing. Launch it with `setsid nohup python3 -u ... &` and verify with `ps` — backgrounding it from a short-lived shell may silently kill it.
- **Form preview vs respondent mode:** Use the `/viewform` URL (not `/edit` or `/preview`) to test as a respondent. The form must be published and accepting responses.
- **Content script lost on form clear/reload:** Clicking "Clear form" or navigating away destroys injected scripts. Re-run the injection script without navigating to restore the content script.
- **Test form creation:** Create forms via the Google Forms UI at `https://docs.google.com/forms`. Include a mix of checkbox (multi-select) and radio (single-select) questions to test both code paths.
- **Answer accuracy:** The extension correctly handles both multi-select (checkbox) and single-select (radio) on Google Forms. Expect ~3-5 second response time per question (screenshot → AI → auto-fill).
- **Auth on injected script:** With the paywall enforced, a CDP-injected script must send the `Authorization: Bearer <JWT>` header itself (it has no access to `chrome.storage`). Do a real popup login first, read the token via Playwright (`chrome.storage.local.get('authToken')` on the popup page), and embed it into the injected JS. `/home/ubuntu/gform_inject.py` (takes the token as argv[1]) + `/home/ubuntu/gform_screenshot_loop.py` implement this; both reuse the js payload embedded in `/home/ubuntu/reinject.py` but point `BACKEND_URL` at `cheatly-backend.fly.dev`. Injecting with an empty token is a valid logged-out negative test (expect the 401 "Log in to Cheatly" toast).
- **Questions with placeholder options:** Form questions whose only choice is "Option 1" can't be auto-filled (the AI answer, e.g. "Paris", has nothing to match). Don't treat that as a failure; pick questions with real option text.
- **Reset form state before testing:** Google Forms restores draft answers ("Your progress has been restored"). Click "Clear form" → confirm before recording, or preselected answers will fake a pass. Note clearing/reloading also destroys the injected script — re-inject after.

## Gotchas
- Internal `answersnap-*` DOM ids/classes, the `answersnap` runtime port name, and the fly.dev backend URL are intentionally NOT renamed to Cheatly — don't flag them, and don't "fix" them (renaming the port breaks the content↔worker handshake).
- Page reloads (F5) clear filled answers; Chrome may restore some form state. Re-trigger answers after any reload.
- Wait up to ~10s for an answer (screenshot → GPT-4o round trip).
- DevTools responsive/device mode (the toolbar showing "Dimensions: Responsive") might interfere with double-click event dispatch. If the dblclick handler doesn't fire while DevTools is open, close DevTools, perform the double-click, then reopen DevTools to check console logs.
- The extension's `enabled` state persists in `chrome.storage`. After toggling OFF with Alt+A, the state survives page refreshes. The content script reads it on init via `GET_SETTINGS`. Always verify the current state (look for "Cheatly ON"/"OFF" toast) before testing.
- **Auto-disable timer (1 hour):** The extension automatically disables itself after 1 hour (changed from 2 hours in PR #51). During test sessions, the toggle may silently turn OFF and `settings.enabled` persists as `false` in `chrome.storage.local`. If double-click stops working, check storage via the service worker console: `chrome.storage.local.get(null).then(d => console.log(JSON.stringify(d)))`. If `enabled: false`, reset it: `chrome.storage.local.set({settings: {displayMode: 'homework', enabled: true}})`. This is the most common reason double-click "stops working" during testing.
- **Double-click on Wikipedia:** Wikipedia pages have many hyperlinked words. Double-clicking on a hyperlink navigates to another page instead of triggering the extension. Use a simple test page (`file:///` or `http://localhost`) with plain non-linked text for reliable double-click testing, or be very precise about clicking on non-linked words.
- **Fixed in PR #41 (commit 21723c3):** `collectOptionGroups()` previously created separate 1-checkbox groups on Google Forms because each `<label>` wrapping a checkbox satisfied the break condition. The fix walks past single-checkbox wrappers to find the real multi-checkbox container. If multi-select still fails on a new site, check whether the DOM structure wraps each checkbox in its own container — the same pattern may need further generalization.
- To add debug logging for the dblclick handler, add `console.log` at the very start of the handler (before the `enabled`/`isLoading` guard) to confirm it fires. The existing debug logs in `autoFillAnswers` only run after the API response returns.
- The service worker console (accessible via chrome://extensions → "Inspect views: service worker") loses logs when the worker goes inactive. Check it promptly after triggering the extension, or add `console.log` statements in background.js before the worker idles.

## Rate Limiting Testing
- **Two backends (Option A):** `answersnap-backend.fly.dev` (no auth, old extension) and `cheatly-backend.fly.dev` (auth + rate limiting, new extension). Test against `cheatly-backend.fly.dev`.
- **Rate limit window:** Controlled by `RATE_LIMIT_MINUTES` env var (default 60). For testing, temporarily set to 1: `flyctl secrets set RATE_LIMIT_MINUTES=1 -a cheatly-backend`. **Always reset to 60 after testing.**
- **Order of checks in `/answer`:** auth (401) → subscription (403) → rate limit (429). You cannot trigger a 429 without an active Stripe subscription. Test rate limiting via `/auth/me` (which reports `rate_limited` and `session_minutes_remaining` independently) and `/auth/reset-session`.
- **Inserting test sessions via Fly SSH:** `sqlite3` is not available in the container. Use Python instead:
  ```
  flyctl ssh console -a cheatly-backend -C "python3 -c \"
  import sqlite3, datetime
  conn = sqlite3.connect('/data/cheatly.db')
  started = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=2)).isoformat()
  conn.execute('INSERT INTO usage_sessions (user_email, started_at, active) VALUES (?, ?, 1)', ('EMAIL', started))
  conn.commit()
  conn.close()
  \""
  ```
- **Popup rate limit display:** The "Session expired" and "X min remaining" text only appears for subscribed users (`subInfo.subscribed === true`). Unsubscribed users see "No Subscription" badge with empty sub-detail.
- **Schema migration:** The backend auto-detects legacy DB schemas (with `subscription_status` column) and drops/recreates the users table on startup. Test users are lost when this happens. Always register fresh users.

## Devin Secrets Needed
- None for extension UI testing (backend is already deployed). `FLY_API_TOKEN` only if backend redeploy is needed (stored at `/home/ubuntu/.fly-token`).
