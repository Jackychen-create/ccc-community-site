// GET   /api/me            目前登入者的身分、觀看資格到期日、通知設定
// PATCH /api/me { notify }  研究員自己開關「新影片寄信通知」
import { supabaseAdmin, requireMember, readBody, route, EXCHANGES, AUTO_EXCHANGES, PROVIDERS, getThreshold, thisMonthTW, isQualified, cycleEnd } from "./lib/index.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    let volume = null;
    let links = null;
    if (ctx.member) {
      // 自動同步的交易所：有沒有設定好、這位研究員綁了哪個 UID
      const { data: rows } = await supabaseAdmin.from("exchange_links").select("exchange, exchange_uid, bound_at").eq("user_id", ctx.user.id);
      links = AUTO_EXCHANGES.map((ex) => {
        const l = (rows || []).find((r) => r.exchange === ex);
        return { exchange: ex, enabled: PROVIDERS[ex].configured(), uid: l?.exchange_uid || null, boundAt: l?.bound_at || null };
      });
      const month = thisMonthTW();
      const [threshold, { data: row }] = await Promise.all([
        getThreshold(),
        supabaseAdmin.from("volumes").select("amounts, updated_at, qualified_at").eq("user_id", ctx.user.id).eq("month", month).maybeSingle(),
      ]);
      volume = {
        month,
        exchanges: EXCHANGES,
        threshold,
        amounts: row?.amounts || null,
        updatedAt: row?.updated_at || null,
        qualified: row ? isQualified(row.amounts, threshold) : false,
        qualifiedAt: row?.qualified_at || null,
        qualifiedUntil: row?.qualified_at ? cycleEnd(row.qualified_at) : null,
      };
    }
    // 有沒有還沒看的提問回覆（右上角選單會亮一個點）
    const { count: unread } = await supabaseAdmin.from("feedback").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).eq("seen_reply", false);
    return res.status(200).json({
      email: ctx.user.email,
      feedbackUnread: unread || 0,
      isAdmin: ctx.isAdmin,
      accessUntil: ctx.member?.access_until || null,
      notify: ctx.member ? ctx.member.notify !== false : null,
      volume,
      links,
    });
  },

  async PATCH(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號沒有這個設定" });
    const b = readBody(req);
    if (typeof b.notify !== "boolean") return res.status(400).json({ error: "資料不正確" });
    const { error } = await supabaseAdmin.from("members").update({ notify: b.notify }).eq("user_id", ctx.user.id);
    if (error) throw error;
    return res.status(200).json({ ok: true, notify: b.notify });
  },
});
