import os
import json
import re

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

app = FastAPI(title="AnswerSnap API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = "gpt-4o-mini"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"


class AnswerRequest(BaseModel):
    screenshot: str
    selectedText: str = ""


class AnswerResponse(BaseModel):
    type: str
    answer: str
    letter: str | None = None
    letters: list[str] | None = None
    answerText: str | None = None


def build_prompt(selected_text: str) -> str:
    base = (
        "You are helping a student answer a question shown in the screenshot. "
        "Analyze the question and provide the correct answer.\n\n"
        "Respond ONLY with a JSON object (no markdown, no explanation) in this format:\n"
        '{"type": "<type>", "answer": "<answer>", "letter": "<letter>", '
        '"letters": ["<letter1>", "<letter2>"], "answerText": "<text>"}\n\n'
        "Where type is one of: multiple_choice, multiple_select, fill_in_blank, "
        "matching, short_answer, essay\n"
        "- For multiple_choice: set letter (A/B/C/D) and answerText\n"
        "- For multiple_select: set letters array and answerText\n"
        "- For fill_in_blank: set answer to the text that goes in the blank\n"
        "- For short_answer/essay: set answer to the full response\n"
        "- For matching: set answer to a description of correct pairs\n\n"
        "Only include relevant fields for the detected question type."
    )
    if selected_text:
        base += f'\n\nThe user highlighted this text: "{selected_text}"'
    return base


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
                        "image_url": {"url": screenshot_data},
                    },
                ],
            }
        ],
        "max_tokens": 500,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
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
    raw_content = (
        data["choices"][0]["message"]["content"].strip()
    )

    # Strip markdown code fences if present
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw_content)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        parsed = {"type": "short_answer", "answer": raw_content}

    return AnswerResponse(
        type=parsed.get("type", "short_answer"),
        answer=parsed.get("answer", raw_content),
        letter=parsed.get("letter"),
        letters=parsed.get("letters"),
        answerText=parsed.get("answerText"),
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
