import os
import json
import re
import tempfile
import google.generativeai as genai

MEAL_PROMPT = (
    "Analyze this meal and estimate the protein content in grams. "
    "Return JSON only: {\"protein_grams\": number, \"meal_name\": \"string\", "
    "\"confidence\": \"low/medium/high\"} "
    "Be concise. If unsure, give a range as the middle value."
)


def _configure():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY не задан")
    genai.configure(api_key=api_key)


def _model():
    _configure()
    return genai.GenerativeModel("gemini-1.5-flash")


def _extract_json(text: str):
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("JSON не найден")
    return json.loads(match.group(0))


def analyze_meal_text(text: str):
    model = _model()
    resp = model.generate_content([MEAL_PROMPT, text])
    return _extract_json(resp.text or "")


def analyze_meal_image(image_bytes: bytes, mime_type: str):
    model = _model()
    with tempfile.NamedTemporaryFile(suffix=_suffix_from_mime(mime_type)) as f:
        f.write(image_bytes)
        f.flush()
        file_ref = genai.upload_file(f.name, mime_type=mime_type)
        resp = model.generate_content([MEAL_PROMPT, file_ref])
    return _extract_json(resp.text or "")


def transcribe_audio(audio_bytes: bytes, mime_type: str):
    model = _model()
    prompt = "Transcribe this voice message in Russian. Return plain text only."
    with tempfile.NamedTemporaryFile(suffix=_suffix_from_mime(mime_type)) as f:
        f.write(audio_bytes)
        f.flush()
        file_ref = genai.upload_file(f.name, mime_type=mime_type)
        resp = model.generate_content([prompt, file_ref])
    text = (resp.text or "").strip()
    if not text:
        raise ValueError("Пустая транскрипция")
    return text


def _suffix_from_mime(mime_type: str):
    if mime_type == "image/jpeg":
        return ".jpg"
    if mime_type == "image/png":
        return ".png"
    if mime_type == "audio/ogg":
        return ".ogg"
    if mime_type == "audio/mpeg":
        return ".mp3"
    return ""

