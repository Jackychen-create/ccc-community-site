// 後台：Discord 審核機器人
// GET   /api/admin/discord                        設定好了沒、設定值、最近的申請
// PATCH /api/admin/discord { roleId, panelChannelId, reviewChannelId, staffRoleIds, invites }   改設定
// POST  /api/admin/discord { action: "panel" }    在申請頻道張貼「申請加入實驗室」按鈕
// POST  /api/admin/discord { action: "setup" }  一鍵建立分類、頻道、權限、申請按鈕
import {
  supabaseAdmin, requireAdmin, readBody, route, EXCHANGES, env,
  discordConfigured, getDiscordSettings, saveDiscordSettings, isSnowflake, sendMessage, editChannel,
} from "../lib/index.js";
import { panelMessage } from "../lib/discord-flow.js";
import { setupGuild, inviteUrl, overwrites } from "../lib/discord-setup.js";
import { categoryOverwrites } from "../lib/discord-ticket.js";

const discordMsg = (e) => {
  if (e?.code === 50013) return "機器人的權限不夠（要有管理頻道、管理身分組、傳送訊息），請用後台的「把機器人加進伺服器」重新邀請一次";
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
      supabaseAdmin.from("discord_applications").select("id, discord_name, exchange, exchange_uid, status, auto, reviewed_by, created_at, reviewed_at, channel_id, invite_code").order("created_at", { ascending: false }).limit(30),
    ]);
    // 每筆申請對到網站上的哪個 Email（研究員在網站填了同一個交易所 UID）
    if (apps?.length) {
      const { data: links } = await supabaseAdmin.from("exchange_links").select("user_id, exchange, exchange_uid").in("exchange_uid", [...new Set(apps.map((a) => a.exchange_uid))]);
      const ids = [...new Set((links || []).map((l) => l.user_id))];
      const { data: mems } = ids.length ? await supabaseAdmin.from("members").select("user_id, email").in("user_id", ids) : { data: [] };
      const emailOf = new Map((mems || []).map((m) => [m.user_id, m.email]));
      const byUid = new Map((links || []).map((l) => [`${l.exchange}:${l.exchange_uid}`, emailOf.get(l.user_id) || null]));
      for (const a of apps) a.site_email = byUid.get(`${a.exchange}:${a.exchange_uid}`) || null;
    }
    return res.status(200).json({
      configured: discordConfigured(), settings, applications: apps || [],
      inviteUrl: env.DISCORD_APP_ID ? inviteUrl(env.DISCORD_APP_ID) : null,
    });
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
    if (b.staffRoleIds !== undefined) {
      const list = (Array.isArray(b.staffRoleIds) ? b.staffRoleIds : String(b.staffRoleIds || "").split(/[\s,，、]+/)).map((v) => String(v).trim()).filter(Boolean);
      if (list.some((v) => !isSnowflake(v))) return res.status(400).json({ error: "客服身分組 ID 是 17–20 位數字，多個用逗號分開" });
      if (list.length > 5) return res.status(400).json({ error: "客服身分組最多 5 個" });
      next.staffRoleIds = [...new Set(list)];
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
    // 客服身分組改了：申請分類、審核頻道的權限一起更新（之後開的申請頻道會照新的設定）
    let synced = null;
    if (JSON.stringify(cur.staffRoleIds || []) !== JSON.stringify(next.staffRoleIds || []) && discordConfigured() && next.guildId) {
      const ctx = { guildId: next.guildId, roleId: next.roleId, botId: env.DISCORD_APP_ID, staffRoleIds: next.staffRoleIds || [] };
      try {
        if (next.ticketCategoryId) await editChannel(next.ticketCategoryId, { permission_overwrites: categoryOverwrites(ctx) });
        if (next.reviewChannelId) await editChannel(next.reviewChannelId, { permission_overwrites: overwrites("review", ctx) });
        synced = true;
      } catch (e) {
        console.error("discord staff sync failed", e?.message);
        synced = false;
      }
    }
    return res.status(200).json({ ok: true, settings: next, synced });
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    if (!["panel", "setup"].includes(b.action)) return res.status(400).json({ error: "不支援這個操作" });
    if (!discordConfigured()) return res.status(503).json({ error: "還沒設定 Discord 機器人（Cloudflare 的 DISCORD_APP_ID、DISCORD_PUBLIC_KEY、DISCORD_BOT_TOKEN）" });
    if (b.action === "setup") {
      try {
        const r = await setupGuild();
        return res.status(r.ok ? 200 : 400).json(r.ok ? r : { error: r.error });
      } catch (e) {
        return res.status(502).json({ error: `建立失敗：${discordMsg(e)}` });
      }
    }
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
