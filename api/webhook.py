import os
import json
import asyncio
import traceback
from http.server import BaseHTTPRequestHandler
from telegram import Update

_IMPORT_ERROR = None
try:
    from bot.handlers import build_application
except Exception:
    _IMPORT_ERROR = traceback.format_exc()

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
        if _IMPORT_ERROR:
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(_IMPORT_ERROR.encode("utf-8"))
            print(_IMPORT_ERROR)
            return
        missing = []
        if not os.getenv("TELEGRAM_TOKEN"):
            missing.append("TELEGRAM_TOKEN")
        if missing:
            msg = f"missing env: {', '.join(missing)}"
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(msg.encode("utf-8"))
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
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"bad request")
            return

        try:
            asyncio.run(_handle_update(data))
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
