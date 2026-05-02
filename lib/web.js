const DEFAULT_TZ = "Europe/Moscow";

export const MEAL_PROMPT =
  'Analyze this meal and estimate calories and macros. Assume a typical home portion size unless the user specifies weight. Do not overestimate. When uncertain between two values, use the lower one. Return JSON only: {"meal_name": "string", "calories": number, "protein_grams": number, "fat_grams": number, "carb_grams": number, "fiber_grams": number, "confidence": "low/medium/high"}. If input text is provided, keep the same dish name as input.';

export function envOrThrow(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} не задан`);
  return value;
}

export function getWebUserId() {
  const raw = envOrThrow("WEB_USER_ID");
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    throw new Error("WEB_USER_ID должен быть числом");
  }
  return id;
}

export function getSupabaseConfig() {
  const baseUrl = envOrThrow("SUPABASE_URL").replace(/\/$/, "");
  const key = envOrThrow("SUPABASE_KEY");
  return { baseUrl, key };
}

export function supabaseHeaders(key, includeJson = false) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
  };
}

export async function supabaseGet(path, params = {}) {
  const { baseUrl, key } = getSupabaseConfig();
  const url = new URL(`${baseUrl}/rest/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(key),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase GET error: ${res.status} ${text}`);
  }
  return res.json();
}

export async function supabasePost(path, body, prefer = "return=representation") {
  const { baseUrl, key } = getSupabaseConfig();
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(key, true),
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase POST error: ${res.status} ${text}`);
  }
  return res.json();
}

export async function supabasePatch(path, params, body, prefer = "return=representation") {
  const { baseUrl, key } = getSupabaseConfig();
  const url = new URL(`${baseUrl}/rest/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(key, true),
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase PATCH error: ${res.status} ${text}`);
  }
  return res.json();
}

export function parseModelJson(text) {
  const raw = (text || "").trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Gemini не вернул JSON");
  return JSON.parse(match[0]);
}

export async function analyzeMealWithGemini({ type, content }) {
  const apiKey = envOrThrow("GEMINI_API_KEY");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const parts =
    type === "image"
      ? [
          { text: MEAL_PROMPT },
          { inline_data: { mime_type: "image/jpeg", data: content } },
        ]
      : [{ text: `${MEAL_PROMPT}\n\n${content}` }];

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini error: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("\n") || "";
  const parsed = parseModelJson(text);

  const result = {
    meal_name: String(parsed.meal_name || (type === "text" ? content : "Прием пищи")),
    calories: Number(parsed.calories || 0),
    protein_grams: Number(parsed.protein_grams || 0),
    fat_grams: Number(parsed.fat_grams || 0),
    carb_grams: Number(parsed.carb_grams || 0),
    fiber_grams: Number(parsed.fiber_grams || 0),
    confidence: String(parsed.confidence || "low"),
  };

  if (!Number.isFinite(result.protein_grams)) result.protein_grams = 0;
  if (!Number.isFinite(result.calories)) result.calories = 0;
  if (!Number.isFinite(result.fat_grams)) result.fat_grams = 0;
  if (!Number.isFinite(result.carb_grams)) result.carb_grams = 0;
  if (!Number.isFinite(result.fiber_grams)) result.fiber_grams = 0;

  return result;
}

function dayBoundsUtc(date, timezone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = fmt.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);

  const utcGuessStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const utcGuessEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  const offsetMinutes = timezoneOffsetMinutes(utcGuessStart, timezone);
  const start = new Date(utcGuessStart.getTime() - offsetMinutes * 60000);
  const end = new Date(utcGuessEnd.getTime() - offsetMinutes * 60000);

  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function timezoneOffsetMinutes(date, timeZone) {
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

export async function getUserAndTimezone(telegramUserId) {
  const users = await supabaseGet("users", {
    select: "*",
    telegram_user_id: `eq.${telegramUserId}`,
    limit: "1",
  });

  const user = users?.[0] || null;
  const timezone = user?.timezone || DEFAULT_TZ;
  return { user, timezone };
}

export async function getTodayMealsAndTotals(telegramUserId, timezone = DEFAULT_TZ) {
  const { startIso, endIso } = dayBoundsUtc(new Date(), timezone);
  const params = new URLSearchParams();
  params.append("select", "*");
  params.append("telegram_user_id", `eq.${telegramUserId}`);
  params.append("created_at", `gte.${startIso}`);
  params.append("created_at", `lte.${endIso}`);
  params.append("order", "created_at.asc");

  const { baseUrl, key } = getSupabaseConfig();
  const res = await fetch(`${baseUrl}/rest/v1/meals?${params.toString()}`, {
    headers: supabaseHeaders(key),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase meals error: ${res.status} ${text}`);
  }
  const meals = await res.json();

  const totals = meals.reduce(
    (acc, meal) => {
      acc.calories += Number(meal.calories || 0);
      acc.protein_grams += Number(meal.protein_grams || 0);
      acc.fat_grams += Number(meal.fat_grams || 0);
      acc.carb_grams += Number(meal.carb_grams || 0);
      acc.fiber_grams += Number(meal.fiber_grams || 0);
      return acc;
    },
    {
      calories: 0,
      protein_grams: 0,
      fat_grams: 0,
      carb_grams: 0,
      fiber_grams: 0,
    }
  );

  return { meals, totals };
}
