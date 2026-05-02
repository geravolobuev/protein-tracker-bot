import {
  analyzeMealWithGemini,
  getTodayMealsAndTotals,
  getUserAndTimezone,
  getWebUserId,
  supabasePost,
} from "../../lib/web";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const telegramUserId = getWebUserId();
    const type = req.body?.type;
    const content = String(req.body?.content || "").trim();

    if (!["text", "image"].includes(type)) {
      return res.status(400).json({ error: "Неверный type" });
    }
    if (!content) {
      return res.status(400).json({ error: "Пустой content" });
    }

    const parsed = await analyzeMealWithGemini({ type, content });
    const { user, timezone } = await getUserAndTimezone(telegramUserId);

    await supabasePost("meals", {
      user_id: user?.id || null,
      telegram_user_id: telegramUserId,
      meal_description: parsed.meal_name,
      calories: parsed.calories,
      protein_grams: parsed.protein_grams,
      fat_grams: parsed.fat_grams,
      carb_grams: parsed.carb_grams,
      fiber_grams: parsed.fiber_grams,
    });

    const { totals } = await getTodayMealsAndTotals(telegramUserId, timezone);

    return res.status(200).json({
      protein_grams: parsed.protein_grams,
      calories: parsed.calories,
      meal_name: parsed.meal_name,
      daily_total: totals.protein_grams,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Ошибка сервера" });
  }
}
