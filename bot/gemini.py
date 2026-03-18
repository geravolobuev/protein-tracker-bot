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


def _model_json(model_name: str):
    _configure()
    return genai.GenerativeModel(
        model_name,
        generation_config={
            "temperature": 0.2,
            "response_mime_type": "application/json",
        },
    )


def _model_text(model_name: str):
    _configure()
    return genai.GenerativeModel(
        model_name,
        generation_config={
            "temperature": 0.2,
        },
    )


def _candidate_models():
    preferred = os.getenv("GEMINI_MODEL")
    models = [
        preferred,
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash-001",
        "gemini-2.5-flash",
        "gemini-flash-latest",
    ]
    return [m for m in models if m]


def _extract_json(text: str):
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z0-9]*", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        print(f"Gemini raw response: {cleaned}")
        raise ValueError("JSON не найден")
    return json.loads(match.group(0))


def analyze_meal_text(text: str):
    resp = None
    last_err = None
    for name in _candidate_models():
        try:
            model = _model_json(name)
            resp = model.generate_content([MEAL_PROMPT, text])
            break
        except Exception as e:
            last_err = e
            print(f"Gemini API error (text) model={name}: {e!r}")
            continue
    if resp is None and last_err:
        raise last_err
    raw = resp.text or ""
    if not raw and getattr(resp, "candidates", None):
        try:
            raw = resp.candidates[0].content.parts[0].text or ""
        except Exception:
            pass
    return _extract_json(raw)


def analyze_meal_image(image_bytes: bytes, mime_type: str):
    with tempfile.NamedTemporaryFile(suffix=_suffix_from_mime(mime_type)) as f:
        f.write(image_bytes)
        f.flush()
        file_ref = genai.upload_file(f.name, mime_type=mime_type)
        resp = None
        last_err = None
        for name in _candidate_models():
            try:
                model = _model_json(name)
                resp = model.generate_content([MEAL_PROMPT, file_ref])
                break
            except Exception as e:
                last_err = e
                print(f"Gemini API error (image) model={name}: {e!r}")
                continue
        if resp is None and last_err:
            raise last_err
    raw = resp.text or ""
    if not raw and getattr(resp, "candidates", None):
        try:
            raw = resp.candidates[0].content.parts[0].text or ""
        except Exception:
            pass
    return _extract_json(raw)


def transcribe_audio(audio_bytes: bytes, mime_type: str):
    resp = None
    last_err = None
    model = None
    for name in _candidate_models():
        try:
            model = _model_text(name)
            break
        except Exception as e:
            last_err = e
            print(f"Gemini API error (audio) model={name}: {e!r}")
            continue
    if last_err and model is None:
        raise last_err
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
