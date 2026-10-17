// POST /api/register  { email, password, inviteCode, exchange, uid }
// 用實驗室密碼建立研究員帳號，同時記下他用哪間交易所、UID 是多少（管理員才對得到交易量）
// Bybit、BingX 有設定 API Key 的話，先跟交易所確認是 CCC 邀請的才讓他註冊
import { supabaseAdmin, isAdminEmail, readBody, route, cycleEnd, todayTW, thisMonthTW, EXCHANGES, AUTO_EXCHANGES, PROVIDERS, cleanExId, exIdOk, idLabel, needsName, cleanAccountName, accountNameOk, ACCOUNT_NAME_ERROR } from "./lib/index.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default route({
  async POST(req, res) {
    const body = readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const code = String(body.inviteCode || "").trim().toUpperCase();
    const exchange = String(body.exchange || "");
    const uid = cleanExId(body.exchange, body.uid);

    if (!email || !password || !code) {
      return res.status(400).json({ error: "請填寫 Email、密碼與實驗室密碼" });
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Email 格式不正確" });
    }
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: "密碼需要 8 到 72 個字元" });
    }
    // 管理員帳號不能用用實驗室密碼加入，避免別人搶先用你的 Email 註冊成管理員
    if (isAdminEmail(email)) {
      return res.status(400).json({ error: "這個 Email 不能用用實驗室密碼加入" });
    }
    if (!EXCHANGES.includes(exchange)) return res.status(400).json({ error: "請選擇你用 CCC 邀請連結註冊的交易所" });
    if (!exIdOk(exchange, uid)) return res.status(400).json({ error: exchange === "UM" ? "請填 UM 的 MT5 帳號（一串數字）" : "請填交易所 UID（一串數字）" });
    // UM 另外要填開戶的英文姓名（管理員對帳用）
    const accountName = needsName(exchange) ? cleanAccountName(body.accountName) : null;
    if (needsName(exchange) && !accountNameOk(accountName)) return res.status(400).json({ error: ACCOUNT_NAME_ERROR });

    // 這個 UID 有沒有被別人填過
    const { data: taken } = await supabaseAdmin.from("exchange_links").select("user_id").eq("exchange", exchange).eq("exchange_uid", uid).maybeSingle();
    if (taken) return res.status(409).json({ error: `這個 ${exchange} ${idLabel(exchange)}已經被其他研究員填過了，有問題請聯絡管理員` });

    // Bybit、BingX：先跟交易所確認（交易所暫時連不上就先讓他註冊，之後每天同步會再確認交易量）
    let verified = null;
    const p = PROVIDERS[exchange];
    if (AUTO_EXCHANGES.includes(exchange) && p?.configured()) {
      try {
        const check = await p.check(uid);
        if (!check.invited) {
          const extra = exchange === "Bybit" ? "（Bybit 要填主帳號的 UID）" : "";
          return res.status(400).json({ error: `這個 UID 不是用 CCC 的 ${exchange} 邀請連結註冊的${extra}。請確認 UID，或用邀請連結重新註冊`, code: "not_invited" });
        }
        verified = check;
      } catch (e) {
        console.error(`${exchange} check failed (register)`, e?.code, e?.message);
      }
    }

    const { data: ok, error: rpcError } = await supabaseAdmin.rpc("use_invite_code", {
      p_code: code,
    });
    if (rpcError) throw rpcError;
    if (!ok) return res.status(400).json({ error: "實驗室密碼無效、已停用或已被用完" });

    const refund = () => supabaseAdmin.rpc("refund_invite_code", { p_code: code });

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      await refund();
      const msg = createError?.message || "";
      const already = /already|registered|exists/i.test(msg);
      return res.status(400).json({
        error: already ? "這個 Email 已經註冊過了，請直接登入" : "註冊失敗，請確認 Email 與密碼",
      });
    }

    const { error: memberError } = await supabaseAdmin.from("members").insert({
      user_id: created.user.id,
      email,
      invite_code: code,
      // 新研究員先給加入那天起一個月（10/15 加入看到 11/14）；之後看交易量（任一間交易所達標）延長
      access_until: cycleEnd(todayTW()),
    });
    if (memberError) {
      // 研究員資料寫不進去就整個撤回，避免留下沒有權限的空帳號
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      await refund();
      throw memberError;
    }

    // 記下交易所 UID（失敗也不影響註冊，登入後會請他補填）
    const { error: linkError } = await supabaseAdmin.from("exchange_links").insert({
      user_id: created.user.id, exchange, exchange_uid: uid, account_name: accountName, direct: verified ? verified.direct : null, bound_at: new Date().toISOString(),
    });
    if (linkError) console.error("register link failed", linkError.message);
    else if (verified) {
      try { await p.sync({ uid }); } catch (e) { console.error("register first sync failed", e?.message); }
    }

    return res.status(200).json({ ok: true });
  },
});
