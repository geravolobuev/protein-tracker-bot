import os
import json
import asyncio
from http.server import BaseHTTPRequestHandler
from telegram import Update
from bot.handlers import build_application

_app = None
_app_lock = asyncio.Lock()


def _get_token():
    token = os.getenv("TELEGRAM_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_TOKEN не задан")
    return token


async def _get_app():
    global _app
    if _app:
        return _app
    async with _app_lock:
        if _app:
            return _app
        _app = build_application(_get_token())
        await _app.initialize()
        return _app


async def _handle_update(data: dict):
    app = await _get_app()
    update = Update.de_json(data, app.bot)
    await app.process_update(update)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"bad request")
            return

        asyncio.run(_handle_update(data))
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"ok")
