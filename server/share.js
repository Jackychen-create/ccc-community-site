// POST /api/share { level }   研究員升級後按「分享到 Discord」：在後台設的升級慶祝頻道貼一張等級卡
// 只有研究員自己按才會發（不會自動公開誰升級）；同一輪同一級只能分享一次；卡片不放交易量
import { supabaseAdmin, requireMember, readBody, route, toInt, todayTW, getDiscordSettings, discordConfigured, sendMessage, discordIds } from "./lib/index.js";
import { tierName, tierInfo, streakOf, MAX_TIER, addDays } from "../public/assets/js/shared/rules.js";

const SITE = "https://ccc-community-site.pages.dev";
const LOGO = `${SITE}/assets/brand/ccc-bot.png`;
const COLOR = { 1: 0xb9784a, 2: 0xb9c4cb, 3: 0xcda45e };
const ICON = { 1: "🥉", 2: "🥈", 3: "🏆" };

export function levelCard({ level, discordId, streak = 0, badges = 0 }) {
  const who = discordId ? `<@${discordId}>` : "一位研究員";
  const fields = [{ name: "🔓 解鎖", value: tierInfo(level).perks.map((p) => `✓ ${p}`).join("\n") || "—" }];
  if (streak >= 2) fields.push({ name: "🔥 連續上線", value: `**${streak}** 天`, inline: true });
  if (badges) fields.push({ name: "🎖️ 徽章", value: `**${badges}** 枚`, inline: true });
  return {
    content: `${ICON[level] || "🎉"} 恭喜 ${who} 升上 **${tierName(level)}**！`,
    embeds: [{
      author: { name: "CCC 交易實驗室｜研究員升級", icon_url: LOGO },
      title: `LEVEL UP → ${tierName(level)}`,
      description: level >= MAX_TIER ? "實驗室最高等級 🏆 這個月可以選一位主講一對一交流。" : `下一站：${tierName(level + 1)}（${tierInfo(level + 1).perks[0]}）`,
      color: COLOR[level] || 0xcda45e,
      thumbnail: { url: `${SITE}/assets/brand/tier${level}.png` },
      fields,
      footer: { text: "實驗室培訓計畫｜升級後在網站按「分享到 Discord」就會出現在這裡", icon_url: LOGO },
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { users: discordId ? [discordId] : [] },
  };
}

export default route({
  async POST(req, res) {
    const ctx = await requireMember(req, res, { minTier: 1 });
    if (!ctx) return;
    if (ctx.isAdmin && !ctx.member) return res.status(400).json({ error: "管理員帳號沒有等級可以分享" });
    const level = toInt(readBody(req).level);
    if (level === null || level < 1 || level > MAX_TIER) return res.status(400).json({ error: "等級不正確" });
    const s = await getDiscordSettings();
    if (!discordConfigured() || !s.celebrateChannelId) return res.status(400).json({ error: "管理員還沒設定要分享到哪個頻道" });

    // 最近 60 天內真的升上這一級、還沒分享過的那一筆
    const since = new Date(Date.now() - 60 * 86400e3).toISOString();
    const { data: ms, error } = await supabaseAdmin.from("milestones").select("period_start, level, reached_at, shared_at")
      .eq("user_id", ctx.user.id).eq("level", level).gte("reached_at", since).order("reached_at", { ascending: false }).limit(1);
    if (error) throw error;
    const m = ms?.[0];
    if (!m) return res.status(404).json({ error: "找不到這次升級" });
    if (m.shared_at) return res.status(409).json({ error: "這次升級已經分享過了" });
    // 先標記分享（兩次連按只會貼一次）
    const { data: won } = await supabaseAdmin.from("milestones").update({ shared_at: new Date().toISOString() })
      .eq("user_id", ctx.user.id).eq("period_start", m.period_start).eq("level", level).is("shared_at", null).select("level");
    if (!won?.length) return res.status(409).json({ error: "這次升級已經分享過了" });

    const today = todayTW();
    const [ids, { data: days }, { count: badges }] = await Promise.all([
      supabaseAdmin.from("members").select("user_id, invite_code").eq("user_id", ctx.user.id).maybeSingle()
        .then(({ data }) => discordIds([ctx.user.id], new Map([[ctx.user.id, data || {}]]))).catch(() => new Map()),
      supabaseAdmin.from("checkins").select("day").eq("user_id", ctx.user.id).gte("day", addDays(today, -400)),
      supabaseAdmin.from("badges").select("badge", { count: "exact", head: true }).eq("user_id", ctx.user.id),
    ]);
    try {
      await sendMessage(s.celebrateChannelId, levelCard({ level, discordId: ids.get(ctx.user.id), streak: streakOf((days || []).map((d) => d.day), today), badges: badges || 0 }));
    } catch (e) {
      await supabaseAdmin.from("milestones").update({ shared_at: null }).eq("user_id", ctx.user.id).eq("period_start", m.period_start).eq("level", level);
      console.error("share post failed", e?.message);
      return res.status(502).json({ error: "貼到 Discord 失敗，請稍後再試" });
    }
    return res.status(200).json({ ok: true });
  },
});
