// 研究員填自己的交易所 UID：Bybit、BingX 會先跟交易所確認是 CCC 邀請的，之後每天自動抓交易量；
// OKX、UM 不驗證，只是讓管理員對得到「這個 UID 是哪個 Email」（UM 是 MT5 帳號＋開戶英文姓名）
// GET    /api/exchange-link                       我綁定的帳號、哪幾間已經可以綁
// POST   /api/exchange-link { exchange, uid }     綁定：先問交易所這個 UID 是不是用我們的邀請碼註冊的，是才綁，並馬上同步這個月的交易量
// DELETE /api/exchange-link?exchange=Bybit        解除綁定（之後不再自動同步，已經記下的交易量保留）
import { supabaseAdmin, requireMember, readBody, route, thisMonthTW, EXCHANGES, AUTO_EXCHANGES, PROVIDERS, cleanExId, exIdOk, exIdError, idLabel, needsName, cleanAccountName, accountNameOk, ACCOUNT_NAME_ERROR } from "./lib/index.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const { data, error } = await supabaseAdmin.from("exchange_links").select("exchange, exchange_uid, bound_at").eq("user_id", ctx.user.id);
    if (error) throw error;
    const enabled = Object.fromEntries(EXCHANGES.map((ex) => [ex, AUTO_EXCHANGES.includes(ex) ? PROVIDERS[ex].configured() : true]));
    return res.status(200).json({ links: data || [], enabled });
  },

  async POST(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號不用綁定交易所" });
    const b = readBody(req);
    const ex = b.exchange;
    if (!EXCHANGES.includes(ex)) return res.status(400).json({ error: "不支援這間交易所" });
    const auto = AUTO_EXCHANGES.includes(ex);
    const p = PROVIDERS[ex];
    const uid = cleanExId(ex, b.uid);
    if (!exIdOk(ex, uid)) return res.status(400).json({ error: exIdError(ex) });
    const accountName = needsName(ex) ? cleanAccountName(b.accountName) : null;
    if (needsName(ex) && !accountNameOk(accountName)) return res.status(400).json({ error: ACCOUNT_NAME_ERROR });
    if (auto && !p.configured()) return res.status(503).json({ error: `${ex} 串接還沒設定好，請聯絡管理員` });

    const { data: taken } = await supabaseAdmin.from("exchange_links").select("user_id").eq("exchange", ex).eq("exchange_uid", uid).maybeSingle();
    if (taken && taken.user_id !== ctx.user.id) return res.status(409).json({ error: `這個 ${idLabel(ex)}已經被其他研究員綁定了，有問題請聯絡管理員` });

    // OKX、UM：直接記下來
    if (!auto) {
      const { error } = await supabaseAdmin.from("exchange_links").upsert({ user_id: ctx.user.id, exchange: ex, exchange_uid: uid, account_name: accountName, direct: null, bound_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ ok: true, exchange: ex, uid, accountName, synced: false });
    }

    let check;
    try {
      check = await p.check(uid);
    } catch (e) {
      console.error(`${ex} check failed`, e?.code, e?.message);
      return res.status(502).json({ error: `暫時連不上 ${ex}，請稍後再試` });
    }
    if (!check.invited) {
      const extra = ex === "Bybit" ? "（Bybit 要填主帳號的 UID）" : "";
      return res.status(400).json({ error: `這個 UID 不是用 CCC 的 ${ex} 邀請碼註冊的${extra}。請確認 UID，或用我們的邀請連結註冊`, code: "not_invited" });
    }
    const { error } = await supabaseAdmin.from("exchange_links").upsert({
      user_id: ctx.user.id, exchange: ex, exchange_uid: uid, direct: check.direct, bound_at: new Date().toISOString(),
    });
    if (error) throw error;

    // 馬上同步這個月的交易量；失敗也沒關係，每天的排程會再抓
    let synced = true;
    try {
      await p.sync({ uid });
    } catch (e) {
      synced = false;
      console.error(`${ex} first sync failed`, e?.code, e?.message);
    }
    return res.status(200).json({ ok: true, exchange: ex, uid, synced });
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
