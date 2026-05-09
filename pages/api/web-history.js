import { requireAuth } from "../../lib/auth";
import { getSupabaseConfig, getTelegramUserId, getUserAndTimezone, supabaseHeaders } from "../../lib/web";

function tzOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

function dateInTz(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

function dayBoundsByYmd(ymd, timeZone) {
  const [y, m, d] = ymd.split("-").map(Number);
  const startGuess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const endGuess = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  const offset = tzOffsetMinutes(startGuess, timeZone);
  const start = new Date(startGuess.getTime() - offset * 60000);
  const end = new Date(endGuess.getTime() - offset * 60000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function shiftYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function sumMeals(meals) {
  return meals.reduce(
    (acc, meal) => {
      acc.protein_grams += Number(meal.protein_grams || 0);
      acc.calories += Number(meal.calories || 0);
      return acc;
    },
    { protein_grams: 0, calories: 0 }
  );
}

async function fetchMealsByBounds(telegramUserId, startIso, endIso) {
  const { baseUrl, key } = getSupabaseConfig();
  const params = new URLSearchParams();
  params.append("select", "*");
  params.append("telegram_user_id", `eq.${telegramUserId}`);
  params.append("created_at", `gte.${startIso}`);
  params.append("created_at", `lte.${endIso}`);
  params.append("order", "created_at.asc");

  const res = await fetch(`${baseUrl}/rest/v1/meals?${params.toString()}`, {
    headers: supabaseHeaders(key),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase meals error: ${res.status} ${text}`);
  }
  return res.json();
}

async function hasOlderMeals(telegramUserId, beforeIso) {
  const { baseUrl, key } = getSupabaseConfig();
  const params = new URLSearchParams();
  params.append("select", "id");
  params.append("telegram_user_id", `eq.${telegramUserId}`);
  params.append("created_at", `lt.${beforeIso}`);
  params.append("limit", "1");

  const res = await fetch(`${baseUrl}/rest/v1/meals?${params.toString()}`, {
    headers: supabaseHeaders(key),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase meals error: ${res.status} ${text}`);
  }
  const rows = await res.json();
  return rows.length > 0;
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const telegramUserId = getTelegramUserId();
    const { user, timezone } = await getUserAndTimezone(telegramUserId);

    const date = String(req.query?.date || "").trim();
    const range = String(req.query?.range || "").trim();
    const offset = Number(req.query?.offset || 0);

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Неверный формат date" });
      }
      const { startIso, endIso } = dayBoundsByYmd(date, timezone);
      const meals = await fetchMealsByBounds(telegramUserId, startIso, endIso);
      const totals = sumMeals(meals);
      return res.status(200).json({ date, meals, totals });
    }

    if (range === "7") {
      const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
      const todayYmd = dateInTz(new Date(), timezone);
      const baseYmd = shiftYmd(todayYmd, -1);
      const startYmd = shiftYmd(baseYmd, -safeOffset);
      const endYmd = shiftYmd(startYmd, -6);

      const { startIso: oldestStartIso } = dayBoundsByYmd(endYmd, timezone);
      const { endIso: newestEndIso } = dayBoundsByYmd(startYmd, timezone);

      const meals = await fetchMealsByBounds(telegramUserId, oldestStartIso, newestEndIso);

      const byDate = new Map();
      for (const meal of meals) {
        const ymd = dateInTz(new Date(meal.created_at), timezone);
        if (!byDate.has(ymd)) byDate.set(ymd, []);
        byDate.get(ymd).push(meal);
      }

      const proteinTarget = Number(user?.protein_max ?? user?.protein_min ?? 0);
      const days = [];
      for (let i = 0; i < 7; i += 1) {
        const ymd = shiftYmd(startYmd, -i);
        const dayMeals = byDate.get(ymd) || [];
        const totals = sumMeals(dayMeals);
        days.push({
          date: ymd,
          protein_grams: totals.protein_grams,
          calories: totals.calories,
          in_target: proteinTarget > 0 && totals.protein_grams >= proteinTarget,
        });
      }

      const hasMore = await hasOlderMeals(telegramUserId, oldestStartIso);
      return res.status(200).json({ days, has_more: hasMore });
    }

    return res.status(400).json({ error: "Нужен параметр range=7 или date=YYYY-MM-DD" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Ошибка сервера" });
  }
}
