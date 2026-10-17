// GET /api/invite?code=ABCD-EFGH
// 註冊畫面用：這組實驗室密碼是不是「贈送名額」（是的話就不用填交易所）
// 只回 { free }，不透露這組密碼存不存在、還剩幾次
import { supabaseAdmin, route } from "./lib/index.js";

export default route({
  async GET(req, res) {
    const code = String(req.query?.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return res.status(200).json({ free: false });
    const { data } = await supabaseAdmin.from("invite_codes").select("free, disabled, max_uses, used_count").eq("code", code).maybeSingle();
    const free = !!data?.free && !data.disabled && data.used_count < data.max_uses;
    return res.status(200).json({ free });
  },
});
