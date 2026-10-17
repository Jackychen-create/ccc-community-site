// GET   /api/me            目前登入者的身分、觀看資格到期日、通知設定、下一場直播
// PATCH /api/me { notify }  研究員自己開關「新影片寄信通知」
// PATCH /api/me { milestoneSeen: true }  看過里程碑恭喜了（不再跳）
import { supabaseAdmin, adminRole, unseenMilestone, markMilestonesSeen, requireMember, readBody, route, nextLive, needsName, EXCHANGES, AUTO_EXCHANGES, PROVIDERS, getThreshold, isQualified, periodFor, nextPeriod, anchorOf } from "./lib/index.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    let volume = null;
    let links = null;
    if (ctx.member) {
      // 四間交易所的 UID：自動同步的（Bybit、BingX）有沒有設定好、這位研究員填了哪個 UID
      const { data: rows } = await supabaseAdmin.from("exchange_links").select("exchange, exchange_uid, account_name, bound_at").eq("user_id", ctx.user.id);
      links = EXCHANGES.map((ex) => {
        const l = (rows || []).find((r) => r.exchange === ex);
        const auto = AUTO_EXCHANGES.includes(ex);
        return { exchange: ex, auto, enabled: auto ? PROVIDERS[ex].configured() : true, uid: l?.exchange_uid || null, accountName: l?.account_name || null, needsName: needsName(ex), boundAt: l?.bound_at || null };
      });
      // 這一輪：從加入那天起算，每一輪一個月
      const period = periodFor({ created_at: ctx.member.created_at || ctx.user.created_at });
      const [threshold, { data: row }] = await Promise.all([
        getThreshold(),
        supabaseAdmin.from("volumes").select("amounts, updated_at, qualified_at").eq("user_id", ctx.user.id).eq("period_start", period.start).maybeSingle(),
      ]);
      volume = {
        periodStart: period.start,
        periodEnd: period.end,
        exchanges: EXCHANGES,
        threshold,
        amounts: row?.amounts || null,
        updatedAt: row?.updated_at || null,
        qualified: row ? isQualified(row.amounts, threshold) : false,
        qualifiedAt: row?.qualified_at || null,
        qualifiedUntil: row?.qualified_at ? nextPeriod(anchorOf({ created_at: ctx.member.created_at || ctx.user.created_at }), period).end : null,
        // 這一輪還沒看過的里程碑（25／50／75／100%），首頁跳一次恭喜；表還沒建立時當作沒有
        milestone: ctx.member.free ? null : await unseenMilestone(ctx.user.id, period.start).catch(() => null),
        nextEnd: nextPeriod(anchorOf({ created_at: ctx.member.created_at || ctx.user.created_at }), period).end,
      };
    }
    // 有沒有還沒看的提問回覆（右上角選單會亮一個點）
    const { count: unread } = await supabaseAdmin.from("feedback").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).eq("seen_reply", false);
    // 管理員是主要管理員（owner）還是協作管理員（editor）
    const role = ctx.isAdmin ? await adminRole(ctx.user.email) : null;
    // 下一場直播（後台「直播預告」排的）；表還沒建立時當作沒有
    const live = await nextLive().catch(() => null);
    return res.status(200).json({
      email: ctx.user.email,
      feedbackUnread: unread || 0,
      isAdmin: ctx.isAdmin,
      adminRole: role,
      accessUntil: ctx.member?.access_until || null,
      free: !!ctx.member?.free, // 贈送名額：不用綁交易所、沒有交易量門檻
      notify: ctx.member ? ctx.member.notify !== false : null,
      volume,
      links,
      nextLive: live ? { title: live.title, startsAt: live.starts_at, hosts: live.hosts || [], note: live.note, link: live.link } : null,
    });
  },

  async PATCH(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號沒有這個設定" });
    const b = readBody(req);
    if (b.milestoneSeen === true) {
      await markMilestonesSeen(ctx.user.id);
      return res.status(200).json({ ok: true });
    }
    if (typeof b.notify !== "boolean") return res.status(400).json({ error: "資料不正確" });
    const { error } = await supabaseAdmin.from("members").update({ notify: b.notify }).eq("user_id", ctx.user.id);
    if (error) throw error;
    return res.status(200).json({ ok: true, notify: b.notify });
  },
});
