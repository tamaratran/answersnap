import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import httpx

app = FastAPI(title="AnswerSnap API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
LANDING_URL = os.environ.get("LANDING_URL", "https://cheatly.xyz")
STRIPE_CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions"


class AnswerRequest(BaseModel):
    screenshot: str
    selectedText: str = ""


class AnswerResponse(BaseModel):
    answer: str


class LocateRequest(BaseModel):
    screenshot: str
    answer: str
    screenWidth: int
    screenHeight: int


class LocateResponse(BaseModel):
    x: int
    y: int
    confidence: str = "medium"


def build_prompt(selected_text: str) -> str:
    context_hint = ""
    if selected_text:
        context_hint = f'The user double-clicked near this text: "{selected_text}"\n\n'

    return (
        f"{context_hint}You are an expert tutor. Look at this screenshot of a "
        "question (exam, quiz, homework, etc.).\n\n"
        "Your job:\n"
        "1. Identify the SINGLE question closest to where the user double-clicked.\n"
        "2. Determine the correct answer for ONLY that one question.\n"
        "3. Return ONLY the answer in a concise format.\n\n"
        "Rules:\n"
        '- For multiple choice: return the letter and brief text, e.g. "C. 2x + 2"\n'
        '- For multiple select: return all correct letters, e.g. "A, C"\n'
        "- For fill-in-the-blank: return just the answer value\n"
        "- For short answer / essay: provide a concise but complete answer\n"
        "- Answer ONLY ONE question \u2014 the one nearest to the user's click.\n"
        "- Be direct. No preamble or explanation unless the question asks for it.\n"
        '- If you cannot determine the answer with confidence, say "Uncertain: " '
        "followed by your best guess."
    )


@app.post("/answer", response_model=AnswerResponse)
async def get_answer(req: AnswerRequest):
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    prompt = build_prompt(req.selectedText)

    # Build image content from screenshot
    screenshot_data = req.screenshot
    if not screenshot_data.startswith("data:"):
        screenshot_data = f"data:image/png;base64,{screenshot_data}"

    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": screenshot_data, "detail": "high"},
                    },
                ],
            }
        ],
        "max_tokens": 1024,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            OPENAI_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_API_KEY}",
            },
            json=payload,
        )

    if resp.status_code != 200:
        try:
            detail = resp.json().get("error", {}).get("message", resp.text)
        except Exception:
            detail = resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)

    data = resp.json()
    answer = data["choices"][0]["message"]["content"].strip()

    return AnswerResponse(answer=answer)


@app.post("/locate", response_model=LocateResponse)
async def locate_answer(req: LocateRequest):
    """Given a screenshot and the correct answer, return pixel coordinates to click."""
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    screenshot_data = req.screenshot
    if not screenshot_data.startswith("data:"):
        screenshot_data = f"data:image/png;base64,{screenshot_data}"

    prompt = (
        f"The correct answer to the question in this screenshot is: {req.answer}\n\n"
        f"The screenshot dimensions are {req.screenWidth}x{req.screenHeight} pixels.\n\n"
        "Your task: Find the UI element (radio button, checkbox, or clickable option) "
        "that corresponds to this answer.\n\n"
        "Return ONLY a JSON object with the x,y pixel coordinates of where to click "
        "to select this answer. The coordinates should be relative to the top-left "
        "corner of the screenshot.\n\n"
        'Format: {"x": 123, "y": 456, "confidence": "high"}\n\n'
        "Rules:\n"
        "- Click on the radio button/checkbox itself, not the text\n"
        "- If the answer is a letter like 'B', find option B's radio/checkbox\n"
        "- confidence is 'high', 'medium', or 'low'\n"
        "- Return ONLY the JSON, no other text"
    )

    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": screenshot_data, "detail": "high"},
                    },
                ],
            }
        ],
        "max_tokens": 100,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            OPENAI_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_API_KEY}",
            },
            json=payload,
        )

    if resp.status_code != 200:
        try:
            detail = resp.json().get("error", {}).get("message", resp.text)
        except Exception:
            detail = resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)

    data = resp.json()
    raw = data["choices"][0]["message"]["content"].strip()

    # Parse the JSON response
    import json

    try:
        # Strip markdown code fences if present
        cleaned = raw
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            cleaned = cleaned.rsplit("```", 1)[0]
        result = json.loads(cleaned)
        return LocateResponse(
            x=int(result["x"]),
            y=int(result["y"]),
            confidence=result.get("confidence", "medium"),
        )
    except (json.JSONDecodeError, KeyError, ValueError):
        raise HTTPException(
            status_code=422, detail=f"Could not parse coordinates from AI: {raw}"
        )


@app.get("/checkout")
async def create_checkout():
    if not STRIPE_SECRET_KEY or not STRIPE_PRICE_ID:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    payload = {
        "mode": "subscription",
        "line_items[0][price]": STRIPE_PRICE_ID,
        "line_items[0][quantity]": "1",
        "success_url": f"{LANDING_URL}/?checkout=success",
        "cancel_url": f"{LANDING_URL}/?checkout=cancelled",
        "allow_promotion_codes": "true",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            STRIPE_CHECKOUT_URL,
            auth=(STRIPE_SECRET_KEY, ""),
            data=payload,
        )

    if resp.status_code != 200:
        try:
            detail = resp.json().get("error", {}).get("message", resp.text)
        except Exception:
            detail = resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)

    return RedirectResponse(resp.json()["url"], status_code=303)


@app.get("/health")
async def health():
    return {"status": "ok"}
