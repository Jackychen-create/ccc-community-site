// 研究員提問／回報
// GET  /api/feedback                       我自己的提問和管理員的回覆（讀了之後回覆標成已讀）
// POST /api/feedback { kind, body, videoId?, t? }
//      kind：question（內容提問）或 problem（播放、網站問題）。送出後寄信通知管理員（有設定寄信才會寄）
import { supabaseAdmin, requireMember, readBody, toInt, cleanText, route, adminEmails, sendMail, escHtml } from "./lib/index.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const { data, error } = await supabaseAdmin
      .from("feedback")
      .select("id, video_id, t, kind, body, status, reply, replied_at, seen_reply, created_at, videos(title)")
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const unseen = (data || []).filter((f) => !f.seen_reply).map((f) => f.id);
    if (unseen.length) await supabaseAdmin.from("feedback").update({ seen_reply: true }).in("id", unseen);
    return res.status(200).json({
      feedback: (data || []).map(({ videos, ...f }) => ({ ...f, video_title: videos?.title || null, is_new: unseen.includes(f.id) })),
    });
  },

  async POST(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const b = readBody(req);
    const body = cleanText(b.body, 2000);
    const kind = b.kind === "problem" ? "problem" : "question";
    if (!body) return res.status(400).json({ error: "請寫下你的問題" });
    const videoId = b.videoId == null ? null : toInt(b.videoId);
    const t = b.t == null ? null : Math.max(0, Math.min(24 * 3600, Math.floor(Number(b.t)) || 0));

    // 一天最多 20 則，避免誤按連發
    const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await supabaseAdmin.from("feedback").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id).gte("created_at", since);
    if ((count || 0) >= 20) return res.status(429).json({ error: "今天已經送出很多則了，明天再試，或直接私訊管理員" });

    let title = null;
    if (videoId !== null) {
      const { data: v } = await supabaseAdmin.from("videos").select("id, title").eq("id", videoId).maybeSingle();
      title = v?.title || null;
    }
    const { data, error } = await supabaseAdmin
      .from("feedback")
      .insert({ user_id: ctx.user.id, email: ctx.user.email, video_id: title ? videoId : null, t: title ? t : null, kind, body })
      .select("id")
      .single();
    if (error) throw error;

    const host = req.headers.host || "";
    const mm = t != null ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}` : "";
    await sendMail({
      to: adminEmails(),
      subject: `${kind === "problem" ? "網站問題回報" : "研究員提問"}：${body.slice(0, 30)}`,
      html: `<p><b>${escHtml(ctx.user.email)}</b> ${kind === "problem" ? "回報了一個問題" : "提了一個問題"}${title ? `（${escHtml(title)}${mm ? ` ${mm}` : ""}）` : ""}：</p>
<p style="white-space:pre-wrap;background:#f3f1ec;padding:12px 14px;border-radius:10px">${escHtml(body)}</p>
<p><a href="https://${host}/admin#feedback">到後台回覆</a></p>`,
    });
    return res.status(200).json({ ok: true, id: data.id });
  },
});
