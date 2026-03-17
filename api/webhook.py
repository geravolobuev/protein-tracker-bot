import os
import json
import asyncio
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


async def _get_update_json(request):
    if hasattr(request, "json"):
        data = request.json
        if callable(data):
            data = data()
        if asyncio.iscoroutine(data):
            data = await data
        if isinstance(data, dict):
            return data
    if hasattr(request, "get_json"):
        data = request.get_json()
        if asyncio.iscoroutine(data):
            data = await data
        return data
    if hasattr(request, "body"):
        body = request.body
        if asyncio.iscoroutine(body):
            body = await body
        if isinstance(body, (bytes, bytearray)):
            return json.loads(body)
        if isinstance(body, str):
            return json.loads(body)
    raise ValueError("Не удалось прочитать update")


async def handler(request):
    if request.method != "POST":
        return {"statusCode": 200, "body": "ok"}

    app = await _get_app()
    data = await _get_update_json(request)
    update = Update.de_json(data, app.bot)
    await app.process_update(update)
    return {"statusCode": 200, "body": "ok"}

