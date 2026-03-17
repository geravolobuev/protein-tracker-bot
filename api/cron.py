import os
import asyncio
from telegram import Bot
from bot import database as db


def _get_token():
    token = os.getenv("TELEGRAM_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_TOKEN не задан")
    return token


def _build_summary(meals, user):
    if not meals:
        return "Итог за сегодня: записей нет."
    total = sum(float(m["protein_grams"]) for m in meals)
    target = f"{user['protein_min']}–{user['protein_max']} г"
    return f"Итог за сегодня: {total:.0f} г (цель {target})."


async def _send_summaries():
    bot = Bot(_get_token())
    users = await db.get_all_users()
    for user in users:
        meals = await db.get_today_meals(user["telegram_user_id"])
        text = _build_summary(meals, user)
        try:
            await bot.send_message(chat_id=user["telegram_user_id"], text=text)
        except Exception:
            continue


async def handler(request):
    if request.method != "POST":
        return {"statusCode": 200, "body": "ok"}

    await _send_summaries()
    return {"statusCode": 200, "body": "ok"}

