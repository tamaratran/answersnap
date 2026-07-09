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
        f"{context_hint}You are an expert tutor solving exam/quiz questions from a "
        "screenshot.\n\n"
        "Your job:\n"
        "1. Identify the ONE question that the user double-clicked.\n"
        "2. Determine the correct answer for ONLY that one question.\n"
        "3. Return ONLY the answer in a concise format.\n\n"
        "Rules:\n"
        '- For multiple choice: return the correct answer text followed by "(option N)" '
        "where N is the position of the correct option counting from the top "
        '(1 for the first/topmost option, 2 for the next, etc.). Example: "9x^8 (option 2)".\n'
        '- For multiple select: return all correct options, e.g. "A, C"\n'
        "- For fill-in-the-blank: return just the answer value\n"
        "- For short answer / essay: provide a concise but complete answer\n"
        "- Answer ONLY ONE question.\n"
        "- IGNORE any pre-selected/highlighted radio button in the screenshot; "
        "compute the answer from the question text, not from what is already selected.\n"
        "- Be careful with derivative rules (the variable is x unless otherwise stated):\n"
        "  * y = x^9  -> 9x^8   (power rule: d/dx[x^n] = n*x^(n-1))\n"
        "  * y = 5^9  -> 0      (constant: 5^9 is just a number, no x variable, so derivative is 0)\n"
        "  * y = 5^x  -> 5^x*ln(5) (exponential: d/dx[a^x] = a^x*ln(a))\n"
        "  * Do not treat 5^9 as if it were x^9. The base must be the variable x to use the power rule.\n"
        "- Be direct. No preamble or explanation unless the question asks for it.\n"
        '- If you cannot determine the answer with confidence, say "Uncertain: " '
        "followed by your best guess."
    )


