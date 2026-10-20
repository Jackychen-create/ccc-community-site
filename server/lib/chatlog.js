// 聊天統計＋每日回顧：每天把指定頻道（例如「大廳」「研究員大廳」）前一天的聊天抓下來
//   → 每個頻道算訊息數、參與人數、討論主題、最熱門的訊息，存進 chat_stats
//   → 每個頻道貼一則「每日回顧」（embed 卡片＋整天的完整紀錄文字檔）
//      postMode "own"（預設）：各自貼回自己的頻道，研究員大廳的紀錄不會出現在大家都看得到的大廳
//        每個頻道可以另外指定 postTo（例如大廳的回顧貼到原本的「每日回顧」頻道）
//      postMode "single"：全部貼到同一個頻道（chatReportChannelId）
// 觸發：每天 00:05（台灣時間）Supabase 排程呼叫 /api/cron/chatlog；後台「聊天統計」也可以手動跑某一天
// 需要：Discord Developer Portal → Bot → 打開「Message Content Intent」，機器人在這些頻道要能看、讀歷史、發訊息、附加檔案
import { supabaseAdmin, env } from "./env.js";
import { discordApi, getDiscordSettings, isSnowflake } from "./discord.js";
import { addDays } from "../../public/assets/js/shared/rules.js";

