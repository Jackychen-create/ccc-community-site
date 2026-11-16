// GET   /api/me            目前登入者的身分、等級（三級制度）、這一輪交易量、通知設定、下一場直播
// PATCH /api/me { notify }  研究員自己開關「新影片寄信通知」
// PATCH /api/me { milestoneSeen: true }  看過里程碑恭喜了（不再跳）
// PATCH /api/me { theme }  換外觀主題（要拿到對應徽章的主題會檢查）
import { linkedOf } from "./lib/discord-link.js";
import { themeUnlocked } from "../public/assets/js/shared/rules.js";
import { checkin, getDiscordSettings, discordConfigured, supabaseAdmin, adminRole, unseenMilestone, markMilestonesSeen, earnedIds, requireMember, readBody, route, nextLive, needsName, EXCHANGES, AUTO_EXCHANGES, PROVIDERS, periodFor, nextPeriod, anchorOf } from "./lib/index.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 }); // 每一級都可以用
    if (!ctx) return;
    let volume = null;
    let links = null;
    let legacyLink = false;
    if (ctx.member) {
      // 三間交易所的 UID：自動同步的（Bybit、BingX）有沒有設定好、這位研究員填了哪個 UID
      const { data: rows } = await supabaseAdmin.from("exchange_links").select("exchange, exchange_uid, account_name, bound_at").eq("user_id", ctx.user.id);
      links = EXCHANGES.map((ex) => {
        const l = (rows || []).find((r) => r.exchange === ex);
        const auto = AUTO_EXCHANGES.includes(ex);
        return { exchange: ex, auto, enabled: auto ? PROVIDERS[ex].configured() : true, uid: l?.exchange_uid || null, accountName: l?.account_name || null, needsName: needsName(ex), boundAt: l?.bound_at || null };
      });
      // 只填過已經撤掉的交易所（UM，2026-11-16）：不要強制跳「一定要填 UID」的視窗把人擋在外面
      legacyLink = (rows || []).some((r) => !EXCHANGES.includes(r.exchange));
      // 這一輪：從加入那天起算，每一輪一個月；等級在 requireMember 已經算好（ctx.tier）
      const m = { created_at: ctx.member.created_at || ctx.user.created_at };
      const period = periodFor(m);
      const { data: row } = await supabaseAdmin.from("volumes").select("amounts, updated_at, qualified_at").eq("user_id", ctx.user.id).eq("period_start", period.start).maybeSingle();
      volume = {
        periodStart: period.start,
        periodEnd: period.end,
        nextEnd: nextPeriod(anchorOf(m), period).end,
        exchanges: EXCHANGES,
        amounts: row?.amounts || null,
        updatedAt: row?.updated_at || null,
        tier: ctx.tier.tier, // 今天是第幾級
        tierUntil: ctx.tier.until, // 這個等級至少到哪天（空白＝不限）
        cycleTier: ctx.tier.cycleTier, // 這一輪自己達到的等級＝下一輪的等級
        unit: ctx.tier.unit || null, // 單位制：{ cum 累計, units 解鎖到第幾份, oneOnOne, nextAt }
        paid: ctx.tier.paid || null, // 付費制（v1.28.0）：{ sub 月費有效, subUntil, parts 買了哪幾集, tier }
        // 這一輪還沒看過的升級，首頁跳一次恭喜；表還沒建立時當作沒有
        milestone: ctx.member.free || ctx.tier.unit || ctx.tier.paid ? null : await unseenMilestone(ctx.user.id, period.start).catch(() => null),
      };
      // 升級畫面要不要出現「分享到 Discord」：後台有設升級慶祝頻道、這一級還沒分享過
      if (volume.milestone) {
        const ds = await getDiscordSettings().catch(() => ({}));
        volume.milestone = { level: volume.milestone.level, reached_at: volume.milestone.reached_at, share: !!ds.celebrateChannelId && !volume.milestone.shared_at && discordConfigured() };
      }
    }
    // 有沒有還沒看的提問回覆（右上角選單會亮一個點）
    const { count: unread } = await supabaseAdmin.from("feedback").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).eq("seen_reply", false);
    // 管理員是主要管理員（owner）還是協作管理員（editor）
    const role = ctx.isAdmin ? await adminRole(ctx.user.email) : null;
    // 下一場直播（後台「直播預告」排的）；表還沒建立時當作沒有
    const live = await nextLive().catch(() => null);
    // 連續打卡：研究員打開網站就記今天（表還沒建立時當作沒有）
    const streak = ctx.member ? await checkin(ctx.user.id).catch(() => null) : null;
    // 各交易所的 CCC 邀請連結（後台「Discord 審核」設定的），還沒到第二級的人在首頁看得到
    const invites = ctx.member ? (await getDiscordSettings().catch(() => ({}))).invites || {} : {};
    // 自己連結的 Discord 帳號（右上角選單「連結 Discord」）；表還沒建立時當作沒有
    const dc = ctx.member ? await linkedOf(ctx.user.id).catch(() => null) : null;
    return res.status(200).json({
      email: ctx.user.email,
      feedbackUnread: unread || 0,
      isAdmin: ctx.isAdmin,
      adminRole: role,
      tier: ctx.member ? ctx.tier.tier : null, // 管理員沒有等級（全部都看得到）
      free: !!ctx.member?.free, // 贈送名額：不用綁交易所、沒有交易量門檻
      theme: ctx.member?.theme || null, // 外觀主題（存在帳號裡，換電腦也一樣）
      notify: ctx.member ? ctx.member.notify !== false : null,
      discord: ctx.member ? { linked: !!dc, name: dc?.discord_name || "" } : null,
      volume,
      links,
      legacyLink,
      streak, // { days 連續幾天, best 最長幾天 }
      invites: Object.fromEntries(Object.entries(invites).filter(([ex, u]) => EXCHANGES.includes(ex) && /^https:\/\//.test(String(u)))),
      nextLive: live ? { title: live.title, startsAt: live.starts_at, hosts: live.hosts || [], note: live.note, link: live.link } : null,
    });
  },

  async PATCH(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 }); // 每一級都可以用
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號沒有這個設定" });
    const b = readBody(req);
    if (b.milestoneSeen === true) {
      await markMilestonesSeen(ctx.user.id);
      return res.status(200).json({ ok: true });
    }
    if (b.theme !== undefined) {
      const theme = String(b.theme || "");
      if (!themeUnlocked(theme, await earnedIds(ctx.user.id))) return res.status(400).json({ error: "這個主題還沒解鎖", code: "locked" });
      const { error } = await supabaseAdmin.from("members").update({ theme }).eq("user_id", ctx.user.id);
      if (error) throw error;
      return res.status(200).json({ ok: true, theme });
    }
    if (typeof b.notify !== "boolean") return res.status(400).json({ error: "資料不正確" });
    const { error } = await supabaseAdmin.from("members").update({ notify: b.notify }).eq("user_id", ctx.user.id);
    if (error) throw error;
    return res.status(200).json({ ok: true, notify: b.notify });
  },
});
