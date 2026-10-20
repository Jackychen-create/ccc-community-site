// 聊天統計：每天把指定頻道（例如「大廳」「研究員大廳」）前一天的聊天抓下來
//   → 每個頻道算訊息數、發言人數、最常發言的人，存進 chat_stats
//   → 每個頻道整天的聊天紀錄存成文字檔，連同統計一起貼到後台設定的「統計回報頻道」
// 觸發：每天 00:05（台灣時間）Supabase 排程呼叫 /api/cron/chatlog；後台「聊天統計」也可以手動跑某一天
// 需要：Discord Developer Portal → Bot → 打開「Message Content Intent」，機器人在這些頻道要能「檢視頻道」「讀取訊息歷史」
import { supabaseAdmin, env } from "./env.js";
import { discordApi, getDiscordSettings, isSnowflake } from "./discord.js";
import { addDays } from "../../public/assets/js/shared/rules.js";

const DISCORD_EPOCH = 1420070400000n;
// 台灣某一天 00:00 的毫秒
export const twDayStart = (day) => Date.parse(`${day}T00:00:00+08:00`);
// 時間 → Discord 訊息編號（拿來當「從這之後」的起點）
export const snowflakeAt = (ms) => String((BigInt(ms) - DISCORD_EPOCH) << 22n);
const hhmm = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(11, 16);
export const MAX_PAGES = 30; // 一個頻道一天最多抓 3000 則（Cloudflare 一次能發的請求有上限）

// 抓某個頻道台灣時間 day 那一天的訊息（舊 → 新）
export async function fetchDay(channelId, day, { api = discordApi } = {}) {
  const start = twDayStart(day), end = twDayStart(addDays(day, 1));
  let after = snowflakeAt(start - 1);
  const out = [];
  let truncated = false;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) { truncated = true; break; }
    const batch = (await api("GET", `/channels/${channelId}/messages?after=${after}&limit=100`)) || [];
    if (!batch.length) break;
    batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)); // Discord 回傳新的在前，排成舊 → 新
    let done = false;
    for (const m of batch) {
      const t = Date.parse(m.timestamp);
      if (t >= end) { done = true; break; }
      if (t >= start) out.push(m);
    }
    after = batch[batch.length - 1].id;
    if (done || batch.length < 100) break;
  }
  return { messages: out, truncated };
}

const nameOf = (a) => a?.global_name || a?.username || "（未知）";
// 只算真人：機器人、系統訊息（有人加入、釘選）不算
const isHuman = (m) => !m.author?.bot && (m.type === 0 || m.type === 19 || m.type === undefined);

// 統計：訊息數、發言人數、最常發言的前 5 位
export function summarizeDay(messages) {
  const human = messages.filter(isHuman);
  const by = new Map();
  for (const m of human) {
    const id = m.author.id;
    const cur = by.get(id) || { id, name: nameOf(m.author), n: 0 };
    cur.n++;
    by.set(id, cur);
  }
  const top = [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 5).map(({ name, n }) => ({ name, n }));
  return { messages: human.length, authors: by.size, authorIds: [...by.keys()], top };
}

// 整天的聊天紀錄（純文字，一行一則；附件、貼圖、回覆寫在後面）
export function transcript(channelName, day, messages, stats, truncated = false) {
  const lines = [
    `CCC 交易實驗室｜#${channelName}｜${day}（台灣時間）聊天紀錄`,
    `訊息 ${stats.messages} 則・發言 ${stats.authors} 人${truncated ? `・訊息太多，只存了前 ${MAX_PAGES * 100} 則` : ""}`,
    "────────────────────────",
  ];
  for (const m of messages.filter(isHuman)) {
    let text = String(m.content || "").replace(/\r?\n/g, "\n        ");
    const extra = [
      ...(m.attachments || []).map((a) => `［附件 ${a.filename}：${a.url}］`),
      ...(m.sticker_items || []).map((s) => `［貼圖 ${s.name}］`),
      m.embeds?.length && !text ? "［連結預覽］" : "",
    ].filter(Boolean);
    if (m.referenced_message) text = `（回覆 ${nameOf(m.referenced_message.author)}）${text}`;
    lines.push(`[${hhmm(m.timestamp)}] ${nameOf(m.author)}：${[text, ...extra].filter(Boolean).join(" ")}`);
  }
  if (!stats.messages) lines.push("（這一天沒有聊天）");
  return lines.join("\n") + "\n";
}

