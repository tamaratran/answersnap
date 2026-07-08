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

    # Use computer vision to detect radio buttons (circles) in the screenshot
    import base64
    import numpy as np
    import cv2

    # Decode screenshot
    img_data = screenshot_data
    if img_data.startswith("data:"):
        img_data = img_data.split(",", 1)[1]
    img_bytes = base64.b64decode(img_data)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    cv_img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

    # Detect circles (radio buttons are small circles, radius 5-15px)
    circles = cv2.HoughCircles(
        gray, cv2.HOUGH_GRADIENT, dp=1, minDist=20,
        param1=50, param2=15, minRadius=5, maxRadius=15
    )

    x, y = None, None
    confidence = "low"

    if circles is not None:
        all_circles = np.uint16(np.around(circles[0]))

        # Keep only circles that look like radio buttons rather than letter
        # glyphs (e.g. the "o" in "option"): a radio sits at the start of a
        # label, so the strip immediately to its left is uniform background,
        # while a glyph has neighboring letters there.
        h, w = gray.shape
        radio_circles = []
        for cx, cy, cr in all_circles:
            cx, cy, cr = int(cx), int(cy), int(cr)
            x0 = max(0, cx - 4 * cr)
            x1 = max(0, cx - 2 * cr)
            y0 = max(0, cy - cr)
            y1 = min(h, cy + cr)
            if x1 <= x0 or y1 <= y0:
                continue
            left_strip = gray[y0:y1, x0:x1]
            if left_strip.size == 0 or left_strip.std() > 12:
                continue
            radio_circles.append((cx, cy, cr))

        # Find vertical groups of circles (same x ± 10px, consistent spacing)
        x_groups = {}
        for cx, cy, cr in radio_circles:
            bucket = int(cx) // 10 * 10
            if bucket not in x_groups:
                x_groups[bucket] = []
            x_groups[bucket].append((int(cx), int(cy), int(cr)))

        # Merge adjacent x-buckets and find groups of 3+ circles
        best_group = None
        best_score = 0
        sorted_buckets = sorted(x_groups.keys())

        for i, bucket in enumerate(sorted_buckets):
            # Merge with adjacent buckets (within 5px to handle rounding)
            merged = list(x_groups[bucket])
            for j in range(i + 1, len(sorted_buckets)):
                if sorted_buckets[j] - bucket <= 5:
                    merged.extend(x_groups[sorted_buckets[j]])
                else:
                    break

            if len(merged) < 3:
                continue

            # Sort by y and check if circles have similar radius
            merged.sort(key=lambda c: c[1])
            radii = [c[2] for c in merged]
            if max(radii) - min(radii) > 5:
                continue

            # Find the best contiguous run of 3+ circles with consistent
            # vertical spacing, so a stray circle above or below the real
            # option list doesn't disqualify the whole column.
            for start in range(len(merged) - 2):
                for end in range(len(merged), start + 2, -1):
                    run = merged[start:end]
                    spacings = [run[k+1][1] - run[k][1] for k in range(len(run)-1)]
                    avg_spacing = sum(spacings) / len(spacings)
                    if avg_spacing < 20 or avg_spacing > 80:
                        continue
                    # All spacings should be within 30% of average
                    if not all(abs(s - avg_spacing) / avg_spacing < 0.3 for s in spacings):
                        continue

                    # Score: more circles = better; consistent spacing = better
                    score = len(run) * 10 - max(abs(s - avg_spacing) for s in spacings)
                    if score > best_score:
                        best_score = score
                        best_group = run

        if best_group:
            # Extract target option index from answer letter
            target_letter = req.answer.strip()[0].upper()
            target_idx = ord(target_letter) - ord('A')

            if 0 <= target_idx < len(best_group):
                x = best_group[target_idx][0]
                y = best_group[target_idx][1]
                confidence = "high"
            else:
                x = best_group[0][0]
                y = best_group[0][1]
                confidence = "medium"

    if x is None or y is None:
        # Fallback: if circle detection fails, return error
        print("[LOCATE CV] No radio button group detected, returning error")
        raise HTTPException(
            status_code=422, detail="Could not detect radio buttons in screenshot"
        )

    # Basic sanity check: coordinates must be within screen bounds
    if x < 0 or x >= req.screenWidth or y < 0 or y >= req.screenHeight:
        raise HTTPException(
            status_code=422, detail=f"Coordinates out of bounds: ({x}, {y})"
        )

    return LocateResponse(x=x, y=y, confidence=confidence)


@app.get("/checkout")
async def create_checkout():
    if not STRIPE_SECRET_KEY or not STRIPE_PRICE_ID:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    payload = {
        "mode": "subscription",
        "line_items[0][price]": STRIPE_PRICE_ID,
        "line_items[0][quantity]": "1",
        "success_url": f"{LANDING_URL}/download.html",
        "cancel_url": f"{LANDING_URL}/?checkout=cancelled",
        "allow_promotion_codes": "true",
        "subscription_data[trial_period_days]": "7",
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
