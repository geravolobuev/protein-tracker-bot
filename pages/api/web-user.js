import { getWebUserId, getUserAndTimezone, supabasePatch, supabasePost } from "../../lib/web";

export default async function handler(req, res) {
  try {
    const telegramUserId = getWebUserId();

    if (req.method === "GET") {
      const { user } = await getUserAndTimezone(telegramUserId);
      if (!user) {
        return res.status(200).json({
          telegram_user_id: telegramUserId,
          protein_min: null,
          protein_max: null,
        });
      }
      return res.status(200).json({
        telegram_user_id: telegramUserId,
        protein_min: user.protein_min,
        protein_max: user.protein_max,
      });
    }

    if (req.method === "POST") {
      const proteinMin = Number(req.body?.protein_min);
      const proteinMax = Number(req.body?.protein_max);
      if (!Number.isFinite(proteinMin) || !Number.isFinite(proteinMax) || proteinMin <= 0 || proteinMax <= 0 || proteinMin > proteinMax) {
        return res.status(400).json({ error: "Неверные цели по белку" });
      }

      const { user } = await getUserAndTimezone(telegramUserId);
      if (!user) {
        const created = await supabasePost("users", {
          telegram_user_id: telegramUserId,
          protein_min: proteinMin,
          protein_max: proteinMax,
          calories_target: null,
          timezone: "Europe/Moscow",
        });
        return res.status(200).json(created?.[0] || null);
      }

      const updated = await supabasePatch(
        "users",
        { telegram_user_id: `eq.${telegramUserId}` },
        { protein_min: proteinMin, protein_max: proteinMax }
      );
      return res.status(200).json(updated?.[0] || null);
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Ошибка сервера" });
  }
}
