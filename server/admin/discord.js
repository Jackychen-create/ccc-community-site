// 後台：Discord 審核機器人
// GET   /api/admin/discord                        設定好了沒、設定值、最近的申請
// PATCH /api/admin/discord { roleId, panelChannelId, reviewChannelId, staffRoleIds, invites, hostIds }   改設定（hostIds：一對一主講的 Discord 使用者 ID）
// POST  /api/admin/discord { action: "panel" }    在報名頻道張貼「報名培訓計畫」按鈕
// POST  /api/admin/discord { action: "setup" }  一鍵建立分類、頻道、權限、報名按鈕
// POST  /api/admin/discord { action: "support" }  一鍵建立客服中心（取代 Ticket Tool）：客服單分類、客服中心頻道、客服紀錄頻道、開單選單
// POST  /api/admin/discord { action: "wiki", channelId? }  貼／更新「📚 交易百科與頻道導覽」面板（沒填頻道就建「📚交易百科」）
import { ONE_ON_ONE_HOSTS } from "../../public/assets/js/shared/rules.js";
import {
  supabaseAdmin, requireAdmin, readBody, route, EXCHANGES, env,
  discordConfigured, getDiscordSettings, saveDiscordSettings, isSnowflake, sendMessage, editChannel, editMessage,
} from "../lib/index.js";
import { panelMessage } from "../lib/discord-flow.js";
import { setupGuild, inviteUrl, overwrites } from "../lib/discord-setup.js";
import { categoryOverwrites } from "../lib/discord-ticket.js";
import { setupSupport, supportOverwrites, resyncSupportTickets } from "../lib/discord-support.js";
import { setupWiki } from "../lib/discord-wiki.js";

