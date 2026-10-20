// 後台：聊天統計（只有主要管理員）
// GET   /api/admin/chatlog                 設定（統計哪些頻道、回報頻道）＋最近 30 天每個頻道的統計
// PATCH /api/admin/chatlog { channelIds, postTo, postMode, reportChannelId }   改設定；會先跟 Discord 確認機器人看得到這些頻道
//        postTo：{ 統計的頻道 ID: 回顧貼在哪個頻道 ID }，空白＝貼回自己的頻道
//        postMode：own＝每日回顧各自貼回自己的頻道（預設）；single＝全部貼到 reportChannelId
// POST  /api/admin/chatlog { day }         立即統計某一天（台灣日期，預設昨天）並貼到回報頻道
import {
  supabaseAdmin, requireAdmin, readBody, route, isDate, todayTW,
  discordConfigured, getDiscordSettings, saveDiscordSettings, isSnowflake, discordApi, runChatlog,
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
      channels: s.chatChannels || [],
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
        channels.push({ id, name, ...(old?.postTo ? { postTo: old.postTo, postToName: old.postToName || "" } : {}) });
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
        list.push({ id: c.id, name: c.name, postTo: v, postToName });
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
    return res.status(200).json({ ok: true, channels: next.chatChannels || [], reportChannelId: next.chatReportChannelId || "", postMode: next.chatPostMode || "own" });
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
