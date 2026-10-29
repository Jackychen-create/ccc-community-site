// 交易檢討投票：大家在「交易績效」頻道對想聽講師點評的交易按投稿表情（預設 🔍，可改成熊熊），誰按都算一票
// 每週日 21:00（台灣時間）整理這一週的投稿：
//   - 講師：完整清單（誰、哪一筆、連結）貼到審核頻道（只有管理員看得到），後台也看得到、可以勾「已點評」
//   - 大家：公開頻道只貼「本週收到 N 筆投稿」，不寫是誰、投了什麼
//   - 投稿的人：私訊「收到了」；講師勾已點評時再私訊一次
// 紀錄存在 bot_state 的 trade_reviews：{ weeks: { "2026-11-01": { at, items: [...] } } }，留 8 週
import { supabaseAdmin } from "./env.js";
import { discordApi, getDiscordSettings, sendMessage, dm, isSnowflake } from "./discord.js";
import { snowflakeAt, twStamp, BRAND } from "./chatlog.js";

// 投稿用的表情：後台可以改（伺服器自訂表情記 id，例如熊熊）；預設放大鏡
export const DEFAULT_REVIEW_EMOJIS = [{ name: "🔍" }, { name: "🔎" }];
export const reviewEmojisOf = (s) => (Array.isArray(s?.reviewEmojis) && s.reviewEmojis.length ? s.reviewEmojis : DEFAULT_REVIEW_EMOJIS);
const sameEmoji = (a, b) => (a.id || b.id ? a.id === b.id : a.name === b.name);
// Discord 訊息裡顯示用：自訂表情 <:名字:id>
export const emojiText = (e) => (e.id ? `<${e.animated ? "a" : ""}:${e.name}:${e.id}>` : e.name);
const LOGO = "https://ccc-community-site.pages.dev/assets/brand/ccc-bot.png";
const KEEP_WEEKS = 8;
const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const nameOf = (a) => a?.global_name || a?.username || "研究員";
// 這一週的名字＝這週日的日期（台灣時間；週三按「立即整理」也算到這週日那一週）
const weekOf = (ms) => { const d = new Date(ms + 8 * 3600e3); d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7)); return d.toISOString().slice(0, 10); };

export async function loadReviews() {
  const { data } = await supabaseAdmin.from("bot_state").select("value").eq("key", "trade_reviews").maybeSingle();
  return data?.value?.weeks ? data.value : { weeks: {} };
}
async function saveReviews(st) {
  const weeks = Object.fromEntries(Object.entries(st.weeks || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, KEEP_WEEKS));
  const { error } = await supabaseAdmin.from("bot_state").upsert({ key: "trade_reviews", value: { weeks }, updated_at: new Date().toISOString() });
  if (error) throw error;
  return { weeks };
}

