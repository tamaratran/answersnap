import os
import re
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiosqlite
import bcrypt
import jwt
import stripe
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import httpx

# ── Config ────────────────────────────────────────────────────────────────────

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4.1")
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
LANDING_URL = os.environ.get("LANDING_URL", "https://cheatly.io")
STRIPE_CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions"

JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 30

DB_PATH = os.environ.get("DB_PATH", "/data/cheatly.db")

# When True, /answer works without auth (backward compat for existing users).
# Set to False once the new extension version is approved on Chrome Web Store.
AUTH_REQUIRED = os.environ.get("AUTH_REQUIRED", "false").lower() == "true"

stripe.api_key = STRIPE_SECRET_KEY

# ── Database ──────────────────────────────────────────────────────────────────


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            stripe_customer_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


async def get_db():
    return await aiosqlite.connect(DB_PATH)


# ── App ───────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Cheatly API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── Models ────────────────────────────────────────────────────────────────────


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


class AuthRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    email: str


class SubscriptionStatus(BaseModel):
    email: str
    subscribed: bool
    trial: bool = False
    plan: str = ""
    current_period_end: str = ""


# ── Auth Helpers ──────────────────────────────────────────────────────────────


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(email: str, user_id: int) -> str:
    payload = {
        "sub": email,
        "user_id": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")
    token = auth_header[7:]
    return decode_token(token)


async def get_optional_user(request: Request) -> Optional[dict]:
    """Return user payload if auth header present, else None."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    try:
        return jwt.decode(auth_header[7:], JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


async def check_stripe_subscription(stripe_customer_id: str) -> dict:
    if not stripe_customer_id or not STRIPE_SECRET_KEY:
        return {"subscribed": False, "trial": False, "plan": "", "current_period_end": ""}

    try:
        subs = stripe.Subscription.list(customer=stripe_customer_id, status="all", limit=5)
        for sub in subs.data:
            if sub.status in ("active", "trialing"):
                is_trial = sub.status == "trialing"
                period_end = datetime.fromtimestamp(sub.current_period_end, tz=timezone.utc).isoformat()
                plan_name = ""
                if sub.items.data:
                    price = sub.items.data[0].price
                    amount = price.unit_amount / 100 if price.unit_amount else 0
                    interval = price.recurring.interval if price.recurring else ""
                    plan_name = f"${amount:.0f}/{interval}"
                return {
                    "subscribed": True,
                    "trial": is_trial,
                    "plan": plan_name,
                    "current_period_end": period_end,
                }
        return {"subscribed": False, "trial": False, "plan": "", "current_period_end": ""}
    except stripe.StripeError:
        return {"subscribed": False, "trial": False, "plan": "", "current_period_end": ""}


# ── Auth Endpoints ────────────────────────────────────────────────────────────


@app.post("/auth/register", response_model=AuthResponse)
async def register(req: AuthRequest):
    email = req.email.strip().lower()
    password = req.password

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    pw_hash = hash_password(password)

    stripe_customer_id = None
    if STRIPE_SECRET_KEY:
        try:
            customer = stripe.Customer.create(email=email)
            stripe_customer_id = customer.id
        except stripe.StripeError as e:
            raise HTTPException(status_code=500, detail=f"Stripe error: {str(e)}")

    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO users (email, password_hash, stripe_customer_id) VALUES (?, ?, ?)",
            (email, pw_hash, stripe_customer_id),
        )
        await db.commit()
        cursor = await db.execute("SELECT id FROM users WHERE email = ?", (email,))
        row = await cursor.fetchone()
        user_id = row[0]
    except aiosqlite.IntegrityError:
        await db.close()
        raise HTTPException(status_code=409, detail="Email already registered")
    finally:
        await db.close()

    token = create_token(email, user_id)
    return AuthResponse(token=token, email=email)


@app.post("/auth/login", response_model=AuthResponse)
async def login(req: AuthRequest):
    email = req.email.strip().lower()
    password = req.password

    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, password_hash FROM users WHERE email = ?", (email,)
        )
        row = await cursor.fetchone()
    finally:
        await db.close()

    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_id, pw_hash = row
    if not verify_password(password, pw_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_token(email, user_id)
    return AuthResponse(token=token, email=email)


@app.get("/auth/me", response_model=SubscriptionStatus)
async def get_me(request: Request):
    user = await get_current_user(request)
    email = user["sub"]

    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT stripe_customer_id FROM users WHERE email = ?", (email,)
        )
        row = await cursor.fetchone()
    finally:
        await db.close()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    stripe_customer_id = row[0]
    sub_info = await check_stripe_subscription(stripe_customer_id)

    return SubscriptionStatus(email=email, **sub_info)


# ── AI Endpoints ──────────────────────────────────────────────────────────────


SYSTEM_PROMPT = (
    "You are an elite academic expert with deep knowledge across all subjects "
    "including mathematics, science, history, literature, computer science, "
    "economics, and more. You answer exam and quiz questions with perfect accuracy. "
    "You ALWAYS reason through problems step by step before giving your final answer."
)


def build_prompt(selected_text: str) -> str:
    context_hint = ""
    if selected_text:
        context_hint = f'The user double-clicked near this text: "{selected_text}"\n\n'

    return (
        f"{context_hint}Look at this screenshot of a question (exam, quiz, homework, etc.).\n\n"
        "Your job:\n"
        "1. Identify the SINGLE question closest to where the user double-clicked.\n"
        "2. Read the question AND all answer choices very carefully.\n"
        "3. Reason through the problem step by step inside <reasoning> tags.\n"
        "4. After reasoning, output your final answer inside <answer> tags.\n\n"
        "Format rules:\n"
        '- For multiple choice: return ONLY the letter and text, e.g. <answer>C. 2x + 2</answer>\n'
        '- For multiple select: return all correct options, e.g. <answer>A, C</answer>\n'
        "- For fill-in-the-blank: return just the answer value, e.g. <answer>42</answer>\n"
        "- For true/false: return the answer, e.g. <answer>True</answer>\n"
        "- For short answer / essay: provide a concise but complete answer\n"
        "- Answer ONLY ONE question \u2014 the one nearest to the user's click.\n\n"
        "IMPORTANT:\n"
        "- Read EVERY answer option before choosing. Do not pick the first plausible one.\n"
        "- For math: show your work in <reasoning>. Double-check arithmetic.\n"
        "- For science: apply the correct formula or principle.\n"
        "- If the question shows a graph, table, or diagram, analyze it carefully.\n"
        "- NEVER guess. If you are unsure, reason more carefully.\n\n"
        "Example:\n"
        "<reasoning>The question asks for the derivative of x^2. Using the power rule: d/dx(x^2) = 2x.</reasoning>\n"
        "<answer>B. 2x</answer>"
    )


@app.post("/answer", response_model=AnswerResponse)
async def get_answer(req: AnswerRequest, request: Request):
    # When AUTH_REQUIRED is True, require login + active subscription.
    # When False (default), allow unauthenticated access for backward compat.
    if AUTH_REQUIRED:
        user = await get_current_user(request)
        email = user["sub"]

        db = await get_db()
        try:
            cursor = await db.execute(
                "SELECT stripe_customer_id FROM users WHERE email = ?", (email,)
            )
            row = await cursor.fetchone()
        finally:
            await db.close()

        if not row or not row[0]:
            raise HTTPException(status_code=403, detail="No subscription found. Subscribe at https://cheatly.io")

        sub_info = await check_stripe_subscription(row[0])
        if not sub_info["subscribed"]:
            raise HTTPException(status_code=403, detail="Subscription inactive. Subscribe at https://cheatly.io")
    else:
        # Optional: log if user is authenticated (for analytics), but don't gate
        user = await get_optional_user(request)

    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    prompt = build_prompt(req.selectedText)

    screenshot_data = req.screenshot
    if not screenshot_data.startswith("data:"):
        screenshot_data = f"data:image/png;base64,{screenshot_data}"

    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {
                "role": "system",
                "content": SYSTEM_PROMPT,
            },
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
        "max_tokens": 2048,
        "temperature": 0,
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

    answer = _extract_answer(raw)

    return AnswerResponse(answer=answer)


def _extract_answer(raw: str) -> str:
    """Pull the final answer from <answer>...</answer> tags, falling back to raw text."""
    match = re.search(r"<answer>(.*?)</answer>", raw, re.DOTALL)
    if match:
        return match.group(1).strip()
    return raw


@app.post("/locate", response_model=LocateResponse)
async def locate_answer(req: LocateRequest):
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    screenshot_data = req.screenshot
    if not screenshot_data.startswith("data:"):
        screenshot_data = f"data:image/png;base64,{screenshot_data}"

    import base64
    import numpy as np
    import cv2

    img_data = screenshot_data
    if img_data.startswith("data:"):
        img_data = img_data.split(",", 1)[1]
    img_bytes = base64.b64decode(img_data)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    cv_img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

    circles = cv2.HoughCircles(
        gray, cv2.HOUGH_GRADIENT, dp=1, minDist=20,
        param1=50, param2=15, minRadius=5, maxRadius=15
    )

    x, y = None, None
    confidence = "low"

    if circles is not None:
        all_circles = np.uint16(np.around(circles[0]))

        x_groups = {}
        for cx, cy, cr in all_circles:
            bucket = int(cx) // 10 * 10
            if bucket not in x_groups:
                x_groups[bucket] = []
            x_groups[bucket].append((int(cx), int(cy), int(cr)))

        best_group = None
        best_score = 0
        sorted_buckets = sorted(x_groups.keys())

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
            if max(radii) - min(radii) > 5:
                continue

            spacings = [merged[k+1][1] - merged[k][1] for k in range(len(merged)-1)]
            if not spacings:
                continue
            avg_spacing = sum(spacings) / len(spacings)
            if avg_spacing < 20 or avg_spacing > 80:
                continue
            consistent = all(abs(s - avg_spacing) / avg_spacing < 0.3 for s in spacings)
            if not consistent:
                continue

            score = len(merged) * 10 - max(abs(s - avg_spacing) for s in spacings)
            if score > best_score:
                best_score = score
                best_group = merged

        if best_group:
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
        print("[LOCATE CV] No radio button group detected, returning error")
        raise HTTPException(
            status_code=422, detail="Could not detect radio buttons in screenshot"
        )

    if x < 0 or x >= req.screenWidth or y < 0 or y >= req.screenHeight:
        raise HTTPException(
            status_code=422, detail=f"Coordinates out of bounds: ({x}, {y})"
        )

    return LocateResponse(x=x, y=y, confidence=confidence)


# ── Checkout ──────────────────────────────────────────────────────────────────


@app.get("/checkout")
async def create_checkout(email: str = ""):
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

    if email:
        email = email.strip().lower()
        db = await get_db()
        try:
            cursor = await db.execute(
                "SELECT stripe_customer_id FROM users WHERE email = ?", (email,)
            )
            row = await cursor.fetchone()
        finally:
            await db.close()

        if row and row[0]:
            payload["customer"] = row[0]
        else:
            payload["customer_email"] = email

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