// 貼到回報頻道（Discord 一則最多 10 個檔案、每個 8MB 以內；文字檔通常很小）
async function postReport(channelId, content, files) {
  const base = env.DISCORD_API_BASE || "https://discord.com/api/v10";
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content, allowed_mentions: { parse: [] }, attachments: files.map((f, i) => ({ id: i, filename: f.name })) }));
  files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.text], { type: "text/plain; charset=utf-8" }), f.name));
  const res = await fetch(`${base}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "User-Agent": "DiscordBot (https://ccc-community-site.pages.dev, 1.0)" },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
export function reportText(day, rows, uniqueAuthors) {
  const lines = [`📊 **${md(day)} 聊天統計**`];
  for (const r of rows) lines.push(r.error ? `#${r.name}：抓不到（${r.error}）` : `#${r.name}：${r.messages} 則・${r.authors} 人${r.truncated ? "（太多，只算了前 3000 則）" : ""}`);
  const ok = rows.filter((r) => !r.error);
  if (ok.length > 1) lines.push(`合計：${ok.reduce((a, r) => a + r.messages, 0)} 則・${uniqueAuthors} 人（同一個人在兩邊都講只算一次）`);
  const top = new Map();
  for (const r of ok) for (const t of r.top) top.set(t.name, (top.get(t.name) || 0) + t.n);
  const best = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (best.length) lines.push(`最常發言：${best.map(([n, c]) => `${n} ${c}`).join("、")}`);
  lines.push("整天的聊天紀錄在下面的文字檔。");
  return lines.join("\n");
}

// 跑某一天（預設昨天，台灣時間）；post=false 只統計不貼
export async function runChatlog(day, { post = true } = {}) {
  const s = await getDiscordSettings();
  const channels = (s.chatChannels || []).filter((c) => isSnowflake(c.id));
  if (!channels.length) return { ok: false, error: "還沒設定要統計的頻道" };
  const rows = [], files = [], authorSet = new Set();
  for (const c of channels) {
    try {
      const ch = await discordApi("GET", `/channels/${c.id}`).catch(() => null);
      const name = ch?.name || c.name || c.id;
      const { messages, truncated } = await fetchDay(c.id, day);
      const st = summarizeDay(messages);
      // 有訊息但內容都是空的：多半是沒開 Message Content Intent
      const noContent = messages.length > 0 && messages.filter(isHuman).every((m) => !m.content && !m.attachments?.length && !m.sticker_items?.length);
      st.authorIds.forEach((id) => authorSet.add(id));
      rows.push({ id: c.id, name, messages: st.messages, authors: st.authors, top: st.top, truncated, noContent });
      files.push({ name: `${day}_${name.replace(/[\\/:*?"<>|\s]+/g, "_")}.txt`, text: transcript(name, day, messages, st, truncated) });
    } catch (e) {
      rows.push({ id: c.id, name: c.name || c.id, error: e?.status === 403 || e?.code === 50001 ? "機器人看不到這個頻道" : e?.status === 404 ? "找不到頻道" : String(e?.message || e).slice(0, 80) });
    }
  }
  const save = rows.filter((r) => !r.error).map((r) => ({ day, channel_id: r.id, channel_name: r.name, messages: r.messages, authors: r.authors, top: r.top, truncated: r.truncated }));
  if (save.length) {
    const { error } = await supabaseAdmin.from("chat_stats").upsert(save, { onConflict: "day,channel_id" });
    if (error) throw error;
  }
  let posted = false, postError = null;
  const target = s.chatReportChannelId || s.reviewChannelId;
  if (post && target) {
    try {
      await postReport(target, reportText(day, rows, authorSet.size), files);
      posted = true;
    } catch (e) {
      postError = String(e?.message || e).slice(0, 200);
    }
  }
  return { ok: true, day, rows, total: { messages: rows.reduce((a, r) => a + (r.messages || 0), 0), authors: authorSet.size }, posted, postError, noContent: rows.some((r) => r.noContent) };
}
