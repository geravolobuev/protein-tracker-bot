import os
import asyncio
import threading
import traceback
from http.server import BaseHTTPRequestHandler
from telegram import Bot
from zoneinfo import ZoneInfo

_IMPORT_ERROR = None
try:
    from bot import database as db
except Exception:
    _IMPORT_ERROR = traceback.format_exc()


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
        tz_name = (user.get("timezone") or "Europe/Moscow").strip()
        tz = ZoneInfo(tz_name)
        meals = await db.get_today_meals(user["telegram_user_id"], tz)
        text = _build_summary(meals, user)
        try:
            await bot.send_message(chat_id=user["telegram_user_id"], text=text)
        except Exception:
            continue


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if _IMPORT_ERROR:
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(_IMPORT_ERROR.encode("utf-8"))
            print(_IMPORT_ERROR)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if _IMPORT_ERROR:
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(_IMPORT_ERROR.encode("utf-8"))
            print(_IMPORT_ERROR)
            return
        try:
            with _loop_lock:
                _loop.run_until_complete(_send_summaries())
        except Exception:
            err = traceback.format_exc()
            print(err)
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(err.encode("utf-8"))
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"ok")
_loop = asyncio.new_event_loop()
_loop_lock = threading.Lock()
asyncio.set_event_loop(_loop)
