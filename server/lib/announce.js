// 公告佇列：資料庫 bot_state 的 announce_queue 放要貼的訊息，每 5 分鐘的排程用審核機器人貼出去
// 值：{ items: [{ channel: "頻道 ID", content?, embeds?, panel? }] }（只有後端 service role 寫得進去）
// panel: "link"＝貼「🔗 連結網站帳號」按鈕那則，貼好會記到 settings 的 linkChannelId、linkMessageId（網站的「連結 Discord」會帶人去那裡）
// 先刪掉再貼：排程重疊時不會貼兩次（貼失敗就不重試，回傳錯誤，記在排程結果裡）
import { supabaseAdmin } from "./env.js";
import { sendMessage, isSnowflake, getDiscordSettings, saveDiscordSettings, discordApi } from "./discord.js";
import { linkPanelMessage } from "./discord-link.js";

export async function flushAnnouncements() {
  const { data } = await supabaseAdmin.from("bot_state").select("value, updated_at").eq("key", "announce_queue").maybeSingle();
  const items = data?.value?.items;
  if (!Array.isArray(items) || !items.length) return null;
  const { data: claimed } = await supabaseAdmin.from("bot_state").delete().eq("key", "announce_queue").eq("updated_at", data.updated_at).select("key");
  if (!claimed?.length) return null;
  const out = [];
  for (const it of items.slice(0, 5)) {
    if (!isSnowflake(it?.channel)) { out.push({ ok: false, error: "頻道 ID 不對" }); continue; }
    const payload = { allowed_mentions: { parse: [] }, ...(it.panel === "link" ? linkPanelMessage() : {}) };
    if (it.content) payload.content = String(it.content).slice(0, 2000);
    if (Array.isArray(it.embeds)) payload.embeds = it.embeds.slice(0, 3);
    if (!payload.content && !payload.embeds) { out.push({ ok: false, error: "沒有內容" }); continue; }
    try {
      const m = await sendMessage(it.channel, payload);
      out.push({ ok: true, channel: it.channel, id: m?.id });
      if (it.panel === "link" && m?.id) {
        const ch = await discordApi("GET", `/channels/${it.channel}`).catch(() => null);
        await saveDiscordSettings({ ...(await getDiscordSettings()), linkChannelId: it.channel, linkMessageId: m.id, linkChannelName: ch?.name || "" });
      }
    }
    catch (e) { out.push({ ok: false, channel: it.channel, error: String(e?.message || e) }); }
  }
  await supabaseAdmin.from("bot_state").upsert({ key: "announce_last", value: { at: new Date().toISOString(), results: out }, updated_at: new Date().toISOString() });
  return out;
}
