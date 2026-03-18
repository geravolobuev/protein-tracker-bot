import os
import re
import asyncio
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from . import gemini
from . import database as db


def build_application(token: str) -> Application:
    app = Application.builder().token(token).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("status", status))
    app.add_handler(CommandHandler("today", today))
    app.add_handler(CommandHandler("reset", reset_today))

    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

    return app


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Привет! Укажи цель по белку на день в формате 140-180 г."
    )


async def today(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return

    meals = await db.get_today_meals(update.effective_user.id)
    if not meals:
        await update.message.reply_text("Сегодня записей нет.")
        return

    total = sum(float(m["protein_grams"]) for m in meals)
    lines = [
        f"{m['meal_description']} — {float(m['protein_grams']):.0f} г"
        for m in meals
    ]
    target = f"{user['protein_min']}–{user['protein_max']} г"
    text = "Сегодня:\n" + "\n".join(lines) + f"\nИтого: {total:.0f} г (цель {target})."
    await update.message.reply_text(text)


async def status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return

    meals = await db.get_today_meals(update.effective_user.id)
    total = sum(float(m["protein_grams"]) for m in meals)
    comment = _comment_on_track(total, user["protein_min"], user["protein_max"])
    await update.message.reply_text(
        f"Сегодня: {total:.0f} г (цель {user['protein_min']}–{user['protein_max']}). {comment}"
    )


async def reset_today(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return

    await db.delete_today_meals(update.effective_user.id)
    await update.message.reply_text("Записи за сегодня очищены.")


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (update.message.text or "").strip()
    user = await db.get_user(update.effective_user.id)

    if not user:
        parsed = _parse_target_range(text)
        if not parsed:
            await update.message.reply_text(
                "Укажи цель по белку в формате 140-180 г."
            )
            return
        protein_min, protein_max = parsed
        await db.create_user(update.effective_user.id, protein_min, protein_max)
        await update.message.reply_text(
            f"Цель сохранена: {protein_min}–{protein_max} г."
        )
        return

    await _analyze_and_store_meal(update, source_text=text)


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return
    if not os.getenv("GEMINI_API_KEY"):
        await update.message.reply_text("Ключ Gemini не задан.")
        return

    photo = update.message.photo[-1]
    file = await context.bot.get_file(photo.file_id)
    image_bytes = await file.download_as_bytearray()
    ext = ""
    if file.file_path and "." in file.file_path:
        ext = file.file_path.rsplit(".", 1)[-1].lower()
    mime = "image/jpeg" if ext in ["jpg", "jpeg"] else "image/png"

    try:
        result = await asyncio.to_thread(
            gemini.analyze_meal_image, bytes(image_bytes), mime
        )
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        print(f"Gemini image error: {e!r}")
        await update.message.reply_text(
            f"Не смог распознать еду. Ошибка: {msg}"
        )
        return

    await _store_and_reply(update, result, user)


async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return
    if not os.getenv("GEMINI_API_KEY"):
        await update.message.reply_text("Ключ Gemini не задан.")
        return

    voice = update.message.voice
    file = await context.bot.get_file(voice.file_id)
    audio_bytes = await file.download_as_bytearray()
    mime = voice.mime_type or "audio/ogg"

    try:
        transcript = await asyncio.to_thread(
            gemini.transcribe_audio, bytes(audio_bytes), mime
        )
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        print(f"Gemini audio error: {e!r}")
        await update.message.reply_text(
            f"Не смог разобрать голос. Ошибка: {msg}"
        )
        return

    await _analyze_and_store_meal(update, source_text=transcript)


async def _analyze_and_store_meal(update: Update, source_text: str):
    if not os.getenv("GEMINI_API_KEY"):
        await update.message.reply_text("Ключ Gemini не задан.")
        return
    try:
        result = await asyncio.to_thread(gemini.analyze_meal_text, source_text)
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        print(f"Gemini text error: {e!r}")
        await update.message.reply_text(
            f"Не смог оценить. Ошибка: {msg}"
        )
        return

    user = await db.get_user(update.effective_user.id)
    await _store_and_reply(update, result, user)


async def _store_and_reply(update: Update, result: dict, user: dict):
    protein = float(result.get("protein_grams", 0) or 0)
    meal_name = result.get("meal_name") or "Прием пищи"

    await db.add_meal(
        telegram_user_id=update.effective_user.id,
        meal_description=meal_name,
        protein_grams=protein,
        user_id=user.get("id"),
    )

    meals = await db.get_today_meals(update.effective_user.id)
    total = sum(float(m["protein_grams"]) for m in meals)
    comment = _comment_on_track(total, user["protein_min"], user["protein_max"])

    reply = (
        f"Белок: {protein:.0f} г. "
        f"Итого сегодня: {total:.0f} г (цель {user['protein_min']}–{user['protein_max']}). "
        f"{comment}"
    )
    await update.message.reply_text(reply)


def _comment_on_track(total: float, min_target: int, max_target: int) -> str:
    if total < min_target:
        return "Пока ниже цели."
    if total > max_target:
        return "Уже выше цели."
    return "В цели."


def _parse_target_range(text: str):
    nums = [int(n) for n in re.findall(r"\d+", text)]
    if len(nums) < 2:
        return None
    protein_min, protein_max = nums[0], nums[1]
    if protein_min <= 0 or protein_max <= 0 or protein_min > protein_max:
        return None
    return protein_min, protein_max