// 這一週（到 now 為止 7 天）交易績效裡，作者自己按了 🔍 的貼文
export async function collectSubmissions(channelId, now = Date.now(), { api = discordApi, already = new Set(), emojis = DEFAULT_REVIEW_EMOJIS } = {}) {
  const since = now - 7 * 86400e3;
  let after = snowflakeAt(since);
  const msgs = [];
  for (let page = 0; page < 10; page++) {
    const batch = (await api("GET", `/channels/${channelId}/messages?after=${after}&limit=100`)) || [];
    if (!batch.length) break;
    batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    msgs.push(...batch.filter((m) => Date.parse(m.timestamp) <= now));
    after = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  const out = [];
  for (const m of msgs) {
    if (m.author?.bot || already.has(m.id)) continue;
    // 投票：誰按都算（作者自己按也算）；好幾個投稿表情時，同一個人按兩個算兩票（少見，不另外去重）
    const votes = (m.reactions || []).filter((r) => r.emoji && emojis.some((e) => sameEmoji(e, r.emoji))).reduce((a, r) => a + (r.count || 0), 0);
    if (!votes) continue;
    out.push({
      id: m.id, channel: channelId, author: m.author.id, authorName: nameOf(m.author),
      at: Date.parse(m.timestamp), text: clip(m.content, 300), attachments: (m.attachments || []).length,
      votes, reviewed: false,
    });
  }
  return out.sort((a, b) => b.votes - a.votes || a.at - b.at);
}

const link = (guildId, it) => `https://discord.com/channels/${guildId}/${it.channel}/${it.id}`;
export function hostListEmbed(week, items, guildId) {
  return {
    author: { name: `${BRAND}｜交易檢討投稿`, icon_url: LOGO },
    title: `📮 本週投票清單｜${week.slice(5).replace("-", "/")}（${items.length} 筆，票數多的在前）`,
    description: items.length ? "大家投票想聽點評的交易。講師挑幾筆在下次直播點評，點評完到後台「聊天統計 → 交易檢討投稿」勾「已點評」，機器人會私訊告訴投稿的人。" : "這一週沒有人投稿。",
    color: 0xcda45e,
    fields: items.slice(0, 25).map((it, i) => ({
      name: `#${i + 1}　${it.votes || 1} 票・${it.authorName}・${twStamp(it.at).slice(5, 16)}`,
      value: `${it.text || "（只有圖片）"}${it.attachments ? `\n📎 ${it.attachments} 個附件` : ""}\n[看原文](${link(guildId, it)})`.slice(0, 1024),
    })),
    footer: { text: "這份清單只有管理員看得到", icon_url: LOGO },
  };
}
// 公開的那則：只有筆數，不寫是誰、投了什麼
export function publicNotice(week, n, perfName = "交易績效", emojis = DEFAULT_REVIEW_EMOJIS) {
  return {
    author: { name: `${BRAND}｜交易檢討投稿`, icon_url: LOGO },
    title: `📮 本週有 ${n} 筆交易被投票想聽點評`,
    description: `講師會在下次直播挑票數多的點評 🎙️\n想投票：在 #${perfName} 對想聽講師點評的交易按 ${emojiText(emojis[0])}（自己的、別人的都可以），週日晚上會一起整理。`,
    color: 0xcda45e,
    footer: { text: "哪幾筆、幾票只有講師看得到", icon_url: LOGO },
  };
}

// 整理一週：force＝後台「立即整理」（同一週再整理只會補新的，不會重複私訊、重複貼）
export async function runWeeklyReviews(now = Date.now(), { force = false } = {}) {
  const s = await getDiscordSettings();
  if (!isSnowflake(s.perfChannelId || "")) return { ok: false, error: "還沒設定交易績效頻道" };
  const week = weekOf(now);
  const st = await loadReviews();
  // auto＝週日排程整理過了（週中按「立即整理」不算，週日照樣會整理一次）
  if (!force && st.weeks[week]?.auto) return { ok: true, skipped: "這週已經整理過了" };
  const already = new Set(Object.values(st.weeks).flatMap((w) => (w.items || []).map((x) => x.id)));
  const emojis = reviewEmojisOf(s);
  const all = await collectSubmissions(s.perfChannelId, now, { emojis });
  const fresh = all.filter((x) => !already.has(x.id));
  const cur = st.weeks[week] || { items: [] };
  // 這週已經列過的（週中按過「立即整理」）：票數更新成現在的
  const live = new Map(all.map((x) => [x.id, x.votes]));
  for (const it of cur.items) if (live.has(it.id)) it.votes = live.get(it.id);
  const items = [...cur.items, ...fresh].sort((a, b) => (b.votes || 0) - (a.votes || 0) || a.at - b.at);
  const sunday = !force && !cur.auto; // 週日第一次：就算沒有新的也貼完整清單、公開筆數
  st.weeks[week] = { at: new Date(now).toISOString(), auto: !!(cur.auto || !force), items };
  await saveReviews(st);
  const posts = [];
  if (s.reviewChannelId && (fresh.length || sunday || !cur.at)) await sendMessage(s.reviewChannelId, { embeds: [hostListEmbed(week, items, s.guildId)], allowed_mentions: { parse: [] } }).then(() => posts.push("講師清單"), (e) => posts.push(`講師清單失敗：${e.message}`));
  if (isSnowflake(s.reviewPublicChannelId || "") && (fresh.length || (sunday && items.length))) {
    const perf = await discordApi("GET", `/channels/${s.perfChannelId}`).catch(() => null);
    await sendMessage(s.reviewPublicChannelId, { embeds: [publicNotice(week, items.length, perf?.name, emojis)], allowed_mentions: { parse: [] } }).then(() => posts.push("公開通知"), (e) => posts.push(`公開通知失敗：${e.message}`));
  }
  let dms = 0;
  for (const it of fresh) if (await dm(it.author, `📮 你在交易績效 ${twStamp(it.at).slice(5, 16)} 那一筆交易，這週有 ${it.votes || 1} 票想聽講師點評！講師會在下次直播挑幾筆，被選到時會再通知你。`)) dms++;
  return { ok: true, week, count: items.length, fresh: fresh.length, dms, posts };
}

// 講師勾「已點評」：私訊投稿的人
export async function markReviewed(week, id, reviewed = true) {
  const st = await loadReviews();
  const it = st.weeks[week]?.items?.find((x) => x.id === id);
  if (!it) return { ok: false, error: "找不到這筆投稿" };
  const first = reviewed && !it.notifiedAt; // 私訊只發一次（取消再勾不會再發）
  it.reviewed = reviewed;
  it.reviewedAt = reviewed ? new Date().toISOString() : null;
  if (first) it.notifiedAt = it.reviewedAt;
  await saveReviews(st);
  if (first) await dm(it.author, `🎙️ 你投稿的交易（${twStamp(it.at).slice(5, 16)} 那一筆）講師點評了！到網站看最新一場直播留檔就看得到。`);
  return { ok: true };
}

// 每 5 分鐘的排程叫一次：週日 21:00～21:10（台灣時間）整理一次
export async function maybeWeeklyReviews(now = Date.now()) {
  const tw = new Date(now + 8 * 3600e3);
  if (tw.getUTCDay() !== 0 || tw.getUTCHours() !== 21 || tw.getUTCMinutes() >= 10) return null;
  return runWeeklyReviews(now);
}

