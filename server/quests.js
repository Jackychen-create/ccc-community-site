// GET /api/quests   本週小目標（選做）、累積完成幾週、連續打卡（每一級都可以用）
import { requireMember, route, weeklyQuests, checkin } from "./lib/index.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    if (!ctx.member) return res.status(200).json({ quests: null, streak: null });
    const streak = await checkin(ctx.user.id); // 先打卡，「這週打開網站 3 天」才算得到今天
    const q = await weeklyQuests(ctx.user.id);
    return res.status(200).json({ ...q, streak });
  },
});