const discordMsg = (e) => {
  if (e?.code === 50013) return "機器人的權限不夠（要有管理頻道、管理身分組、傳送訊息），請用後台的「把機器人加進伺服器」重新邀請一次";
  if (e?.code === 50001 || e?.status === 403) return "機器人沒有這個頻道的權限（要能看到頻道、傳送訊息）";
  if (e?.code === 10003 || e?.status === 404) return "找不到這個頻道，請確認頻道 ID";
  if (e?.status === 401) return "機器人 Token 不對，請檢查 Cloudflare 的 DISCORD_BOT_TOKEN";
  return String(e?.message || e).slice(0, 400);
};

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const [settings, { data: apps }, { data: support }] = await Promise.all([
      getDiscordSettings(),
      supabaseAdmin.from("discord_applications").select("id, discord_name, exchange, exchange_uid, status, auto, reviewed_by, created_at, reviewed_at, channel_id, invite_code").order("created_at", { ascending: false }).limit(30),
      supabaseAdmin.from("discord_tickets").select("channel_id, no, discord_name, topic, subject, status, claimed_by, created_at, closed_at").eq("kind", "support").order("created_at", { ascending: false }).limit(15),
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
      configured: discordConfigured(), settings, applications: apps || [], support: support || [],
      inviteUrl: env.DISCORD_APP_ID ? inviteUrl(env.DISCORD_APP_ID) : null,
    });
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const cur = await getDiscordSettings();
    const next = { ...cur };
    for (const k of ["roleId", "panelChannelId", "reviewChannelId", "highlightChannelId", "celebrateChannelId"]) {
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
    if (b.hostIds && typeof b.hostIds === "object") {
      next.hostIds = {};
      for (const h of ONE_ON_ONE_HOSTS) {
        const v = String(b.hostIds[h] || "").trim();
        if (v && !isSnowflake(v)) return res.status(400).json({ error: `${h} 的 Discord 使用者 ID 是 17–20 位數字（對他的名字按右鍵「複製使用者 ID」）` });
        if (v) next.hostIds[h] = v;
      }
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
    // 邀請連結改了：報名按鈕那則訊息跟著更新（下面那排註冊按鈕）
    let panelUpdated = null;
    if (JSON.stringify(cur.invites || {}) !== JSON.stringify(next.invites || {}) && discordConfigured() && next.panelChannelId && next.panelMessageId) {
      try {
        await editMessage(next.panelChannelId, next.panelMessageId, panelMessage(next.invites));
        panelUpdated = true;
      } catch (e) {
        console.error("discord panel update failed", e?.message);
        panelUpdated = false;
      }
    }
    // 客服身分組改了：申請分類、審核頻道的權限一起更新（之後開的報名頻道會照新的設定）
    let synced = null;
    if (JSON.stringify(cur.staffRoleIds || []) !== JSON.stringify(next.staffRoleIds || []) && discordConfigured() && next.guildId) {
      const ctx = { guildId: next.guildId, roleId: next.roleId, botId: env.DISCORD_APP_ID, staffRoleIds: next.staffRoleIds || [] };
      try {
        if (next.ticketCategoryId) await editChannel(next.ticketCategoryId, { permission_overwrites: categoryOverwrites(ctx) });
        if (next.reviewChannelId) await editChannel(next.reviewChannelId, { permission_overwrites: overwrites("review", ctx) });
        if (next.supportCategoryId) await editChannel(next.supportCategoryId, { permission_overwrites: supportOverwrites("category", ctx) });
        if (next.supportLogChannelId) await editChannel(next.supportLogChannelId, { permission_overwrites: supportOverwrites("log", ctx) });
        await resyncSupportTickets(ctx); // 開著的客服單也改成新的客服身分組
        synced = true;
      } catch (e) {
        console.error("discord staff sync failed", e?.message);
        synced = false;
      }
    }
    return res.status(200).json({ ok: true, settings: next, synced, panelUpdated });
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    if (!["panel", "setup", "support", "wiki"].includes(b.action)) return res.status(400).json({ error: "不支援這個操作" });
    if (!discordConfigured()) return res.status(503).json({ error: "還沒設定 Discord 機器人（Cloudflare 的 DISCORD_APP_ID、DISCORD_PUBLIC_KEY、DISCORD_BOT_TOKEN）" });
    if (b.action === "setup") {
      try {
        const r = await setupGuild();
        return res.status(r.ok ? 200 : 400).json(r.ok ? r : { error: r.error });
      } catch (e) {
        return res.status(502).json({ error: `建立失敗：${discordMsg(e)}` });
      }
    }
    if (b.action === "wiki") {
      const ch = String(b.channelId || "").trim();
      if (ch && !isSnowflake(ch)) return res.status(400).json({ error: "頻道 ID 是 17–20 位數字，請在 Discord 對頻道按右鍵「複製頻道 ID」" });
      try {
        const r = await setupWiki({ channelId: ch });
        return res.status(r.ok ? 200 : 400).json(r.ok ? r : { error: r.error });
      } catch (e) {
        return res.status(502).json({ error: `交易百科面板設定失敗：${discordMsg(e)}` });
      }
    }
    if (b.action === "support") {
      try {
        const r = await setupSupport();
        return res.status(r.ok ? 200 : 400).json(r.ok ? r : { error: r.error });
      } catch (e) {
        return res.status(502).json({ error: `建立失敗：${discordMsg(e)}` });
      }
    }
    const s = await getDiscordSettings();
    if (!s.panelChannelId) return res.status(400).json({ error: "先填報名頻道的 ID" });
    try {
      const msg = await sendMessage(s.panelChannelId, panelMessage(s.invites));
      // 記住新的這則，之後改邀請連結會更新它（舊的那則可以手動刪掉）
      if (msg?.id) await saveDiscordSettings({ ...(await getDiscordSettings()), panelMessageId: msg.id });
      return res.status(200).json({ ok: true, messageId: msg?.id || null });
    } catch (e) {
      return res.status(502).json({ error: `張貼失敗：${discordMsg(e)}` });
    }
  },
});
