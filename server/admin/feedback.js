// 後台：研究員提問／回報
// GET   /api/admin/feedback?status=open|done|all
// PATCH /api/admin/feedback { id, reply?, status? }   回覆會寄信給研究員（有設定寄信才會寄），並標成已處理
import { supabaseAdmin, requireAdmin, readBody, toInt, cleanText, route, sendMail, escHtml } from "../_lib.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const status = ["open", "done"].includes(req.query?.status) ? req.query.status : null;
    let q = supabaseAdmin
      .from("feedback")
      .select("id, user_id, email, video_id, t, kind, body, status, reply, replied_by, replied_at, created_at, videos(title)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (status) q = q.eq("status", status);
    const [{ data, error }, { count: open }] = await Promise.all([
      q,
      supabaseAdmin.from("feedback").select("id", { count: "exact", head: true }).eq("status", "open"),
    ]);
    if (error) throw error;
    return res.status(200).json({ open: open || 0, feedback: (data || []).map(({ videos, ...f }) => ({ ...f, video_title: videos?.title || null })) });
  },

  async PATCH(req, res) {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const b = readBody(req);
    const id = toInt(b.id);
    if (id === null) return res.status(400).json({ error: "編號不正確" });
    const patch = {};
    if (b.status !== undefined) {
      if (!["open", "done"].includes(b.status)) return res.status(400).json({ error: "狀態不正確" });
      patch.status = b.status;
    }
    const reply = b.reply === undefined ? undefined : cleanText(b.reply, 2000);
    if (reply !== undefined) {
      if (!reply) return res.status(400).json({ error: "回覆不能空白" });
      Object.assign(patch, { reply, replied_by: ctx.user.email, replied_at: new Date().toISOString(), seen_reply: false, status: "done" });
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "沒有要修改的內容" });
    const { data, error } = await supabaseAdmin.from("feedback").update(patch).eq("id", id).select("id, email, body, video_id, t").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "找不到這則" });
    let mailed = false;
    if (reply) {
      const host = req.headers.host || "";
      const link = data.video_id ? `https://${host}/#/v/${data.video_id}${data.t != null ? `?t=${data.t}` : ""}` : `https://${host}/#/feedback`;
      mailed = await sendMail({
        to: [data.email],
        subject: "你的問題有回覆了｜CCC 交易實驗室",
        html: `<p>你問的：</p><p style="white-space:pre-wrap;color:#666">${escHtml(data.body)}</p>
<p>回覆：</p><p style="white-space:pre-wrap;background:#f3f1ec;padding:12px 14px;border-radius:10px">${escHtml(reply)}</p>
<p><a href="${link}">打開網站看</a></p>`,
      });
    }
    return res.status(200).json({ ok: true, mailed });
  },
});
