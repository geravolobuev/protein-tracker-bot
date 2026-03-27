import os
import asyncio
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import httpx

_MSK = ZoneInfo("Europe/Moscow")


def _get_config():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL или SUPABASE_KEY не заданы")
    return url.rstrip("/"), key


def _headers(key: str):
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


async def get_user(telegram_user_id: int):
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/users"
        params = {
            "select": "*",
            "telegram_user_id": f"eq.{telegram_user_id}",
            "limit": 1,
        }
        with httpx.Client(timeout=10) as client:
            res = client.get(url, headers=_headers(key), params=params)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res[0] if res else None


async def create_user(telegram_user_id: int, protein_min: int, protein_max: int):
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/users"
        payload = {
            "telegram_user_id": telegram_user_id,
            "calories_target": None,
            "protein_min": protein_min,
            "protein_max": protein_max,
            "timezone": "Europe/Moscow",
        }
        headers = _headers(key)
        headers["Prefer"] = "return=representation"
        with httpx.Client(timeout=10) as client:
            res = client.post(url, headers=headers, json=payload)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res[0] if res else None


async def update_user(telegram_user_id: int, protein_min: int, protein_max: int):
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/users"
        payload = {
            "protein_min": protein_min,
            "protein_max": protein_max,
        }
        params = {"telegram_user_id": f"eq.{telegram_user_id}"}
        headers = _headers(key)
        headers["Prefer"] = "return=representation"
        with httpx.Client(timeout=10) as client:
            res = client.patch(url, headers=headers, params=params, json=payload)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res[0] if res else None


async def update_user_calories(telegram_user_id: int, calories_target: int):
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/users"
        payload = {"calories_target": calories_target}
        params = {"telegram_user_id": f"eq.{telegram_user_id}"}
        headers = _headers(key)
        headers["Prefer"] = "return=representation"
        with httpx.Client(timeout=10) as client:
            res = client.patch(url, headers=headers, params=params, json=payload)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res[0] if res else None


async def update_user_timezone(telegram_user_id: int, timezone: str):
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/users"
        payload = {"timezone": timezone}
        params = {"telegram_user_id": f"eq.{telegram_user_id}"}
        headers = _headers(key)
        headers["Prefer"] = "return=representation"
        with httpx.Client(timeout=10) as client:
            res = client.patch(url, headers=headers, params=params, json=payload)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res[0] if res else None


async def set_pending_meal(telegram_user_id: int, text: str | None):
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/users"
        payload = {
            "pending_meal_text": text,
            "pending_meal_created_at": datetime.now(timezone.utc).isoformat() if text else None,
        }
        params = {"telegram_user_id": f"eq.{telegram_user_id}"}
        headers = _headers(key)
        headers["Prefer"] = "return=representation"
        with httpx.Client(timeout=10) as client:
            res = client.patch(url, headers=headers, params=params, json=payload)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res[0] if res else None


async def get_all_users():
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/users"
        params = {"select": "*"}
        with httpx.Client(timeout=10) as client:
            res = client.get(url, headers=_headers(key), params=params)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res or []


async def add_meal(
    telegram_user_id: int,
    meal_description: str,
    calories: float,
    protein_grams: float,
    fat_grams: float,
    carb_grams: float,
    fiber_grams: float,
    user_id: str | None = None,
):
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/meals"
        payload = {
            "telegram_user_id": telegram_user_id,
            "meal_description": meal_description,
            "calories": calories,
            "protein_grams": protein_grams,
            "fat_grams": fat_grams,
            "carb_grams": carb_grams,
            "fiber_grams": fiber_grams,
            "user_id": user_id,
        }
        headers = _headers(key)
        headers["Prefer"] = "return=representation"
        with httpx.Client(timeout=10) as client:
            res = client.post(url, headers=headers, json=payload)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res[0] if res else None


def _day_range_utc(day: datetime):
    start_local = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = day.replace(hour=23, minute=59, second=59, microsecond=999999)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    return start_utc.isoformat(), end_utc.isoformat()


def _today_range_utc(tz: ZoneInfo):
    now_local = datetime.now(tz)
    return _day_range_utc(now_local)


def _yesterday_range_utc(tz: ZoneInfo):
    now_local = datetime.now(tz)
    yesterday = now_local - timedelta(days=1)
    return _day_range_utc(yesterday)


async def get_today_meals(telegram_user_id: int, tz):
    start_iso, end_iso = _today_range_utc(tz)

    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/meals"
        params = [
            ("select", "*"),
            ("telegram_user_id", f"eq.{telegram_user_id}"),
            ("created_at", f"gte.{start_iso}"),
            ("created_at", f"lte.{end_iso}"),
            ("order", "created_at.asc"),
        ]
        with httpx.Client(timeout=10) as client:
            res = client.get(url, headers=_headers(key), params=params)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res or []


async def delete_today_meals(telegram_user_id: int, tz):
    start_iso, end_iso = _today_range_utc(tz)

    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/meals"
        params = [
            ("telegram_user_id", f"eq.{telegram_user_id}"),
            ("created_at", f"gte.{start_iso}"),
            ("created_at", f"lte.{end_iso}"),
        ]
        headers = _headers(key)
        headers["Prefer"] = "return=representation"
        with httpx.Client(timeout=10) as client:
            res = client.delete(url, headers=headers, params=params)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res or []


async def get_meals_between(telegram_user_id: int, start_iso: str, end_iso: str):
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/meals"
        params = [
            ("select", "*"),
            ("telegram_user_id", f"eq.{telegram_user_id}"),
            ("created_at", f"gte.{start_iso}"),
            ("created_at", f"lte.{end_iso}"),
            ("order", "created_at.asc"),
        ]
        with httpx.Client(timeout=10) as client:
            res = client.get(url, headers=_headers(key), params=params)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res or []
