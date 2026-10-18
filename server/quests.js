// GET /api/quests   這週的每週任務、累積完成幾週、連續打卡（每一級都可以用）
import { requireMember, route, weeklyQuests, checkin } from "./lib/index.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    if (!ctx.member) return res.status(200).json({ quests: null, streak: null });
    const [q, streak] = await Promise.all([
      weeklyQuests(ctx.user.id, { created_at: ctx.member.created_at || ctx.user.created_at }),
      checkin(ctx.user.id),
    ]);
    return res.status(200).json({ ...q, delta: undefined, streak });
  },
});
