import os
import asyncio
from datetime import datetime, timezone
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
            "protein_min": protein_min,
            "protein_max": protein_max,
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
    protein_grams: float,
    user_id: str | None = None,
):
    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/meals"
        payload = {
            "telegram_user_id": telegram_user_id,
            "meal_description": meal_description,
            "protein_grams": protein_grams,
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


def _today_range_utc():
    now_msk = datetime.now(_MSK)
    start_msk = now_msk.replace(hour=0, minute=0, second=0, microsecond=0)
    end_msk = start_msk.replace(hour=23, minute=59, second=59, microsecond=999999)
    start_utc = start_msk.astimezone(timezone.utc)
    end_utc = end_msk.astimezone(timezone.utc)
    return start_utc.isoformat(), end_utc.isoformat()


async def get_today_meals(telegram_user_id: int):
    start_iso, end_iso = _today_range_utc()

    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/meals"
        params = {
            "select": "*",
            "telegram_user_id": f"eq.{telegram_user_id}",
            "created_at": f"gte.{start_iso}",
            "created_at": f"lte.{end_iso}",
            "order": "created_at.asc",
        }
        with httpx.Client(timeout=10) as client:
            res = client.get(url, headers=_headers(key), params=params)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res or []


async def delete_today_meals(telegram_user_id: int):
    start_iso, end_iso = _today_range_utc()

    def _run():
        base, key = _get_config()
        url = f"{base}/rest/v1/meals"
        params = {
            "telegram_user_id": f"eq.{telegram_user_id}",
            "created_at": f"gte.{start_iso}",
            "created_at": f"lte.{end_iso}",
        }
        headers = _headers(key)
        headers["Prefer"] = "return=representation"
        with httpx.Client(timeout=10) as client:
            res = client.delete(url, headers=headers, params=params)
            res.raise_for_status()
            return res.json()

    res = await asyncio.to_thread(_run)
    return res or []
