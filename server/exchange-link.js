// 研究員綁定交易所帳號（目前只有 BingX）
// GET    /api/exchange-link                       我綁定的帳號
// POST   /api/exchange-link { exchange, uid }     綁定：先問 BingX 這個 UID 是不是用我們的邀請碼註冊的，是才綁，並馬上同步這個月的交易量
// DELETE /api/exchange-link?exchange=BingX        解除綁定（之後不再自動同步，已經記下的交易量保留）
import {
  supabaseAdmin, requireMember, readBody, route, thisMonthTW,
  bingxConfigured, checkInvite, syncBingxMonth, BingxError,
} from "./lib/index.js";

const EXCHANGES = ["BingX"];

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const { data, error } = await supabaseAdmin.from("exchange_links").select("exchange, exchange_uid, bound_at").eq("user_id", ctx.user.id);
    if (error) throw error;
    return res.status(200).json({ links: data || [], bingxEnabled: bingxConfigured() });
  },

  async POST(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號不用綁定交易所" });
    const b = readBody(req);
    if (!EXCHANGES.includes(b.exchange)) return res.status(400).json({ error: "不支援這間交易所" });
    const uid = String(b.uid ?? "").trim();
    if (!/^\d{5,15}$/.test(uid)) return res.status(400).json({ error: "UID 是一串數字，請再確認一次" });
    if (!bingxConfigured()) return res.status(503).json({ error: "BingX 串接還沒設定好，請聯絡管理員" });

    const { data: taken } = await supabaseAdmin.from("exchange_links").select("user_id").eq("exchange", b.exchange).eq("exchange_uid", uid).maybeSingle();
    if (taken && taken.user_id !== ctx.user.id) return res.status(409).json({ error: "這個 UID 已經被其他研究員綁定了，有問題請聯絡管理員" });

    let check;
    try {
      check = await checkInvite(uid);
    } catch (e) {
      console.error("BingX check failed", e?.message);
      return res.status(502).json({ error: "暫時連不上 BingX，請稍後再試" });
    }
    if (!check.invited) {
      return res.status(400).json({ error: "這個 UID 不是用 CCC 的 BingX 邀請碼註冊的。請確認 UID，或用我們的邀請連結註冊", code: "not_invited" });
    }
    const { error } = await supabaseAdmin.from("exchange_links").upsert({
      user_id: ctx.user.id, exchange: b.exchange, exchange_uid: uid, direct: check.direct, bound_at: new Date().toISOString(),
    });
    if (error) throw error;

    // 馬上同步這個月的交易量；失敗也沒關係，每天的排程會再抓
    let synced = true;
    try {
      await syncBingxMonth(thisMonthTW(), { uid });
    } catch (e) {
      synced = false;
      console.error("BingX first sync failed", e instanceof BingxError ? e.code : "", e?.message);
    }
    return res.status(200).json({ ok: true, exchange: b.exchange, uid, synced });
  },

  async DELETE(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const exchange = req.query?.exchange;
    if (!EXCHANGES.includes(exchange)) return res.status(400).json({ error: "不支援這間交易所" });
    const { error } = await supabaseAdmin.from("exchange_links").delete().eq("user_id", ctx.user.id).eq("exchange", exchange);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  },
});
