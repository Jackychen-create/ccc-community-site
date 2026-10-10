// POST /api/register  { email, password, inviteCode }
// 用實驗室密碼建立會員帳號。
import { supabaseAdmin, isAdminEmail, readBody, route, monthEnd, thisMonthTW } from "./_lib.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default route({
  async POST(req, res) {
    const body = readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const code = String(body.inviteCode || "").trim().toUpperCase();

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
      // 新會員先給加入當月；之後每個月看交易量（任一間交易所達標）延長
      access_until: monthEnd(thisMonthTW()),
    });
    if (memberError) {
      // 會員資料寫不進去就整個撤回，避免留下沒有權限的空帳號
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      await refund();
      throw memberError;
    }

    return res.status(200).json({ ok: true });
  },
});
