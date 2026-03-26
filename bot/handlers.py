import os
import re
import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from telegram import Update, BotCommand, BotCommandScopeDefault, BotCommandScopeAllPrivateChats
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
    app = Application.builder().token(token).post_init(_post_init).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("target", set_target))
    app.add_handler(CommandHandler("yesterday", yesterday))
    app.add_handler(CommandHandler("week", week))
    app.add_handler(CommandHandler("timezone", set_timezone))
    app.add_handler(CommandHandler("today", today))
    app.add_handler(CommandHandler("reset", reset_today))
    app.add_handler(CommandHandler("menu", refresh_menu))

    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

    return app


async def _post_init(app: Application):
    commands = [
        BotCommand("start", "Начать"),
        BotCommand("target", "Изменить цель"),
        BotCommand("yesterday", "Лог за вчера"),
        BotCommand("week", "Лог за 7 дней"),
        BotCommand("timezone", "Часовой пояс"),
        BotCommand("today", "Лог за день"),
        BotCommand("reset", "Обнулить день"),
        BotCommand("menu", "Обновить меню"),
    ]
    await app.bot.set_my_commands(commands, scope=BotCommandScopeDefault())
    await app.bot.set_my_commands(commands, scope=BotCommandScopeAllPrivateChats())


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Привет! Укажи цель по белку на день одним числом, например 160."
    )


