import os
import asyncio
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from supabase import create_client

_MSK = ZoneInfo("Europe/Moscow")


def _get_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL или SUPABASE_KEY не заданы")
    return create_client(url, key)


async def get_user(telegram_user_id: int):
    def _run():
        client = _get_client()
        return (
            client.table("users")
            .select("*")
            .eq("telegram_user_id", telegram_user_id)
            .limit(1)
            .execute()
        )

    res = await asyncio.to_thread(_run)
    return res.data[0] if res.data else None


async def create_user(telegram_user_id: int, protein_min: int, protein_max: int):
    def _run():
        client = _get_client()
        payload = {
            "telegram_user_id": telegram_user_id,
            "protein_min": protein_min,
            "protein_max": protein_max,
        }
        return client.table("users").insert(payload).execute()

    res = await asyncio.to_thread(_run)
    return res.data[0] if res.data else None


async def get_all_users():
    def _run():
        client = _get_client()
        return client.table("users").select("*").execute()

    res = await asyncio.to_thread(_run)
    return res.data or []


async def add_meal(
    telegram_user_id: int,
    meal_description: str,
    protein_grams: float,
    user_id: str | None = None,
):
    def _run():
        client = _get_client()
        payload = {
            "telegram_user_id": telegram_user_id,
            "meal_description": meal_description,
            "protein_grams": protein_grams,
            "user_id": user_id,
        }
        return client.table("meals").insert(payload).execute()

    res = await asyncio.to_thread(_run)
    return res.data[0] if res.data else None


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
        client = _get_client()
        return (
            client.table("meals")
            .select("*")
            .eq("telegram_user_id", telegram_user_id)
            .gte("created_at", start_iso)
            .lte("created_at", end_iso)
            .order("created_at")
            .execute()
        )

    res = await asyncio.to_thread(_run)
    return res.data or []


async def delete_today_meals(telegram_user_id: int):
    start_iso, end_iso = _today_range_utc()

    def _run():
        client = _get_client()
        return (
            client.table("meals")
            .delete()
            .eq("telegram_user_id", telegram_user_id)
            .gte("created_at", start_iso)
            .lte("created_at", end_iso)
            .execute()
        )

    res = await asyncio.to_thread(_run)
    return res.data or []
