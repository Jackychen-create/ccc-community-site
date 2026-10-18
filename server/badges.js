// GET   /api/badges                徽章：重新算一次，新拿到的記下來；回傳全部徽章（拿到的、還沒拿到的、進度）
// PATCH /api/badges { seen: true }  看過新徽章的恭喜了
import { supabaseAdmin, requireMember, readBody, route, getThreshold, syncBadges } from "./lib/index.js";
import { BADGES } from "../public/assets/js/shared/rules.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    // 管理員沒有研究員資料：徽章全部顯示，但沒有拿到
    if (!ctx.member) return res.status(200).json({ badges: [], all: BADGES.map(({ id, icon, name, desc }) => ({ id, icon, name, desc })), progress: null });
    const threshold = await getThreshold();
    const { facts, badges } = await syncBadges(ctx.user.id, { created_at: ctx.member.created_at || ctx.user.created_at }, threshold);
    return res.status(200).json({
      badges,
      all: BADGES.map(({ id, icon, name, desc }) => ({ id, icon, name, desc })),
      // 還沒拿到的徽章顯示進度用
      progress: { bestPct: Math.min(100, Math.round(facts.bestPct)), streak: facts.streak, liveDone: facts.liveDone, courseDone: facts.courseDone, notes: facts.notes, questions: facts.questions, hostsDone: facts.hostsDone },
    });
  },

  async PATCH(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    if (!ctx.member) return res.status(200).json({ ok: true });
    const b = readBody(req);
    if (b.seen !== true) return res.status(400).json({ error: "資料不正確" });
    const { error } = await supabaseAdmin.from("badges").update({ seen: true }).eq("user_id", ctx.user.id).eq("seen", false);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  },
});