def crop_image(img: np.ndarray, click_x: int, click_y: int, above: int, below: int, width: int):
    """Return a crop around (click_x, click_y) plus the crop's top-left offset."""
    h, w = img.shape[:2]
    crop_height = above + below
    x1 = max(0, min(click_x - width // 2, w - width))
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

    crop, _, _ = crop_image(img, click_x, click_y, above=60, below=360, width=700)
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

    # Parse out a "(option N)" hint that helps the desktop app click the right radio button.
    option_index = 0
    match = re.search(r"\(option\s+(\d+)\)", answer, re.IGNORECASE)
    if match:
        option_index = int(match.group(1))
        # Remove the marker from the user-facing answer text.
        answer = re.sub(r"\(option\s+\d+\)", "", answer, flags=re.IGNORECASE).strip()
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

    # Crop around the click so we only look at the options for the
    # question the user double-clicked.
    crop, crop_x1, crop_y1 = crop_image(
        cv_img, req.clickX, req.clickY, above=50, below=300, width=700
    )
    crop_h, crop_w = crop.shape[:2]
    crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    # Detect circles (radio buttons are small circles, radius 5-15px)
    circles = cv2.HoughCircles(
        crop_gray, cv2.HOUGH_GRADIENT, dp=1, minDist=18,
        param1=50, param2=13, minRadius=6, maxRadius=16
    )

    x, y = None, None
    confidence = "low"
    best_group = None
    best_score = -1e9

    if circles is not None:
        all_circles = np.uint16(np.around(circles[0]))

        # Radio buttons sit at the start of a label:
        #   - uniform background immediately to the left
        #   - option text immediately to the right
        # Letter glyphs (e.g. "0", "o") have neighbouring letters on at
        # least one side.
        radio_circles = []
        for cx, cy, cr in all_circles:
            cx, cy, cr = int(cx), int(cy), int(cr)
            y0 = max(0, cy - cr)
            y1 = min(crop_h, cy + cr)
            if y1 <= y0:
                continue

            # Left of the circle should be background
            x_left0 = max(0, cx - 4 * cr)
            x_left1 = max(0, cx - 2 * cr)
            if x_left1 <= x_left0:
                continue
            left_strip = crop_gray[y0:y1, x_left0:x_left1]
            if left_strip.size == 0:
                continue
            if left_strip.std() > 10:
                continue

            # Right of the circle should contain label text (non-uniform)
            x_right0 = min(crop_w, cx + 2 * cr)
            x_right1 = min(crop_w, cx + 5 * cr)
            if x_right1 <= x_right0:
                continue
            right_strip = crop_gray[y0:y1, x_right0:x_right1]
            if right_strip.size == 0 or right_strip.std() < 12:
                continue

            radio_circles.append((cx, cy, cr))

        # Find vertical groups of radio circles (same x ± 8px, consistent spacing)
        x_groups = {}
        for cx, cy, cr in radio_circles:
            bucket = int(cx) // 8 * 8
            if bucket not in x_groups:
                x_groups[bucket] = []
            x_groups[bucket].append((int(cx), int(cy), int(cr)))

        def group_score(run, click_x, click_y, crop_h, option_index):
            n = len(run)
            spacings = [run[k+1][1] - run[k][1] for k in range(n - 1)]
            if not spacings:
                return -1e9
            avg = sum(spacings) / len(spacings)
            max_dev = max(abs(s - avg) for s in spacings)
            if avg < 25 or avg > 60:
                return -1e9
            if max_dev / avg > 0.35:
                return -1e9

            # Options should be below the click, and the whole run should fit
            # in the crop (which only shows this question's options).
            top = run[0][1]
            bottom = run[-1][1]
            col_x = sum(c[0] for c in run) / n

            # Prefer the column that is roughly under the question text and
            # to its left (radio buttons are left of option text).
            horiz_score = -abs(col_x - click_x + 90)

            # Prefer the run that starts closest to (just below) the click.
            vert_score = -abs(top - rel_click_y)

            # Length, consistent spacing, and containment.
            length_score = n * 15
            spacing_score = -max_dev
            containment = 0
            if req.optionIndex > 0 and option_index <= n:
                containment = 10

            return length_score + spacing_score + horiz_score + vert_score + containment

        best_group = None
        best_score = -1e9
        sorted_buckets = sorted(x_groups.keys())
        rel_click_x = req.clickX - crop_x1
        rel_click_y = req.clickY - crop_y1

        for i, bucket in enumerate(sorted_buckets):
            merged = list(x_groups[bucket])
            for j in range(i + 1, len(sorted_buckets)):
                if sorted_buckets[j] - bucket <= 5:
                    merged.extend(x_groups[sorted_buckets[j]])
                else:
                    break

            if len(merged) < 3:
                continue

            merged.sort(key=lambda c: c[1])
            radii = [c[2] for c in merged]
            if max(radii) - min(radii) > 6:
                continue

            # Find the best contiguous run of 3+ circles
            for start in range(len(merged) - 2):
                for end in range(len(merged), start + 2, -1):
                    run = merged[start:end]
                    score = group_score(run, rel_click_x, rel_click_y, crop_h, req.optionIndex)
                    if score > best_score:
                        best_score = score
                        best_group = run

        if best_group and best_score > -1e8:
            n = len(best_group)
            avg_spacing = sum(best_group[k+1][1] - best_group[k][1] for k in range(n - 1)) / (n - 1)

            if req.optionIndex > 0 and req.optionIndex <= n:
                idx = req.optionIndex - 1
                x = best_group[idx][0] + crop_x1
                y = best_group[idx][1] + crop_y1
                confidence = "high"
            else:
                # Try to infer from answer letter; fall back to best column top.
                target_letter = req.answer.strip()[0].upper()
                target_idx = ord(target_letter) - ord('A')

                if 0 <= target_idx < n:
                    x = best_group[target_idx][0] + crop_x1
                    y = best_group[target_idx][1] + crop_y1
                    confidence = "high"
                else:
                    x = best_group[0][0] + crop_x1
                    y = best_group[0][1] + crop_y1
                    confidence = "medium"

    # Fallback using geometry when CV does not find a good group.
    if x is None or y is None:
        if req.optionIndex > 0:
            x = max(0, req.clickX - 100)
            y = req.clickY + 60 + (req.optionIndex - 1) * 40
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
