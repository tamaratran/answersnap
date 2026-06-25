import os
import sqlite3
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import httpx
import jwt

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
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
LANDING_URL = os.environ.get("LANDING_URL", "https://cheatly.xyz")
STRIPE_CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions"

JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 30

DB_PATH = os.environ.get("DB_PATH", "/data/cheatly.db")


# ── Database ────────────────────────────────────────────────────────────────

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                stripe_customer_id TEXT,
                subscription_status TEXT DEFAULT 'none',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.commit()


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{h}"


def verify_password(password: str, password_hash: str) -> bool:
    salt, h = password_hash.split(":", 1)
    return hashlib.sha256((salt + password).encode()).hexdigest() == h


def create_jwt(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    claims = decode_jwt(token)
    with get_db() as db:
        user = db.execute(
            "SELECT id, email, subscription_status, stripe_customer_id FROM users WHERE id = ?",
            (int(claims["sub"]),),
        ).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(user)


@app.on_event("startup")
def startup():
    init_db()


class AnswerRequest(BaseModel):
    screenshot: str
    selectedText: str = ""


class AnswerResponse(BaseModel):
    answer: str


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class CreateAccountRequest(BaseModel):
    session_id: str
    password: str


class AuthResponse(BaseModel):
    token: str
    email: str
    subscription_status: str


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


# ── Auth Endpoints ──────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=AuthResponse)
async def register(req: RegisterRequest):
    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    pw_hash = hash_password(req.password)
    with get_db() as db:
        existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")
        cursor = db.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?)",
            (email, pw_hash),
        )
        db.commit()
        user_id = cursor.lastrowid

    token = create_jwt(user_id, email)
    return AuthResponse(token=token, email=email, subscription_status="none")


