// 後台：寄「新影片上架」通知給研究員
// POST /api/admin/notify { videoId }
// 用 Brevo 寄信（免費方案每天 300 封）；環境變數 BREVO_API_KEY、MAIL_FROM、MAIL_FROM_NAME
import { supabaseAdmin, requireAdmin, readBody, toInt, todayTW, env, route } from "../lib/index.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export default route({
  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    if (!env.BREVO_API_KEY || !env.MAIL_FROM) {
      return res.status(400).json({ error: "還沒設定寄信服務，請照 README「寄信通知」設定 BREVO_API_KEY 和 MAIL_FROM" });
    }
    const b = readBody(req);
    const videoId = toInt(b.videoId);
    if (videoId === null) return res.status(400).json({ error: "影片編號不正確" });

    const { data: v, error } = await supabaseAdmin
      .from("videos").select("id, title, description, published_at, is_published, hosts, course_host").eq("id", videoId).maybeSingle();
    if (error) throw error;
    if (!v) return res.status(404).json({ error: "找不到這支影片" });
    if (!v.is_published) return res.status(400).json({ error: "影片還是草稿，發布後才能寄通知" });
    if (v.course_host) return res.status(400).json({ error: "教學課程依每個人的加入日期解鎖，不寄全體通知" });

    // 收件人：開著通知、沒被停權、資格沒過期的研究員
    const today = todayTW();
    const { data: members, error: mErr } = await supabaseAdmin.from("members").select("email, banned, notify, access_until");
    if (mErr) throw mErr;
    const to = (members || []).filter((m) => m.notify !== false && !m.banned && (!m.access_until || m.access_until >= today)).map((m) => m.email);
    if (!to.length) return res.status(400).json({ error: "沒有可以寄的研究員（都關掉通知、停權或資格過期）" });

    const host = req.headers.host || "";
    const link = `https://${host}/#/v/${v.id}`;
    const hosts = (v.hosts || []).length ? `主講：${v.hosts.join("、")}<br>` : "";
    const html = `<div style="font-family:system-ui,'Noto Sans TC',sans-serif;font-size:15px;line-height:1.7;color:#1b1f1d">
<p>新的一場直播留檔上架了：</p>
<p style="font-size:18px;font-weight:700;margin:8px 0">${esc(v.title)}</p>
<p style="color:#555">${esc(v.published_at)}<br>${hosts}${esc(v.description || "")}</p>
<p><a href="${link}" style="display:inline-block;background:#CDA45E;color:#16120A;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">打開來看</a></p>
<p style="color:#888;font-size:13px">不想收到這種通知？登入後在右上角選單關掉「新影片寄信通知」。</p>
</div>`;

    // 每位研究員各寄一封（不會看到彼此的 Email），一次最多 1000 位
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || "CCC 交易實驗室" },
        subject: `新影片：${v.title}`,
        htmlContent: html,
        messageVersions: to.slice(0, 1000).map((email) => ({ to: [{ email }] })),
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Brevo error", r.status, detail.slice(0, 300));
      return res.status(502).json({ error: `寄信服務回應錯誤（${r.status}），請確認 Brevo 金鑰和寄件人 Email 已驗證` });
    }
    await supabaseAdmin.from("videos").update({ notified_at: new Date().toISOString() }).eq("id", v.id);
    return res.status(200).json({ ok: true, sent: Math.min(to.length, 1000) });
  },
});
