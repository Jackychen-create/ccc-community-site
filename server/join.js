// 加入培訓計畫（v1.36.0，登入頁兩步）
// GET  /api/join             { enabled, links }（網站要不要顯示新流程、三間交易所的 CCC 註冊連結）
// POST /api/join             { exchange, uid } → 跟交易所確認 → { url }（Discord 授權頁）；不通過回 { error, code, links }
// POST /api/join/login       用 Discord 登入 → { url }
// GET  /api/join/contact     研究員名單用的 Email、要不要收通知
// POST /api/join/contact     { email, notify } 改 Email、改通知
import { route, readBody, requireMember, supabaseAdmin } from "./lib/index.js";
import { oauthConfigured, discordAuthorizeUrl, makeJoinState, makeLoginState } from "./lib/discord-oauth.js";
import { verifyUid, JOIN_LINKS, isDiscordAuthEmail } from "./lib/join.js";

const SCOPE = "identify email guilds.join";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const off = (res) => res.status(503).json({ error: "Discord 開通還沒設定好，請稍後再試" });

export const login = route({
  async POST(req, res) {
    if (!oauthConfigured()) return off(res);
    return res.status(200).json({ url: discordAuthorizeUrl(SCOPE, await makeLoginState()) });
  },
});

export const contact = route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    const email = ctx.member?.email || "";
    return res.status(200).json({ email: isDiscordAuthEmail(email) ? "" : email, notify: !!ctx.member?.notify });
  },
  async POST(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號不用設定" });
    const b = readBody(req);
    const patch = {};
    if (b.email !== undefined) {
      const email = String(b.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: "Email 格式不正確" });
      patch.email = email;
    }
    if (b.notify !== undefined) {
      patch.notify = !!b.notify;
      if (patch.notify) patch.notify_consent_at = new Date().toISOString();
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "沒有要改的" });
    const consent = patch.notify_consent_at;
    delete patch.notify_consent_at;
    const { error } = await supabaseAdmin.from("members").update(patch).eq("user_id", ctx.user.id);
    if (error) throw error;
    if (consent) await supabaseAdmin.from("members").update({ notify_consent_at: consent }).eq("user_id", ctx.user.id).then(({ error: e }) => e && console.error("consent time failed", e.message));
    return res.status(200).json({ ok: true, email: patch.email ?? ctx.member.email, notify: patch.notify ?? !!ctx.member.notify });
  },
});

export default route({
  async GET(req, res) {
    return res.status(200).json({ enabled: oauthConfigured(), links: JOIN_LINKS });
  },
  async POST(req, res) {
    if (!oauthConfigured()) return off(res);
    const b = readBody(req);
    const r = await verifyUid(req, b.exchange, b.uid);
    if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code, ...(["not_invited", "other_code"].includes(r.code) ? { links: JOIN_LINKS } : {}) });
    return res.status(200).json({ ok: true, exchange: r.exchange, uid: r.uid, url: discordAuthorizeUrl(SCOPE, await makeJoinState(r.exchange, r.uid)) });
  },
});