@app.post("/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    email = req.email.strip().lower()
    with get_db() as db:
        user = db.execute(
            "SELECT id, email, password_hash, subscription_status FROM users WHERE email = ?",
            (email,),
        ).fetchone()
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_jwt(user["id"], user["email"])
    return AuthResponse(
        token=token,
        email=user["email"],
        subscription_status=user["subscription_status"],
    )


@app.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {
        "email": user["email"],
        "subscription_status": user["subscription_status"],
    }


@app.get("/auth/session-email")
async def get_session_email(session_id: str):
    """Get the customer email from a Stripe checkout session."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{STRIPE_CHECKOUT_URL}/{session_id}",
            headers={"Authorization": f"Bearer {STRIPE_SECRET_KEY}"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Invalid session")

    session = resp.json()
    email = session.get("customer_email") or session.get("customer_details", {}).get("email", "")
    if not email:
        raise HTTPException(status_code=400, detail="No email found in session")

    return {"email": email}


@app.post("/auth/create-account", response_model=AuthResponse)
async def create_account_from_checkout(req: CreateAccountRequest):
    """Create account using a Stripe checkout session ID.
    Retrieves email from Stripe, creates user with active subscription."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Retrieve checkout session from Stripe
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"https://api.stripe.com/v1/checkout/sessions/{req.session_id}",
            auth=(STRIPE_SECRET_KEY, ""),
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Invalid checkout session")

    session = resp.json()
    email = (session.get("customer_email") or session.get("customer_details", {}).get("email", "")).strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="No email found in checkout session")

    stripe_customer_id = session.get("customer", "")
    subscription_id = session.get("subscription", "")

    # Determine subscription status from checkout session
    payment_status = session.get("payment_status", "")
    sub_status = "active" if payment_status == "paid" or subscription_id else "trialing"

    pw_hash = hash_password(req.password)
    with get_db() as db:
        existing = db.execute("SELECT id, subscription_status FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            # Update existing user with subscription info and new password
            db.execute(
                "UPDATE users SET password_hash = ?, stripe_customer_id = ?, subscription_status = ? WHERE email = ?",
                (pw_hash, stripe_customer_id, sub_status, email),
            )
            db.commit()
            user_id = existing["id"]
        else:
            cursor = db.execute(
                "INSERT INTO users (email, password_hash, stripe_customer_id, subscription_status) VALUES (?, ?, ?, ?)",
                (email, pw_hash, stripe_customer_id, sub_status),
            )
            db.commit()
            user_id = cursor.lastrowid

    token = create_jwt(user_id, email)
    return AuthResponse(token=token, email=email, subscription_status=sub_status)


# ── Stripe Webhook ──────────────────────────────────────────────────────────

@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events for subscription lifecycle."""
    import hmac
    import hashlib as _hashlib
    import time

    body = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    if STRIPE_WEBHOOK_SECRET and sig_header:
        # Verify webhook signature
        elements = dict(item.split("=", 1) for item in sig_header.split(",") if "=" in item)
        timestamp = elements.get("t", "")
        signature = elements.get("v1", "")

        if not timestamp or not signature:
            raise HTTPException(status_code=400, detail="Invalid signature header")

        # Check timestamp is within 5 minutes
        if abs(time.time() - int(timestamp)) > 300:
            raise HTTPException(status_code=400, detail="Webhook timestamp too old")

        signed_payload = f"{timestamp}.{body.decode()}"
        expected = hmac.new(
            STRIPE_WEBHOOK_SECRET.encode(),
            signed_payload.encode(),
            _hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        event = __import__("json").loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = event.get("type", "")
    data_object = event.get("data", {}).get("object", {})

    if event_type in (
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        customer_id = data_object.get("customer", "")
        status = data_object.get("status", "")

        # Map Stripe statuses to our simplified statuses
        status_map = {
            "active": "active",
            "trialing": "trialing",
            "past_due": "past_due",
            "canceled": "canceled",
            "unpaid": "canceled",
            "incomplete": "none",
            "incomplete_expired": "canceled",
        }
        mapped_status = status_map.get(status, "none")

        with get_db() as db:
            db.execute(
                "UPDATE users SET subscription_status = ? WHERE stripe_customer_id = ?",
                (mapped_status, customer_id),
            )
            db.commit()

    elif event_type == "checkout.session.completed":
        customer_id = data_object.get("customer", "")
        email = (
            data_object.get("customer_email")
            or data_object.get("customer_details", {}).get("email", "")
        ).strip().lower()

        if email and customer_id:
            with get_db() as db:
                existing = db.execute(
                    "SELECT id FROM users WHERE email = ?", (email,)
                ).fetchone()
                if existing:
                    db.execute(
                        "UPDATE users SET stripe_customer_id = ?, subscription_status = 'active' WHERE email = ?",
                        (customer_id, email),
                    )
                    db.commit()

    return {"received": True}


# ── Answer Endpoint (auth-gated) ────────────────────────────────────────────

@app.post("/answer", response_model=AnswerResponse)
async def get_answer(req: AnswerRequest, user: dict = Depends(get_current_user)):
    # Check subscription is active or trialing
    if user["subscription_status"] not in ("active", "trialing"):
        raise HTTPException(
            status_code=403,
            detail="Active subscription required. Visit cheatly.xyz to subscribe.",
        )

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

        # Find vertical groups of circles (same x ± 10px, consistent spacing)
        x_groups = {}
        for cx, cy, cr in all_circles:
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

            # Sort by y and check for consistent spacing
            merged.sort(key=lambda c: c[1])
            # Check if circles have similar radius
            radii = [c[2] for c in merged]
            if max(radii) - min(radii) > 5:
                continue

            # Check consistent vertical spacing
            spacings = [merged[k+1][1] - merged[k][1] for k in range(len(merged)-1)]
            if not spacings:
                continue
            avg_spacing = sum(spacings) / len(spacings)
            if avg_spacing < 20 or avg_spacing > 80:
                continue
            # All spacings should be within 30% of average
            consistent = all(abs(s - avg_spacing) / avg_spacing < 0.3 for s in spacings)
            if not consistent:
                continue

            # Score: more circles in group = better; consistent spacing = better
            score = len(merged) * 10 - max(abs(s - avg_spacing) for s in spacings)
            if score > best_score:
                best_score = score
                best_group = merged

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
        "success_url": f"{LANDING_URL}/create-account.html?session_id={{CHECKOUT_SESSION_ID}}",
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
