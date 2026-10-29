// 後台：聊天統計（只有主要管理員）
// GET   /api/admin/chatlog                 設定（統計哪些頻道、回報頻道）＋最近 30 天每個頻道的統計
// PATCH /api/admin/chatlog { channelIds, webhooks, postTo, alsoTo, alsoLog, postMode, reportChannelId }   改設定；會先跟 Discord 確認機器人看得到這些頻道
//        webhooks：{ 統計的頻道 ID: Webhook 網址 }，空字串＝不改，null＝移除（改回機器人貼）
//        Webhook 網址等同發文的鑰匙：只存在資料庫，GET 只回名字和頻道，不回網址
//        postTo：{ 統計的頻道 ID: 回顧貼在哪個頻道 ID }，空白＝貼回自己的頻道（沒設 Webhook 時才用）
//        postMode：own＝每日回顧各自貼回自己的頻道（預設）；single＝全部貼到 reportChannelId
// POST  /api/admin/chatlog { day }         立即統計某一天（台灣日期，預設昨天）並貼到回報頻道
import {
  supabaseAdmin, requireAdmin, readBody, route, isDate, todayTW,
  discordConfigured, getDiscordSettings, saveDiscordSettings, isSnowflake, discordApi, runChatlog, isWebhookUrl, webhookInfo,
} from "../lib/index.js";
import { addDays } from "../../public/assets/js/shared/rules.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const s = await getDiscordSettings();
    const { data, error } = await supabaseAdmin.from("chat_stats").select("day, channel_id, channel_name, messages, authors, top, truncated")
      .gte("day", addDays(todayTW(), -30)).order("day", { ascending: false });
    if (error) throw error;
    return res.status(200).json({
      configured: discordConfigured(),
      channels: (s.chatChannels || []).map(({ webhook, ...c }) => ({ ...c, hasWebhook: !!webhook, webhookTail: webhook ? webhook.slice(-4) : "" })),
      reportChannelId: s.chatReportChannelId || "",
      postMode: s.chatPostMode === "single" ? "single" : "own",
      reviewChannelId: s.reviewChannelId || "",
      stats: data || [],
    });
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const s = await getDiscordSettings();
    const next = { ...s };
    if (b.channelIds !== undefined) {
      const ids = [...new Set((Array.isArray(b.channelIds) ? b.channelIds : String(b.channelIds || "").split(/[\s,，、]+/)).map((v) => String(v).trim()).filter(Boolean))];
      if (ids.some((v) => !isSnowflake(v))) return res.status(400).json({ error: "頻道 ID 是 17–20 位數字（在 Discord 對頻道按右鍵「複製頻道 ID」），多個用逗號分開" });
      if (ids.length > 5) return res.status(400).json({ error: "最多統計 5 個頻道" });
      const channels = [];
      for (const id of ids) {
        let name = (s.chatChannels || []).find((c) => c.id === id)?.name || "";
        if (discordConfigured()) {
          try {
            const ch = await discordApi("GET", `/channels/${id}`);
            name = ch?.name || name;
            await discordApi("GET", `/channels/${id}/messages?limit=1`); // 確認讀得到訊息
          } catch (e) {
            const why = e?.status === 404 ? "找不到這個頻道" : "機器人看不到這個頻道或不能讀訊息歷史，請在頻道權限把機器人加進去（檢視頻道、讀取訊息歷史）";
            return res.status(400).json({ error: `${name || id}：${why}` });
          }
        }
        const old = (s.chatChannels || []).find((c) => c.id === id);
        const { id: _i, name: _n, ...keep } = old || {};
        channels.push({ ...keep, id, name });
      }
      next.chatChannels = channels;
    }
    // 每個頻道的回顧貼在哪（例如大廳的回顧貼到原本的「每日回顧」頻道）
    if (b.postTo && typeof b.postTo === "object") {
      const list = [];
      for (const c of next.chatChannels || []) {
        const v = String(b.postTo[c.id] ?? c.postTo ?? "").trim();
        if (!v || v === c.id) { list.push({ id: c.id, name: c.name }); continue; }
        if (!isSnowflake(v)) return res.status(400).json({ error: `#${c.name || c.id} 的回顧要貼的頻道 ID 是 17–20 位數字` });
        let postToName = "";
        if (discordConfigured()) {
          try {
            postToName = (await discordApi("GET", `/channels/${v}`))?.name || "";
          } catch (e) {
            return res.status(400).json({ error: `#${c.name || c.id} 的回顧要貼的頻道：${e?.status === 404 ? "找不到這個頻道" : "機器人看不到這個頻道，請在頻道權限把機器人加進去（檢視頻道、傳送訊息、附加檔案、嵌入連結）"}` });
          }
        }
        list.push({ ...c, postTo: v, postToName });
      }
      next.chatChannels = list;
    }
    // 「也貼到」：回顧再由機器人多貼一份到另一個頻道（alsoTo：{ 統計的頻道 ID: 頻道 ID 或空白 }，alsoLog：{ 同上: 要不要附完整紀錄檔 }）
    if (b.alsoTo && typeof b.alsoTo === "object") {
      const list = [];
      for (const c of next.chatChannels || []) {
        const v = String(b.alsoTo[c.id] ?? c.alsoTo ?? "").trim();
        const alsoLog = b.alsoLog && typeof b.alsoLog === "object" && b.alsoLog[c.id] !== undefined ? b.alsoLog[c.id] !== false : c.alsoLog !== false;
        if (!v) { const { alsoTo, alsoToName, alsoLog: _a, ...rest } = c; list.push(rest); continue; }
        if (!isSnowflake(v)) return res.status(400).json({ error: `#${c.name || c.id} 的「也貼到」頻道 ID 是 17–20 位數字` });
        let alsoToName = "";
        if (discordConfigured()) {
          try {
            alsoToName = (await discordApi("GET", `/channels/${v}`))?.name || "";
          } catch (e) {
            return res.status(400).json({ error: `#${c.name || c.id} 的「也貼到」頻道：${e?.status === 404 ? "找不到這個頻道" : "機器人看不到這個頻道，請在頻道權限把機器人加進去（檢視頻道、傳送訊息、附加檔案、嵌入連結）"}` });
          }
        }
        list.push({ ...c, alsoTo: v, alsoToName, alsoLog });
      }
      next.chatChannels = list;
    }
    // 每個頻道的 Webhook（用 Webhook 的名字、頭像貼每日回顧）
    if (b.webhooks && typeof b.webhooks === "object") {
      const list = [];
      for (const c of next.chatChannels || []) {
        const v = b.webhooks[c.id];
        if (v === null) { const { webhook, webhookName, webhookChannelId, webhookChannelName, ...rest } = c; list.push(rest); continue; }
        const url = String(v || "").trim();
        if (!url) { list.push(c); continue; }
        if (!isWebhookUrl(url)) return res.status(400).json({ error: `#${c.name || c.id} 的 Webhook 網址不對：要是 https://discord.com/api/webhooks/… 開頭（頻道設定 → 整合 → Webhook → 複製 Webhook 網址）` });
        let info = { name: "", channelId: "" };
        try {
          info = await webhookInfo(url);
        } catch (e) {
          return res.status(400).json({ error: `#${c.name || c.id} 的 Webhook：${e.message}` });
        }
        const chName = info.channelId && discordConfigured() ? (await discordApi("GET", `/channels/${info.channelId}`).catch(() => null))?.name || "" : "";
        list.push({ ...c, webhook: url, webhookName: info.name, webhookChannelId: info.channelId, webhookChannelName: chName });
      }
      next.chatChannels = list;
    }
    if (b.reportChannelId !== undefined) {
      const v = String(b.reportChannelId || "").trim();
      if (v && !isSnowflake(v)) return res.status(400).json({ error: "回報頻道 ID 是 17–20 位數字" });
      next.chatReportChannelId = v;
    }
    if (b.postMode !== undefined) {
      if (!["own", "single"].includes(b.postMode)) return res.status(400).json({ error: "貼文方式不正確" });
      next.chatPostMode = b.postMode;
    }
    if (next.chatPostMode === "single" && !next.chatReportChannelId) return res.status(400).json({ error: "選「全部貼到同一個頻道」要填那個頻道的 ID" });
    await saveDiscordSettings(next);
    return res.status(200).json({ ok: true, channels: (next.chatChannels || []).map(({ webhook, ...c }) => ({ ...c, hasWebhook: !!webhook })), reportChannelId: next.chatReportChannelId || "", postMode: next.chatPostMode || "own" });
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    if (!discordConfigured()) return res.status(503).json({ error: "還沒設定 Discord 機器人" });
    const b = readBody(req);
    const day = b.day || addDays(todayTW(), -1);
    if (!isDate(day) || day > todayTW()) return res.status(400).json({ error: "日期不正確" });
    const r = await runChatlog(day, { post: b.post !== false });
    return res.status(r.ok ? 200 : 400).json(r.ok ? r : { error: r.error });
  },
});