export const BRAND = "CCC Market Lab";
const COLOR = 0xcda45e;
const DISCORD_EPOCH = 1420070400000n;
// 台灣某一天 00:00 的毫秒
export const twDayStart = (day) => Date.parse(`${day}T00:00:00+08:00`);
// 時間 → Discord 訊息編號（拿來當「從這之後」的起點）
export const snowflakeAt = (ms) => String((BigInt(ms) - DISCORD_EPOCH) << 22n);
const twStamp = (ms) => new Date(ms + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
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

// ── 討論主題：從聊天內容挑出最多人、最多則提到的詞 ──
// 拿掉網址、提及、表情符號；英文、代號（NQ、BTC、ES）照字算；中文抓 2～5 個字的片段，同一則只算一次，至少 2 則提到才算
const STOP_EN = new Set("https http www com net org the and for you are not but this that with have was what can just like lol haha gif png jpg tenor discord youtube twitter threads share status".split(" "));
const STOP_ZH = ["我們", "你們", "他們", "這個", "那個", "什麼", "怎麼", "可以", "沒有", "就是", "因為", "所以", "然後", "還是", "不是", "真的", "感覺", "一下", "一個", "現在", "今天", "已經", "應該", "知道", "覺得", "這樣", "那樣", "如果", "但是", "而且", "自己", "大家", "哈哈", "謝謝", "早安", "晚安", "好的", "對啊", "是喔", "的話", "一樣", "有點", "比較", "還有", "這邊", "那邊", "時候", "問題"];
const isStopZh = (w) => STOP_ZH.some((s) => w === s || (w.length <= 3 && w.includes(s))) || /^(.)\1+$/.test(w) || /[的了嗎吧呢啊喔哦嘛啦耶欸]$/.test(w) || /^[的了是在有就也都很又]/.test(w);
export function topicsOf(messages, limit = 6) {
  const count = new Map(); // 詞 → 幾則訊息提到
  for (const m of messages.filter(isHuman)) {
    const text = String(m.content || "").replace(/https?:\/\/\S+/g, " ").replace(/<a?:\w+:\d+>|<[@#&!]+\d+>|@\S+/g, " ");
    const seen = new Set();
    for (const w of text.match(/[A-Za-z][A-Za-z0-9]{1,15}/g) || []) {
      const k = /^[A-Z0-9]{2,6}$/.test(w) ? w : w.toLowerCase();
      if (k.length < 2 || STOP_EN.has(k.toLowerCase()) || (k === k.toLowerCase() && k.length < 4)) continue;
      seen.add(k);
    }
    for (const run of text.match(/[一-鿿]{2,}/g) || []) {
      for (let n = 2; n <= 5; n++) for (let i = 0; i + n <= run.length; i++) {
        const w = run.slice(i, i + n);
        if (!isStopZh(w)) seen.add(w);
      }
    }
    for (const w of seen) count.set(w, (count.get(w) || 0) + 1);
  }
  // 長的詞優先（「固態電池」比「固態」有意思）：短詞的次數跟包含它的長詞差不多，就留長的
  const cands = [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] * (1 + b[0].length / 10) - a[1] * (1 + a[0].length / 10) || b[0].length - a[0].length);
  const picked = [];
  for (const [w, n] of cands) {
    if (picked.some((p) => p.w.includes(w) || (w.includes(p.w) && n < p.n * 0.8))) continue;
    const i = picked.findIndex((p) => w.includes(p.w));
    if (i >= 0) picked.splice(i, 1);
    picked.push({ w, n });
    if (picked.length >= limit) break;
  }
  return picked.map((p) => p.w);
}

// 最熱門的一則：被回覆＋表情最多
export function hottestOf(messages) {
  const human = messages.filter(isHuman);
  const replies = new Map();
  for (const m of human) if (m.message_reference?.message_id) replies.set(m.message_reference.message_id, (replies.get(m.message_reference.message_id) || 0) + 1);
  let best = null;
  for (const m of human) {
    const score = (replies.get(m.id) || 0) + (m.reactions || []).reduce((a, r) => a + (r.count || 0), 0);
    if (score >= 2 && String(m.content || "").trim() && (!best || score > best.score)) best = { score, name: nameOf(m.author), text: String(m.content).replace(/https?:\/\/\S+/g, "（連結）").replace(/\s+/g, " ").trim().slice(0, 60) };
  }
  return best;
}

// 統計：訊息數、參與人數、最常發言的前 5 位、討論主題、最熱門的一則
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
  const times = human.map((m) => Date.parse(m.timestamp));
  return { messages: human.length, authors: by.size, authorIds: [...by.keys()], top, topics: topicsOf(human), hottest: hottestOf(human), first: times.length ? Math.min(...times) : null, last: times.length ? Math.max(...times) : null };
}

// 整天的完整紀錄（純文字）：[時間] 名字 → 下一行內容；回覆、附件、貼圖都寫出來
export function transcript(channelName, day, messages, stats, truncated = false) {
  const start = twDayStart(day), end = twDayStart(addDays(day, 1));
  const lines = [
    `${BRAND}｜#${channelName}｜DC 每日完整討論紀錄`,
    `期間：${twStamp(start)} +0800 至 ${twStamp(end)} +0800`,
    `訊息數：${stats.messages}${truncated ? `（訊息太多，只存了前 ${MAX_PAGES * 100} 則）` : ""}`,
    "=".repeat(64),
  ];
  for (const m of messages.filter(isHuman)) {
    lines.push(`[${twStamp(Date.parse(m.timestamp))}] ${nameOf(m.author)}`);
    if (m.referenced_message) lines.push(`↪ 回覆 ${nameOf(m.referenced_message.author)}：${String(m.referenced_message.content || "").replace(/\s+/g, " ").slice(0, 40)}`);
    if (m.content) lines.push(String(m.content));
    for (const a of m.attachments || []) lines.push(`［附件］${a.filename}：${a.url}`);
    for (const s of m.sticker_items || []) lines.push(`［貼圖］${s.name}`);
    if (!m.content && !m.attachments?.length && !m.sticker_items?.length) lines.push(m.embeds?.length ? "［連結預覽］" : "（沒有文字）");
    lines.push("");
  }
  if (!stats.messages) lines.push("（這一天沒有聊天）");
  return lines.join("\n") + "\n";
}

export const fileName = (day, channelName, many) => `ccc_dc_recap_${day.replaceAll("-", "")}${many ? `_${channelName.replace(/[\\/:*?"<>|\s]+/g, "_")}` : ""}.txt`;
const ymdSlash = (day) => day.replaceAll("-", "/");
const hm = (ms) => (ms == null ? "--:--" : twStamp(ms).slice(11, 16));

// 一個頻道的每日回顧卡片；others：其他頻道的數字（讓大家知道兩邊加起來多熱鬧）
export function recapEmbed(day, row, { others = [], uniqueAuthors = null, file = "" } = {}) {
  const fields = [
    { name: "📊 討論概況", value: `訊息 ${row.messages} 則｜參與者 ${row.authors} 人｜區間 ${hm(row.first)}–${hm(row.last)}${row.truncated ? "\n（訊息太多，只算了前 3000 則）" : ""}` },
  ];
  if (others.length) {
    const all = [row, ...others];
    fields.push({ name: "🧪 全部大廳", value: all.map((r) => `#${r.name} ${r.messages} 則・${r.authors} 人`).join("\n") + (uniqueAuthors != null ? `\n合計 ${all.reduce((a, r) => a + r.messages, 0)} 則・${uniqueAuthors} 人（同一個人兩邊都講只算一次）` : "") });
  }
  fields.push({ name: "🔥 討論主題", value: row.topics?.length ? row.topics.join("、") : row.messages ? "（聊得比較零散，沒有特別集中的主題）" : "（這一天沒有聊天）" });
  if (row.hottest) fields.push({ name: "💬 最多人回應", value: `${row.hottest.name}：「${row.hottest.text}」` });
  if (row.top?.length) fields.push({ name: "🗣️ 最活躍", value: row.top.slice(0, 3).map((t) => `${t.name} ${t.n} 則`).join("、") });
  fields.push({ name: "📎 完整紀錄", value: `已附上 \`${file}\`，包含當日所有訊息、作者、時間、回覆標記與附件連結。請以附件內容為完整來源。` });
  return {
    title: `🗂️ ${BRAND}｜#${row.name} 每日回顧｜${ymdSlash(day)}`,
    description: "完整紀錄版：卡片提供概況，附件保留這一天的全部訊息內容。",
    color: COLOR,
    fields,
    footer: { text: "每天 00:05（台灣時間）自動產生｜請以原始討論為準" },
    timestamp: new Date().toISOString(),
  };
}

// 貼一則訊息（embed＋文字檔）
async function postRecap(channelId, embeds, files) {
  const base = env.DISCORD_API_BASE || "https://discord.com/api/v10";
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ embeds, allowed_mentions: { parse: [] }, attachments: files.map((f, i) => ({ id: i, filename: f.name })) }));
  files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.text], { type: "text/plain; charset=utf-8" }), f.name));
  const res = await fetch(`${base}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "User-Agent": "DiscordBot (https://ccc-community-site.pages.dev, 1.0)" },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 200);
    throw new Error(res.status === 403 ? "機器人在這個頻道不能發訊息或附加檔案" : `Discord ${res.status}: ${t}`);
  }
  return res.json();
}

// 跑某一天（預設昨天，台灣時間）；post=false 只統計不貼
export async function runChatlog(day, { post = true } = {}) {
  const s = await getDiscordSettings();
  const channels = (s.chatChannels || []).filter((c) => isSnowflake(c.id));
  if (!channels.length) return { ok: false, error: "還沒設定要統計的頻道" };
  const mode = s.chatPostMode === "single" && s.chatReportChannelId ? "single" : "own";
  const rows = [], authorSet = new Set();
  for (const c of channels) {
    try {
      const ch = await discordApi("GET", `/channels/${c.id}`).catch(() => null);
      const name = ch?.name || c.name || c.id;
      const { messages, truncated } = await fetchDay(c.id, day);
      const st = summarizeDay(messages);
      // 有訊息但內容都是空的：多半是沒開 Message Content Intent
      const noContent = messages.length > 0 && messages.filter(isHuman).every((m) => !m.content && !m.attachments?.length && !m.sticker_items?.length);
      st.authorIds.forEach((id) => authorSet.add(id));
      rows.push({ id: c.id, name, messages: st.messages, authors: st.authors, top: st.top, topics: st.topics, hottest: st.hottest, first: st.first, last: st.last, truncated, noContent, text: transcript(name, day, messages, st, truncated) });
    } catch (e) {
      rows.push({ id: c.id, name: c.name || c.id, error: e?.status === 403 || e?.code === 50001 ? "機器人看不到這個頻道" : e?.status === 404 ? "找不到頻道" : String(e?.message || e).slice(0, 80) });
    }
  }
  const ok = rows.filter((r) => !r.error);
  const save = ok.map((r) => ({ day, channel_id: r.id, channel_name: r.name, messages: r.messages, authors: r.authors, top: r.top, truncated: r.truncated }));
  if (save.length) {
    const { error } = await supabaseAdmin.from("chat_stats").upsert(save, { onConflict: "day,channel_id" });
    if (error) throw error;
  }
  const many = ok.length > 1;
  const uniq = many ? authorSet.size : null;
  const posts = [];
  if (post && ok.length) {
    const card = (r) => ({ embed: recapEmbed(day, r, { others: ok.filter((x) => x !== r), uniqueAuthors: uniq, file: fileName(day, r.name, many) }), file: { name: fileName(day, r.name, many), text: r.text } });
    const jobs = mode === "single"
      ? [{ channel: s.chatReportChannelId, items: ok.map(card) }]
      : ok.map((r) => ({ channel: channels.find((c) => c.id === r.id)?.postTo || r.id, items: [card(r)] }));
    for (const j of jobs) {
      try {
        await postRecap(j.channel, j.items.map((x) => x.embed), j.items.map((x) => x.file));
        posts.push({ channel: j.channel, ok: true });
      } catch (e) {
        posts.push({ channel: j.channel, ok: false, error: String(e?.message || e).slice(0, 200) });
      }
    }
  }
  const failed = posts.filter((p) => !p.ok);
  return {
    ok: true, day, mode,
    rows: rows.map(({ text, ...r }) => r),
    total: { messages: ok.reduce((a, r) => a + r.messages, 0), authors: authorSet.size },
    posted: posts.length > 0 && !failed.length, posts,
    postError: failed.length ? failed.map((p) => p.error).join("；") : null,
    noContent: rows.some((r) => r.noContent),
  };
}
