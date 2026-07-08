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
LANDING_URL = os.environ.get("LANDING_URL", "https://cheatly.xyz")
STRIPE_CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions"


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
        f"{context_hint}You are an expert tutor. Look at this screenshot of a "
        "question (exam, quiz, homework, etc.).\n\n"
        "Your job:\n"
        "1. Identify the SINGLE question visible in the screenshot.\n"
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
        "- Be careful with derivative rules: x^n and a^x are different. "
        "For x^n, the derivative is n*x^(n-1). For a^x, the derivative is a^x*ln(a). "
        "A constant number like 5^9 has derivative 0.\n"
        "- Be direct. No preamble or explanation unless the question asks for it.\n"
        '- If you cannot determine the answer with confidence, say "Uncertain: " '
        "followed by your best guess."
    )


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

    h, w = img.shape[:2]
    CROP_WIDTH = 700
    CROP_HEIGHT = 300
    ABOVE = 80  # pixels to keep above the click so the full question text fits

    x1 = max(0, min(click_x - CROP_WIDTH // 2, w - CROP_WIDTH))
    y1 = max(0, min(click_y - ABOVE, h - CROP_HEIGHT))
    x2 = min(w, x1 + CROP_WIDTH)
    y2 = min(h, y1 + CROP_HEIGHT)

    crop = img[y1:y2, x1:x2]
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


def group_distance_to_click(group, click_y: int) -> float:
    """Score a circle group by how close it is vertically to the user's click."""
    if not group or click_y < 0:
        return float("inf")
    # The question text is just above the first option, so the best group is the
    # one whose top is slightly below the click.
    top_y = group[0][1]
    return abs(top_y - click_y - 50)


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

                    # Score: more circles = better; consistent spacing = better,
                    # and the group should be vertically near the user's click.
                    score = len(run) * 10 - max(abs(s - avg_spacing) for s in spacings)
                    if req.clickY >= 0:
                        dist = group_distance_to_click(run, req.clickY)
                        score -= dist * 0.5
                    if score > best_score:
                        best_score = score
                        best_group = run

        if best_group:
            # If the model provided an option index, use it directly. This is much
            # more reliable than guessing from the first letter of the answer text,
            # especially when options are unlabeled (e.g., Google Forms).
            if req.optionIndex > 0 and req.optionIndex <= len(best_group):
                idx = req.optionIndex - 1
                x = best_group[idx][0]
                y = best_group[idx][1]
                confidence = "high"
            else:
                # Fallback: try to infer the index from a leading A-E letter.
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
