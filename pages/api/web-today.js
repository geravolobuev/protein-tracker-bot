import { getTodayMealsAndTotals, getUserAndTimezone, getTelegramUserId } from "../../lib/web";
import { requireAuth } from "../../lib/auth";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    if (!requireAuth(req, res)) return;
    const telegramUserId = getTelegramUserId();
    const { user, timezone } = await getUserAndTimezone(telegramUserId);
    const { meals, totals } = await getTodayMealsAndTotals(telegramUserId, timezone);

    return res.status(200).json({
      timezone,
      target: {
        protein_target: user?.protein_max ?? user?.protein_min ?? null,
      },
      meals,
      totals,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Ошибка сервера" });
  }
}
