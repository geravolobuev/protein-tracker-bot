import { getTelegramUserId, getUserAndTimezone, supabasePatch, supabasePost } from "../../lib/web";
import { requireAuth } from "../../lib/auth";

export default async function handler(req, res) {
  try {
    if (!requireAuth(req, res)) return;
    const telegramUserId = getTelegramUserId();

    if (req.method === "GET") {
      const { user } = await getUserAndTimezone(telegramUserId);
      if (!user) {
        return res.status(200).json({
          telegram_user_id: telegramUserId,
          protein_target: null,
        });
      }
      return res.status(200).json({
        telegram_user_id: telegramUserId,
        protein_target: user.protein_max ?? user.protein_min ?? null,
      });
    }

    if (req.method === "POST") {
      const proteinTarget = Number(req.body?.protein_target);
      if (!Number.isFinite(proteinTarget) || proteinTarget <= 0) {
        return res.status(400).json({ error: "Неверные цели по белку" });
      }

      const { user } = await getUserAndTimezone(telegramUserId);
      if (!user) {
        const created = await supabasePost("users", {
          telegram_user_id: telegramUserId,
          protein_min: proteinTarget,
          protein_max: proteinTarget,
          calories_target: null,
          timezone: "Europe/Moscow",
        });
        return res.status(200).json({
          telegram_user_id: telegramUserId,
          protein_target: created?.[0]?.protein_max ?? proteinTarget,
        });
      }

      const updated = await supabasePatch(
        "users",
        { telegram_user_id: `eq.${telegramUserId}` },
        { protein_min: proteinTarget, protein_max: proteinTarget }
      );
      return res.status(200).json({
        telegram_user_id: telegramUserId,
        protein_target: updated?.[0]?.protein_max ?? proteinTarget,
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Ошибка сервера" });
  }
}