async def today(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return

    tz = _get_user_tz(user)
    meals = await db.get_today_meals(update.effective_user.id, tz)
    if not meals:
        await update.message.reply_text("Сегодня записей нет.")
        return

    totals = _sum_meals(meals)
    lines = [
        f"{i}. {m['meal_description']}"
        for i, m in enumerate(meals, start=1)
    ]
    text = _format_day_summary(
        "Сегодня", lines, totals, user
    )
    await update.message.reply_text(text)


async def set_target(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = " ".join(context.args or []).strip()
    if not text:
        await update.message.reply_text("Укажи цель: белок (и опционально калории). Пример: 160 или 1500 160")
        return
    calories_target = None
    protein_min = None
    protein_max = None
    nums = [int(n) for n in re.findall(r"\d+", text)]
    if len(nums) == 2:
        calories_target = nums[0]
        protein_min = nums[1]
        protein_max = nums[1]
    elif len(nums) == 1:
        protein_min = nums[0]
        protein_max = nums[0]
    else:
        await update.message.reply_text("Не понял. Пример: 160 или 1500 160")
        return
    user = await db.get_user(update.effective_user.id)
    if not user:
        await db.create_user(update.effective_user.id, protein_min, protein_max)
    else:
        await db.update_user(update.effective_user.id, protein_min, protein_max)
    if calories_target is not None:
        await db.update_user_calories(update.effective_user.id, calories_target)
    calories_str = f"{calories_target} каллорий" if calories_target is not None else "— каллорий"
    await update.message.reply_text(
        f"☑️ Цель записана: {protein_min} грамм белка и {calories_str}."
    )


async def yesterday(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return
    tz = _get_user_tz(user)
    day = datetime.now(tz) - timedelta(days=1)
    start = day.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    end = day.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(timezone.utc)
    meals = await db.get_meals_between(update.effective_user.id, start.isoformat(), end.isoformat())
    if not meals:
        await update.message.reply_text("Вчера записей нет.")
        return
    totals = _sum_meals(meals)
    lines = [
        f"{i}. {m['meal_description']}"
        for i, m in enumerate(meals, start=1)
    ]
    text = _format_day_summary("Вчера", lines, totals, user)
    await update.message.reply_text(text)


async def week(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return
    tz = _get_user_tz(user)
    end_day = datetime.now(tz)
    start_day = end_day - timedelta(days=6)
    start = start_day.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    end = end_day.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(timezone.utc)
    meals = await db.get_meals_between(
        update.effective_user.id, start.isoformat(), end.isoformat()
    )
    totals_by_day = {}
    for m in meals:
        created_at = m.get("created_at")
        if not created_at:
            continue
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00")).astimezone(tz)
        key = dt.date().isoformat()
        totals_by_day[key] = totals_by_day.get(key, 0.0) + float(m["protein_grams"])

    days = []
    for i in range(6, -1, -1):
        day = (end_day - timedelta(days=i)).date()
        key = day.isoformat()
        total = totals_by_day.get(key, 0.0)
        status = _day_status(total, user["protein_min"], user["protein_max"])
        days.append(f"{day.strftime('%d.%m')}: {total:.0f} г — {status}")

    if not any(totals_by_day.values()):
        await update.message.reply_text("За 7 дней записей нет.")
        return

    text = "За 7 дней:\n" + "\n".join(days)
    await update.message.reply_text(text)


async def set_timezone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return
    text = " ".join(context.args or []).strip()
    if not text:
        tz = user.get("timezone") or "Europe/Moscow"
        await update.message.reply_text(
            f"Текущий часовой пояс: {tz}\n"
            "Напиши город/страну (например: Тбилиси, Алматы) или формат UTC+3."
        )
        return
    tzinfo, tz_name = _parse_timezone(text)
    if not tzinfo:
        try:
            guess = await asyncio.to_thread(gemini.detect_timezone, text)
        except Exception as e:
            msg = str(e) or e.__class__.__name__
            await update.message.reply_text(f"Не смог определить пояс. Ошибка: {msg}")
            return
        if not guess:
            await update.message.reply_text(
                "Не понял. Пример: Europe/Moscow или UTC+3"
            )
            return
        tzinfo, tz_name = _parse_timezone(guess)
        if not tzinfo:
            await update.message.reply_text(
                "Не удалось распознать пояс. Попробуй формат UTC+3."
            )
            return
    await db.update_user_timezone(update.effective_user.id, tz_name)
    await update.message.reply_text(f"Часовой пояс сохранён: {tz_name}")


async def refresh_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    commands = [
        BotCommand("start", "Начать"),
        BotCommand("target", "Изменить цель"),
        BotCommand("yesterday", "Лог за вчера"),
        BotCommand("week", "Лог за 7 дней"),
        BotCommand("timezone", "Часовой пояс"),
        BotCommand("today", "Лог за день"),
        BotCommand("reset", "Обнулить день"),
        BotCommand("menu", "Обновить меню"),
    ]
    await context.application.bot.set_my_commands(commands, scope=BotCommandScopeDefault())
    await context.application.bot.set_my_commands(commands, scope=BotCommandScopeAllPrivateChats())
    await update.message.reply_text("Меню обновлено. Открой чат заново.")


async def reset_today(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = await db.get_user(update.effective_user.id)
    if not user:
        await update.message.reply_text(
            "Сначала укажи цель по белку в формате 140-180 г."
        )
        return

    tz = _get_user_tz(user)
    await db.delete_today_meals(update.effective_user.id, tz)
    await update.message.reply_text("Записи за сегодня очищены.")


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (update.message.text or "").strip()
    user = await db.get_user(update.effective_user.id)

    if not user:
        nums = [int(n) for n in re.findall(r"\d+", text)]
        if len(nums) != 1:
            await update.message.reply_text(
                "Укажи цель по белку одним числом, например 160."
            )
            return
        protein_target = nums[0]
        await db.create_user(update.effective_user.id, protein_target, protein_target)
        await update.message.reply_text(
            f"Цель сохранена: {protein_target} г."
        )
        return

    # If user already has target, require meaningful text (not just numbers)
    if not re.search(r"[A-Za-zА-Яа-я]", text):
        await update.message.reply_text("Опиши блюдо словами.")
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
    await _store_and_reply(update, result, user, source_text=source_text)


async def _store_and_reply(update: Update, result: dict, user: dict, source_text: str | None = None):
    meal_name = _pick_meal_name(result, source_text)
    calories = float(result.get("calories", 0) or 0)
    protein = float(result.get("protein_grams", 0) or 0)
    fat = float(result.get("fat_grams", 0) or 0)
    carbs = float(result.get("carb_grams", 0) or 0)
    fiber = float(result.get("fiber_grams", 0) or 0)

    await db.add_meal(
        telegram_user_id=update.effective_user.id,
        meal_description=meal_name,
        calories=calories,
        protein_grams=protein,
        fat_grams=fat,
        carb_grams=carbs,
        fiber_grams=fiber,
        user_id=user.get("id"),
    )

    tz = _get_user_tz(user)
    meals = await db.get_today_meals(update.effective_user.id, tz)
    totals = _sum_meals(meals)
    reply = _format_meal_reply(meal_name, calories, protein, fat, carbs, fiber, totals, user)
    await update.message.reply_text(reply)


def _comment_on_track(total: float, min_target: int, max_target: int) -> str:
    if total < min_target:
        return "Пока ниже цели."
    if total > max_target:
        return "Уже выше цели."
    return "В цели."


def _day_status(total: float, min_target: int, max_target: int) -> str:
    if total < min_target:
        return "недобор"
    if total > max_target:
        return "перебор"
    return "в цели"


def _pick_meal_name(result: dict, source_text: str | None):
    if source_text:
        return source_text.strip()
    return (result.get("meal_name") or "Прием пищи").strip()


def _sum_meals(meals: list[dict]):
    totals = {
        "calories": 0.0,
        "protein": 0.0,
        "fat": 0.0,
        "carb": 0.0,
        "fiber": 0.0,
    }
    for m in meals:
        totals["calories"] += float(m.get("calories", 0) or 0)
        totals["protein"] += float(m.get("protein_grams", 0) or 0)
        totals["fat"] += float(m.get("fat_grams", 0) or 0)
        totals["carb"] += float(m.get("carb_grams", 0) or 0)
        totals["fiber"] += float(m.get("fiber_grams", 0) or 0)
    return totals


def _format_meal_reply(meal_name, calories, protein, fat, carbs, fiber, totals, user):
    cal_target = user.get("calories_target")
    protein_min = user.get("protein_min")
    protein_max = user.get("protein_max")
    cal_status = "⚠️"
    if cal_target:
        cal_status = "✅" if totals["calories"] >= float(cal_target) else "⚠️"
    protein_status = "✅" if protein_min <= totals["protein"] <= protein_max else "⚠️"
    protein_target_str = (
        f"{protein_min:.0f}–{protein_max:.0f}"
        if protein_min != protein_max
        else f"{protein_min:.0f}"
    )
    cal_target_str = f"{float(cal_target):.0f}" if cal_target else "—"

    return (
        f"☑️ Записано: {meal_name}.\n\n"
        "🍽️ Текущий прием:\n"
        f"Калории: {calories:.0f}кл\n"
        f"Белок: {protein:.0f}г\n"
        f"Жиры: {fat:.0f}г\n"
        f"Углеводы: {carbs:.0f}г\n"
        f"Клетчатка: {fiber:.0f}г\n\n"
        "📊 Сьедено / Цель:\n"
        f"Калории: {totals['calories']:.0f} / {cal_target_str} {cal_status}\n"
        f"Белок: {totals['protein']:.0f} / {protein_target_str} {protein_status}\n"
        f"Жиры: {totals['fat']:.1f}г\n"
        f"Углеводы: {totals['carb']:.1f}г\n"
        f"Клетчатка: {totals['fiber']:.1f}г"
    )


def _format_day_summary(title: str, lines: list[str], totals: dict, user: dict):
    cal_target = user.get("calories_target")
    protein_min = user.get("protein_min")
    protein_max = user.get("protein_max")
    cal_status = "⚠️"
    if cal_target:
        cal_status = "✅" if totals["calories"] >= float(cal_target) else "⚠️"
    protein_status = "✅" if protein_min <= totals["protein"] <= protein_max else "⚠️"
    protein_target_str = (
        f"{protein_min:.0f}–{protein_max:.0f}"
        if protein_min != protein_max
        else f"{protein_min:.0f}"
    )
    cal_target_str = f"{float(cal_target):.0f}" if cal_target else "—"

    return (
        f"{title}:\n"
        + "\n".join(lines)
        + "\n\n📊 Сьедено / Цель:\n"
        + f"Калории: {totals['calories']:.0f} / {cal_target_str} {cal_status}\n"
        + f"Белок: {totals['protein']:.0f} / {protein_target_str} {protein_status}\n"
        + f"Жиры: {totals['fat']:.1f}г\n"
        + f"Углеводы: {totals['carb']:.1f}г\n"
        + f"Клетчатка: {totals['fiber']:.1f}г"
    )


def _parse_target_range(text: str):
    nums = [int(n) for n in re.findall(r"\d+", text)]
    if len(nums) < 2:
        return None
    protein_min, protein_max = nums[0], nums[1]
    if protein_min <= 0 or protein_max <= 0 or protein_min > protein_max:
        return None
    return protein_min, protein_max


def _get_user_tz(user: dict):
    tz_name = (user.get("timezone") or "Europe/Moscow").strip()
    tzinfo, _ = _parse_timezone(tz_name)
    return tzinfo or ZoneInfo("Europe/Moscow")


def _parse_timezone(value: str):
    val = value.strip()
    if val.upper().startswith("UTC"):
        m = re.match(r"^UTC([+-])(\d{1,2})(?::?(\d{2}))?$", val.upper())
        if not m:
            return None, None
        sign = 1 if m.group(1) == "+" else -1
        hours = int(m.group(2))
        minutes = int(m.group(3) or "0")
        offset = timedelta(hours=hours, minutes=minutes) * sign
        tzinfo = timezone(offset)
        return tzinfo, f"UTC{m.group(1)}{hours:02d}:{minutes:02d}"
    try:
        tzinfo = ZoneInfo(val)
        return tzinfo, val
    except Exception:
        return None, None
