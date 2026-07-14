import base64
import os
import re

import cv2
import numpy as np
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
LANDING_URL = os.environ.get("LANDING_URL", "https://cheatly.io")
STRIPE_CHECKOUT_URL = os.environ.get("STRIPE_CHECKOUT_URL", "https://api.stripe.com/v1/checkout/sessions")


class AnswerRequest(BaseModel):
    screenshot: str
    selectedText: str = ""
    clickX: int = -1
    clickY: int = -1


class AnswerResponse(BaseModel):
    answer: str
    optionIndex: int = 0


class LocateRequest(BaseModel):
    screenshot: str
    answer: str
    screenWidth: int
    screenHeight: int
    optionIndex: int = 0
    clickX: int = -1
    clickY: int = -1


class LocateResponse(BaseModel):
    x: int
    y: int
    confidence: str = "medium"


def build_prompt(selected_text: str, click_x: int = -1, click_y: int = -1) -> str:
    hints = []
    if selected_text:
        hints.append(f'The user double-clicked near this text: "{selected_text}"')
    if click_x >= 0 and click_y >= 0:
        hints.append(f"A cropped screenshot centered on the double-click at ({click_x}, {click_y}) is shown.")

    context_hint = ""
    if hints:
        context_hint = "\n\n".join(hints) + "\n\n"

    return (
        f"{context_hint}You are answering the question that was double-clicked.\n"
        "1. List the options below the question, numbered 1, 2, 3... including any 'None of these' option.\n"
        "2. Determine the correct answer.\n"
        "3. Return the final answer on a single line in the exact format:\n"
        '   "Answer: <answer> (option <number>)"\n'
        "Derivative rules: d/dx[x^n] = n*x^(n-1); d/dx[a^x] = a^x*ln(a); if there is no x variable, derivative is 0.\n"
        "No extra explanation."
    )


