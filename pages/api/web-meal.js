import { requireAuth } from "../../lib/auth";
import {
  analyzeMealWithGemini,
  getSupabaseConfig,
  getTelegramUserId,
  supabaseHeaders,
  supabasePatch,
} from "../../lib/web";

async function getMealById(id) {
  const { baseUrl, key } = getSupabaseConfig();
  const url = new URL(`${baseUrl}/rest/v1/meals`);
  url.searchParams.set("select", "*");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(key),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase GET error: ${res.status} ${text}`);
  }

  const rows = await res.json();
  return rows?.[0] || null;
}

async function deleteMealById(id) {
  const { baseUrl, key } = getSupabaseConfig();
  const url = new URL(`${baseUrl}/rest/v1/meals`);
  url.searchParams.set("id", `eq.${id}`);

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      ...supabaseHeaders(key),
      Prefer: "return=representation",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase DELETE error: ${res.status} ${text}`);
  }

  return res.json();
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  const mealId = String(req.query?.id || "").trim();
  if (!mealId) {
    return res.status(400).json({ error: "Не передан id записи" });
  }

  try {
    const telegramUserId = getTelegramUserId();
    const meal = await getMealById(mealId);

    if (!meal) {
      return res.status(404).json({ error: "Запись не найдена" });
    }

    if (Number(meal.telegram_user_id) !== Number(telegramUserId)) {
      return res.status(403).json({ error: "Нет доступа к записи" });
    }

    if (req.method === "PATCH") {
      const mealDescription = String(req.body?.meal_description || "").trim();
      if (!mealDescription) {
        return res.status(400).json({ error: "Пустое описание блюда" });
      }

      const parsed = await analyzeMealWithGemini({
        type: "text",
        content: mealDescription,
      });

      const updatedRows = await supabasePatch(
        "meals",
        { id: `eq.${mealId}` },
        {
          meal_description: mealDescription,
          calories: parsed.calories,
          protein_grams: parsed.protein_grams,
          fat_grams: parsed.fat_grams,
          carb_grams: parsed.carb_grams,
          fiber_grams: parsed.fiber_grams,
        }
      );

      return res.status(200).json(updatedRows?.[0] || null);
    }

    if (req.method === "DELETE") {
      await deleteMealById(mealId);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Ошибка сервера" });
  }
}
