// GET   /api/me            目前登入者的身分、觀看資格到期日、通知設定
// PATCH /api/me { notify }  會員自己開關「新影片寄信通知」
import { supabaseAdmin, requireMember, readBody, route } from "./_lib.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    return res.status(200).json({
      email: ctx.user.email,
      isAdmin: ctx.isAdmin,
      accessUntil: ctx.member?.access_until || null,
      notify: ctx.member ? ctx.member.notify !== false : null,
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