def crop_image(img: np.ndarray, click_x: int, click_y: int, above: int, below: int, width: int):
    """Return a crop around (click_x, click_y) plus the crop's top-left offset."""
    h, w = img.shape[:2]
    crop_height = above + below
    # Anchor the crop with more space to the left of the click so the question
    # text, radio buttons, and option labels are fully visible.
    x1 = max(0, min(click_x - (width * 3 // 4), w - width))
    y1 = max(0, min(click_y - above, h - crop_height))
    x2 = min(w, x1 + width)
    y2 = min(h, y1 + crop_height)
    crop = img[y1:y2, x1:x2]
    return crop, x1, y1


def crop_screenshot(data_url: str, click_x: int, click_y: int) -> str:
    """Crop the screenshot around the double-click to focus on one question."""
    img_data = data_url
    if img_data.startswith("data:"):
        img_data = img_data.split(",", 1)[1]

    img_bytes = base64.b64decode(img_data)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        return data_url

    # Tight crop around the double-click. The left-anchored x1 keeps the
    # question text and options in view while excluding the previous question.
    crop, _, _ = crop_image(img, click_x, click_y, above=20, below=260, width=900)
    ok, buf = cv2.imencode(".png", crop)
    if not ok:
        return data_url

    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


@app.post("/answer", response_model=AnswerResponse)
async def get_answer(req: AnswerRequest):
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    prompt = build_prompt(req.selectedText, req.clickX, req.clickY)

    # Build image content from screenshot
    screenshot_data = req.screenshot
    if not screenshot_data.startswith("data:"):
        screenshot_data = f"data:image/png;base64,{screenshot_data}"

    # Crop around the double-click to focus on one question and its options
    if req.clickX >= 0 and req.clickY >= 0:
        screenshot_data = crop_screenshot(screenshot_data, req.clickX, req.clickY)

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
        "max_tokens": 120,
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

    # Parse the final answer line in the expected "Answer: <answer> (option <N>)" format.
    answer = raw
    option_index = 0
    final_match = re.search(
        r"Answer:\s*(.+?)\s*\(option\s+(\d+)\)", raw, re.IGNORECASE
    )
    if final_match:
        answer = final_match.group(1).strip()
        option_index = int(final_match.group(2))
    else:
        # Fallback: search anywhere for an "(option N)" marker.
        match = re.search(r"\(option\s+(\d+)\)", raw, re.IGNORECASE)
        if match:
            option_index = int(match.group(1))
            answer = re.sub(r"\(option\s+\d+\)", "", raw, flags=re.IGNORECASE).strip()

    # Strip surrounding quotes if the model wrapped the answer in them.
    if len(answer) >= 2 and (
        (answer[0] == '"' and answer[-1] == '"')
        or (answer[0] == "'" and answer[-1] == "'")
    ):
        answer = answer[1:-1].strip()

    return AnswerResponse(answer=answer, optionIndex=option_index)


@app.post("/locate", response_model=LocateResponse)
async def locate_answer(req: LocateRequest):
    """Given a screenshot and the correct answer, return pixel coordinates to click."""
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    screenshot_data = req.screenshot
    if not screenshot_data.startswith("data:"):
        screenshot_data = f"data:image/png;base64,{screenshot_data}"

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
    if cv_img is None:
        raise HTTPException(status_code=422, detail="Could not decode screenshot")

    # Crop a larger region around the click so the first option and the
    # full option list for the clicked question are visible.
    crop, crop_x1, crop_y1 = crop_image(
        cv_img, req.clickX, req.clickY, above=120, below=350, width=1200
    )
    crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    # Detect radio buttons by looking for small ring-like contours. An
    # unselected radio button is an outer circle with a child hole in the
    # middle; this is more robust than HoughCircles for thin or low-contrast
    # rings.
    thresh = cv2.adaptiveThreshold(
        crop_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 25, 15
    )
    contours, hierarchy = cv2.findContours(
        thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE
    )

    points = []
    if hierarchy is not None and len(hierarchy) > 0:
        for i, cnt in enumerate(contours):
            if cnt.shape[0] < 5:
                continue
            area = cv2.contourArea(cnt)
            if area < 50 or area > 200:
                continue
            (cx, cy), r = cv2.minEnclosingCircle(cnt)
            if r < 4 or r > 10:
                continue
            peri = cv2.arcLength(cnt, True)
            if peri == 0:
                continue
            circularity = 4 * np.pi * area / (peri * peri)
            if circularity < 0.8:
                continue
            # A radio ring has an inner hole (child contour).
            child = int(hierarchy[0][i][2])
            if child == -1:
                continue
            points.append((float(cx), float(cy)))

    x, y = None, None
    confidence = "low"
    best = None
    best_score = -1e9

    # Vertical spacing between option rows. The first option's radio center is
    # roughly text_top + 44 + 6.5; assuming the double-click lands in the
    # middle of the question text, we search for the first option row around
    # click_y + 40.5. A small climb-up step then locks onto the first row.
    DEFAULT_SPACING = 29
    FIRST_RADIO_OFFSET = 40.5

    if points:
        # Group detections by x coordinate; the leftmost vertical column with
        # consistent ~29 px spacing is the radio-button column.
        groups = []
        for px, py in points:
            placed = False
            for g in groups:
                if abs(g[0][0] - px) <= 15:
                    g.append((px, py))
                    placed = True
                    break
            if not placed:
                groups.append([(px, py)])

        for g in groups:
            if len(g) < 2:
                continue
            ys = sorted(p[1] for p in g)
            diffs = [ys[i + 1] - ys[i] for i in range(len(ys) - 1)]
            avg = float(np.median(diffs))
            if avg < 25 or avg > 60:
                continue
            g_x = float(np.median([p[0] for p in g]))
            # Prefer the leftmost radio column with the most rows.
            score = len(g) * 100 - g_x
            if score > best_score:
                best_score = score
                best = {"g": g, "avg": avg, "x": g_x}

    if best:
        ys = sorted(p[1] for p in best["g"])
        avg = best["avg"]
        expected = req.clickY + FIRST_RADIO_OFFSET - crop_y1
        # Pick the row closest to where the first option should be.
        first_y = float(min(ys, key=lambda y: abs(y - expected)))
        # Climb up to the real first option row (handles a double-click that
        # landed low or an option 0 that is missing/selected).
        while True:
            prev = first_y - avg
            if any(abs(y - prev) <= avg * 0.35 for y in ys):
                first_y = prev
            else:
                break

        target_y = first_y + crop_y1 + (req.optionIndex - 1) * avg
        target_x = best["x"] + crop_x1
        if req.clickY + 30 <= target_y <= req.clickY + 300:
            x = int(round(target_x))
            y = int(round(target_y))
            confidence = "high" if len(ys) >= 4 else "medium"

    if x is None and req.optionIndex > 0:
        # Fallback to a geometry guess based on the click position. The first
        # option is typically ~44 px below the question text and each option is
        # ~29 px apart.
        x = int(round(req.clickX - 100)) if req.clickX > 200 else 60
        y = int(round(req.clickY + 50.5 + (req.optionIndex - 1) * DEFAULT_SPACING))
        confidence = "low"

    if x is None or y is None:
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
async def create_checkout(product: str = "extension"):
    if not STRIPE_SECRET_KEY or not STRIPE_PRICE_ID:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    success_path = "lockdown-browser-download.html" if product == "lockdown" else "download.html"
    return await _create_stripe_checkout(STRIPE_PRICE_ID, success_path)


async def _create_stripe_checkout(price_id: str, success_path: str):
    payload = {
        "mode": "subscription",
        "line_items[0][price]": price_id,
        "line_items[0][quantity]": "1",
        "success_url": f"{LANDING_URL}/{success_path}?session_id={{CHECKOUT_SESSION_ID}}",
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
