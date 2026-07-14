---
name: testing-answersnap
description: Test the AnswerSnap Chrome extension end-to-end on Google Forms. Use when verifying auto-fill, backend integration, or popup UI changes.
---

# Testing AnswerSnap Extension

## Devin Secrets Needed
- `ANSWERSNAP_OPENAI_KEY` — OpenAI API key with GPT-4o vision access

## Backend Setup
1. Install dependencies: `cd backend && pip install fastapi uvicorn httpx pydantic`
2. Run locally: `OPENAI_API_KEY="${ANSWERSNAP_OPENAI_KEY}" uvicorn main:app --host 0.0.0.0 --port 8000`
3. Verify: `curl http://localhost:8000/health` should return `{"status":"ok"}`
4. If testing against the deployed backend (`answersnap-backend.fly.dev`), skip local setup — but the deployed backend needs `OPENAI_API_KEY` set as a Fly.io secret

## Extension Loading
1. If `background.js` points to a remote backend URL that isn't deployed yet, temporarily change `BACKEND_URL` to `http://localhost:8000` for local testing
2. Navigate to `chrome://extensions` in Chrome
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the repo root (`/home/ubuntu/repos/answersnap`)
5. If already loaded, click the reload button (circular arrow) on the AnswerSnap card
6. The service worker should show as active (not "Inactive")

## Test Procedure
1. **Popup test**: Click extension icon → verify no API key input field, only toggle + display mode + status
2. **Navigate to a Google Form quiz** (e.g., History & Math Quiz at the URL in the repo context)
3. **Double-click a question's text** to trigger auto-fill
4. **Wait ~5-10 seconds** for the backend to process (OpenAI vision API latency)
5. **Verify**: correct answer selected/filled, blue highlight visible, no cross-question pollution
6. **Check backend logs** in the terminal for `POST /answer 200` entries

## Known Google Form URLs
- History & Math Quiz: `https://docs.google.com/forms/d/e/1FAIpQLSejU_LmCDSwV6iRIvGFH-WiVQ6GLtevtoZsy9sJYVOw0JAUIg/viewform`
- The Pop Quiz form may no longer exist — create a new one if needed

## Tips
- If the extension doesn't respond to double-clicks, check the service worker status in chrome://extensions — it may be "Inactive" and need a reload
- Backend response times are typically 5-8 seconds due to OpenAI vision API latency
- If you get 429 errors, the API key may have exceeded its quota — check billing at https://platform.openai.com/settings/organization/billing
- When testing from a feature branch, remember to revert any temporary `BACKEND_URL` changes before committing
- The extension auto-fills silently (no toast/overlay) — look for the radio button selection or text appearing in the input field
