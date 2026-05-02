import { getTodayMealsAndTotals, getUserAndTimezone, getWebUserId } from "../../lib/web";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const telegramUserId = getWebUserId();
    const { user, timezone } = await getUserAndTimezone(telegramUserId);
    const { meals, totals } = await getTodayMealsAndTotals(telegramUserId, timezone);

    return res.status(200).json({
      timezone,
      target: {
        protein_min: user?.protein_min ?? null,
        protein_max: user?.protein_max ?? null,
      },
      meals,
      totals,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Ошибка сервера" });
  }
}
