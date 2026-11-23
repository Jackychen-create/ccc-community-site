// 一鍵連結 Discord（v1.35.0）
// GET  /api/discord-oauth            { enabled }（網站要不要顯示「用 Discord 連結」）
// POST /api/discord-oauth            研究員按按鈕 → { url }（Discord 授權頁）
// GET  /api/discord-oauth/callback   Discord 帶 code、state 回來 → 連好、加進伺服器、給身分組 → 轉回網站
import { route, requireMember, supabaseAdmin } from "./lib/index.js";
import { oauthConfigured, authorizeUrl, readAnyState, finishOAuth, discordUserFromCode, joinGuild } from "./lib/discord-oauth.js";
import { linkedUserOfDiscord } from "./lib/discord-link.js";
import { createFromDiscord, sessionFor } from "./lib/join.js";

const back = (res, q) => { res.setHeader("Location", `/#/discord-oauth?${new URLSearchParams(q)}`); return res.status(302).end(); };

// v1.36.0：加入培訓計畫（j）／用 Discord 登入（l）回來：建帳號或找到帳號 → 加進伺服器、給身分組 → 帶一次性代碼回網站登入
//   回網站：#/discord-oauth?r=welcome|login&t=代碼&n=名字&g=1|0&c=研究員頻道網址
async function joinOrLogin(res, st, code) {
  const w = st.kind === "join" ? "join" : "signin"; // 失敗時網站顯示在哪個分頁
  try {
    const d = await discordUserFromCode(code);
    if (d.error) return back(res, { r: "err", m: d.error, w });
    let userId = await linkedUserOfDiscord(d.user.id);
    let isNew = false;
    if (!userId) {
      if (st.kind === "login") return back(res, { r: "err", m: "這個 Discord 帳號還沒加入培訓計畫。請先在這裡填交易所 UID", w: "join" });
      const c = await createFromDiscord(st, d);
      if (!c.ok) return back(res, { r: "err", m: c.error, w });
      userId = c.userId;
      isNew = true;
    }
    const { data: m } = await supabaseAdmin.from("members").select("banned").eq("user_id", userId).maybeSingle();
    if (m?.banned) return back(res, { r: "err", m: "這個帳號目前沒有觀看權限，請聯絡管理員", w });
    const j = await joinGuild(userId, d.user.id, d.token);
    const t = await sessionFor(userId);
    return back(res, { r: isNew ? "welcome" : "login", t, n: d.name || "", g: j.role ? "1" : "0", c: j.channel });
  } catch (e) {
    console.error("discord join/login failed", e?.message);
    return back(res, { r: "err", m: "開通時出了點問題，請再試一次", w });
  }
}

export const callback = route({
  async GET(req, res) {
    const q = req.query || {};
    if (q.error) return back(res, { r: "cancel", ...(/^[jl]\./.test(String(q.state || "")) ? { r: "err", m: "Discord 授權取消了。準備好再按一次就可以", w: String(q.state).startsWith("j.") ? "join" : "signin" } : {}) });
    const st = await readAnyState(q.state);
    if (!st) return back(res, { r: "err", m: "連結逾時了，請回網站再按一次" });
    if (!/^[A-Za-z0-9]{10,64}$/.test(String(q.code || ""))) return back(res, { r: "err", m: "Discord 沒有回傳授權碼，請再試一次" });
    if (st.kind !== "link") return joinOrLogin(res, st, String(q.code));
    try {
      const r = await finishOAuth(st.userId, String(q.code));
      if (!r.ok) return back(res, { r: "err", m: r.error });
      return back(res, { r: "ok", n: r.name || "", j: r.joined, g: r.role ? "1" : "0" });
    } catch (e) {
      console.error("discord oauth failed", e?.message);
      return back(res, { r: "err", m: "連結時出了點問題，請再試一次" });
    }
  },
});

export default route({
  async GET(req, res) {
    return res.status(200).json({ enabled: oauthConfigured() });
  },
  async POST(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    if (!oauthConfigured()) return res.status(503).json({ error: "一鍵連結還沒設定好，請先用 Discord 裡的按鈕連結" });
    return res.status(200).json({ url: await authorizeUrl(ctx.user.id) });
  },
});
