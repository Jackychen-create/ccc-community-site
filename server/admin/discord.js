// 後台：Discord 審核機器人
// GET   /api/admin/discord                        設定好了沒、設定值、最近的申請
// PATCH /api/admin/discord { roleId, panelChannelId, reviewChannelId, invites }   改設定
// POST  /api/admin/discord { action: "panel" }    在申請頻道張貼「申請加入實驗室」按鈕
import {
  supabaseAdmin, requireAdmin, readBody, route, EXCHANGES,
  discordConfigured, getDiscordSettings, saveDiscordSettings, isSnowflake, sendMessage,
} from "../lib/index.js";
import { panelMessage } from "../lib/discord-flow.js";

const discordMsg = (e) => {
  if (e?.code === 50001 || e?.status === 403) return "機器人沒有這個頻道的權限（要能看到頻道、傳送訊息）";
  if (e?.code === 10003 || e?.status === 404) return "找不到這個頻道，請確認頻道 ID";
  if (e?.status === 401) return "機器人 Token 不對，請檢查 Cloudflare 的 DISCORD_BOT_TOKEN";
  return String(e?.message || e).slice(0, 200);
};

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const [settings, { data: apps }] = await Promise.all([
      getDiscordSettings(),
      supabaseAdmin.from("discord_applications").select("id, discord_name, exchange, exchange_uid, status, auto, reviewed_by, created_at, reviewed_at").order("created_at", { ascending: false }).limit(30),
    ]);
    return res.status(200).json({ configured: discordConfigured(), settings, applications: apps || [] });
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const cur = await getDiscordSettings();
    const next = { ...cur };
    for (const k of ["roleId", "panelChannelId", "reviewChannelId"]) {
      if (b[k] === undefined) continue;
      const v = String(b[k] || "").trim();
      if (v && !isSnowflake(v)) return res.status(400).json({ error: "ID 是 17–20 位數字，請在 Discord 對頻道或身分組按右鍵「複製 ID」" });
      if (k === "roleId" && !v) return res.status(400).json({ error: "要填身分組 ID" });
      next[k] = v;
    }
    if (b.invites && typeof b.invites === "object") {
      next.invites = {};
      for (const ex of EXCHANGES) {
        const v = String(b.invites[ex] || "").trim();
        if (v && !/^https:\/\/\S{4,300}$/.test(v)) return res.status(400).json({ error: `${ex} 的邀請連結要是 https:// 開頭的網址` });
        if (v) next.invites[ex] = v;
      }
    }
    await saveDiscordSettings(next);
    return res.status(200).json({ ok: true, settings: next });
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    if (b.action !== "panel") return res.status(400).json({ error: "不支援這個操作" });
    if (!discordConfigured()) return res.status(503).json({ error: "還沒設定 Discord 機器人（Cloudflare 的 DISCORD_APP_ID、DISCORD_PUBLIC_KEY、DISCORD_BOT_TOKEN）" });
    const s = await getDiscordSettings();
    if (!s.panelChannelId) return res.status(400).json({ error: "先填申請頻道的 ID" });
    try {
      const msg = await sendMessage(s.panelChannelId, panelMessage());
      return res.status(200).json({ ok: true, messageId: msg?.id || null });
    } catch (e) {
      return res.status(502).json({ error: `張貼失敗：${discordMsg(e)}` });
    }
  },
});
