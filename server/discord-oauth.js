// 一鍵連結 Discord（v1.35.0）
// GET  /api/discord-oauth            { enabled }（網站要不要顯示「用 Discord 連結」）
// POST /api/discord-oauth            研究員按按鈕 → { url }（Discord 授權頁）
// GET  /api/discord-oauth/callback   Discord 帶 code、state 回來 → 連好、加進伺服器、給身分組 → 轉回網站
import { route, requireMember } from "./lib/index.js";
import { oauthConfigured, authorizeUrl, readState, finishOAuth } from "./lib/discord-oauth.js";

const back = (res, q) => { res.setHeader("Location", `/#/discord-oauth?${new URLSearchParams(q)}`); return res.status(302).end(); };

export const callback = route({
  async GET(req, res) {
    const q = req.query || {};
    if (q.error) return back(res, { r: "cancel" });
    const userId = await readState(q.state);
    if (!userId) return back(res, { r: "err", m: "連結逾時了，請回網站再按一次" });
    if (!/^[A-Za-z0-9]{10,64}$/.test(String(q.code || ""))) return back(res, { r: "err", m: "Discord 沒有回傳授權碼，請再試一次" });
    try {
      const r = await finishOAuth(userId, String(q.code));
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
