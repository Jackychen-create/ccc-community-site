// POST /api/register  { email, password, inviteCode, exchange, uid }
// 用實驗室密碼建立研究員帳號，同時記下他用哪間交易所、UID 是多少（管理員才對得到交易量）
// Bybit、BingX 有設定 API Key 的話，先跟交易所確認是 CCC 邀請的才讓他註冊
// 贈送名額的實驗室密碼（invite_codes.free）：不用填交易所，觀看不限期
// 付費制開始後（v1.28.0）：不用實驗室密碼、不用填交易所，直接用 Email 註冊，再到網站訂閱或買單集
// UID 直接加入（v1.34.0）：沒有實驗室密碼也可以，只要交易所 API 確認這個 UID 是 CCC 邀請的（OKX、Bybit、BingX）；
//   同一個 IP 一小時最多試 10 次（uid_join_attempts，存 IP 的雜湊、不存原始 IP），避免有人一個一個 UID 試
import { supabaseAdmin, isAdminEmail, readBody, route, thisMonthTW, todayTW, getPay, EXCHANGES, AUTO_EXCHANGES, PROVIDERS, cleanExId, exIdOk, idLabel, needsName, cleanAccountName, accountNameOk, ACCOUNT_NAME_ERROR } from "./lib/index.js";
import { isPaidOn } from "../public/assets/js/shared/rules.js";
import { tooManyTries } from "./lib/join.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default route({
  async POST(req, res) {
    const body = readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const code = String(body.inviteCode || "").trim().toUpperCase();
    const exchange = String(body.exchange || "");
    const uid = cleanExId(body.exchange, body.uid);

    // 付費制：沒填實驗室密碼也可以註冊（有填還是照原本的流程，贈送名額的密碼一樣有效）
    const pay = await getPay().catch(() => null);
    const open = !code && !!pay && isPaidOn(pay.paidFrom, todayTW());
    // 沒有實驗室密碼：用交易所 UID 直接驗證加入
    const byUid = !code && !open;
    if (!email || !password) {
      return res.status(400).json({ error: "請填寫 Email 和密碼" });
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
    // 贈送名額：交易所可以不填（有填還是照一般規則檢查、記下來）
    const { data: inv } = code ? await supabaseAdmin.from("invite_codes").select("free").eq("code", code).maybeSingle() : { data: null };
    const free = !!inv?.free;
    // 付費制：交易所不用填（有填照一般規則檢查、記下來）
    const withLink = open || (code && isPaidOn(pay?.paidFrom, todayTW())) ? !!exchange : !free || !!exchange;
    let verified = null;
    const p = PROVIDERS[exchange];
    let accountName = null;
    if (withLink) {
      if (!EXCHANGES.includes(exchange)) return res.status(400).json({ error: "請選擇你用 CCC 邀請連結註冊的交易所" });
      if (!exIdOk(exchange, uid)) return res.status(400).json({ error: "請填交易所 UID（一串數字）" });
      // 要另外填開戶姓名的交易所（目前沒有；原本是 UM）
      accountName = needsName(exchange) ? cleanAccountName(body.accountName) : null;
      if (needsName(exchange) && !accountNameOk(accountName)) return res.status(400).json({ error: ACCOUNT_NAME_ERROR });

      // 這個 UID 有沒有被別人填過
      const { data: taken } = await supabaseAdmin.from("exchange_links").select("user_id").eq("exchange", exchange).eq("exchange_uid", uid).maybeSingle();
      if (taken) return res.status(409).json({ error: `這個 ${exchange} ${idLabel(exchange)}已經被其他研究員填過了，有問題請聯絡管理員` });

      // UID 直接加入：一定要交易所確認得到才行
      if (byUid) {
        if (!AUTO_EXCHANGES.includes(exchange) || !p?.configured()) return res.status(400).json({ error: `${exchange} 還不能在網站直接驗證，請到 Discord 報名拿實驗室密碼` });
        if (await tooManyTries(req)) return res.status(429).json({ error: "試太多次了，請一小時後再試，或到 Discord 開客服單" });
      }
      // OKX、Bybit、BingX：先跟交易所確認（有實驗室密碼時，交易所暫時連不上就先讓他註冊，之後每天同步會再確認交易量）
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
          if (byUid) return res.status(503).json({ error: `${exchange} 暫時確認不到，請過幾分鐘再試` });
        }
      }
    }

    if (code) {
      const { data: ok, error: rpcError } = await supabaseAdmin.rpc("use_invite_code", {
        p_code: code,
      });
      if (rpcError) throw rpcError;
      if (!ok) return res.status(400).json({ error: "實驗室密碼無效、已停用或已被用完" });
    }

    const refund = () => (code ? supabaseAdmin.rpc("refund_invite_code", { p_code: code }) : Promise.resolve());

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
      invite_code: code || null,
      // 三級制度：新研究員第一輪先是第二級（shared/rules.js 的 FIRST_CYCLE_TIER），之後看每一輪的交易量（規則在 shared/rules.js）
      // 贈送名額：一直是第二級（網站全開），不用看交易量
      access_until: null,
      free,
      ...(free ? { min_tier: 2, min_tier_until: null } : {}),
    });
    if (memberError) {
      // 研究員資料寫不進去就整個撤回，避免留下沒有權限的空帳號
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      await refund();
      throw memberError;
    }

    if (!withLink) return res.status(200).json({ ok: true, free });

    // 記下交易所 UID（失敗也不影響註冊，登入後會請他補填）
    const { error: linkError } = await supabaseAdmin.from("exchange_links").insert({
      user_id: created.user.id, exchange, exchange_uid: uid, account_name: accountName, direct: verified ? verified.direct : null, bound_at: new Date().toISOString(),
    });
    if (linkError) console.error("register link failed", linkError.message);
    else if (verified) {
      try { await p.sync({ uid }); } catch (e) { console.error("register first sync failed", e?.message); }
    }

    return res.status(200).json({ ok: true, free });
  },
});
