// 直播精華：Cloudflare Workers AI 把直播聲音轉成逐字稿，再整理成摘要、重點、提到的標的、建議章節
// 流程（GitHub Actions：.github/workflows/highlights.yml → tools/highlights/run.mjs）
//   1. GET  /api/cron/highlights            拿下一支要做的直播（附影片下載連結）
//   2. 自己用 ffmpeg 把聲音切成每 10 分鐘一段
//   3. PUT  /api/cron/highlights?video=&chunk=   每段聲音交給網站 → Workers AI 轉文字，存進 video_highlights.chunks
//   4. POST /api/cron/highlights { video, done } → 網站把逐字稿交給 AI 整理、存起來、貼到 Discord
// AI 用 Cloudflare 帳號的 Workers AI（wrangler.toml 的 [ai] binding），不用另外的金鑰
import { linesOf } from "./search.js";
import { supabaseAdmin, env } from "./env.js";
import { getDiscordSettings, sendMessage, discordApi, editMessage } from "./discord.js";

export const SITE = "https://ccc-community-site.pages.dev";
export const LOGO = `${SITE}/assets/brand/ccc-bot.png`;
export const WHISPER = "@cf/openai/whisper-large-v3-turbo";
export const LLMS = ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
export const CHUNK_SEC = 600; // 每段 10 分鐘
export const MAX_CHUNKS = 36; // 最多 6 小時
export const MAX_ATTEMPTS = 3;
const PROMPT_HINT = "以下是台灣交易社群「CCC 交易實驗室」的直播，使用繁體中文。內容常提到台股、美股、加密貨幣、BTC、ETH、SOL、輝達、台積電、停損、停利、流動性、支撐、壓力、K 線、均線、成交量、多單、空單。";

const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
export { mmss };
const round1 = (x) => Math.round(Number(x) * 10) / 10;
const clip = (s, n) => { s = String(s ?? "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function ai() {
  if (!env.AI?.run) throw Object.assign(new Error("Cloudflare Workers AI 還沒接上（wrangler.toml 的 [ai] binding）"), { code: "no_ai" });
  return env.AI;
}

// ── 1. 語音轉文字 ──
// Workers AI 的 whisper 回 segments[{ start, end, text }]；舊格式只有 vtt 或整段 text 也接得住
const VTT_RE = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*\n([\s\S]*?)(?=\n\n|$)/g;
const vttSec = (h, m, s, ms) => (Number((h || "0:").slice(0, -1)) * 3600) + Number(m) * 60 + Number(s) + Number(ms) / 1000;
export function parseWhisper(r, offset = 0) {
  const out = [];
  const segs = r?.segments || [];
  const hasTimes = segs.some((x) => x.start != null);
  for (const seg of [...segs, ...(!hasTimes && r?.vtt ? [{ vtt: r.vtt }] : [])]) {
    const t = String(seg.text || "").trim();
    if (seg.start != null && t) { out.push({ s: round1(offset + Number(seg.start)), e: round1(offset + Number(seg.end ?? seg.start)), t }); continue; }
    for (const m of String(seg.vtt || "").matchAll(VTT_RE)) {
      const text = m[9].trim();
      if (text) out.push({ s: round1(offset + vttSec(m[1], m[2], m[3], m[4])), e: round1(offset + vttSec(m[5], m[6], m[7], m[8])), t: text });
    }
  }
  if (!out.length && String(r?.text || "").trim()) out.push({ s: offset, e: offset + CHUNK_SEC, t: String(r.text).trim() });
  return out.filter((x) => !/^(字幕|謝謝觀看|請不吝點贊|訂閱)/.test(x.t)); // whisper 安靜時常會亂補這些
}
// Workers AI 一天的免費額度用完、或被限流：分出來，GitHub 那邊就不浪費重試
export const isQuota = (e) => /quota|limit|exceed|429|neuron|capacity|rate/i.test(String(e?.message || e));
export async function transcribeChunk(bytes, offset) {
  const audio = Buffer.from(bytes).toString("base64");
  const r = await ai().run(WHISPER, { audio, language: "zh", task: "transcribe", vad_filter: true, initial_prompt: PROMPT_HINT });
  return parseWhisper(r, offset);
}

// ── 2. 逐字稿：把短句合成大約 20 秒一行「[12:34] …」──
export function transcriptOf(chunks) {
  return linesOf(chunks).map((l) => `[${mmss(l.s)}] ${l.t}`).join("\n");
}
// 太長就平均取樣（AI 一次能讀的有限）
export function fitTranscript(text, max = 45000) {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  const keep = Math.max(1, Math.ceil(text.length / max));
  return lines.filter((_, i) => i % keep === 0).join("\n").slice(0, max);
}

// ── 3. 整理成摘要、重點、標的、章節 ──
export function summaryPrompt(v, transcript) {
  const mins = Math.round((v.duration_sec || 0) / 60);
  return {
    system: [
      "你是「CCC 交易實驗室」的直播編輯，幫研究員整理直播重點。一律用繁體中文（台灣用語），白話、精準，不要誇大，也不要加入逐字稿裡沒有的內容。",
      "不要給投資建議、不要寫「建議買進／賣出」；講者的觀點要寫成「講者認為…」。",
      "只輸出一個 JSON 物件，不要任何其他文字，格式：",
      '{"summary":"3 到 4 句話的摘要","points":[{"t":秒數,"text":"重點（每點 40 字內，4 到 6 點）"}],"tickers":[{"name":"標的名稱或代號","note":"講到什麼（30 字內）"}],"chapters":[{"t":秒數,"title":"章節名稱（14 字內）"}]}',
      "points 的 t 是講到這個重點的那一行時間（方括號裡的時間換成秒數），研究員點了會跳到那裡。",
      "tickers 只列逐字稿裡真的有討論的股票、幣、指數、期貨，最多 8 個，沒有就給空陣列。",
      `chapters 依時間排序，第一個 t 是 0，總共 4 到 12 章。每一章的 t 要放在「話題真的換了」的那一行：用那一行方括號裡的時間換成秒數（例如 [12:34] → 754）。不要平均切（例如每 300 秒一章），章節長短本來就會不一樣。章節要涵蓋整場：從開頭到結尾都要有，最後一章要在最後四分之一（${Math.round((v.duration_sec || mins * 60) * 0.75)} 秒之後）。t 不能超過 ${v.duration_sec || mins * 60} 秒。`,
    ].join("\n"),
    user: `直播標題：${v.title}\n講者：${(v.hosts || []).join("、") || "CCC"}\n長度：約 ${mins} 分鐘\n\n逐字稿：\n${transcript}`,
  };
}
export function textOf(r) {
  if (typeof r === "string") return r;
  if (typeof r?.response === "string") return r.response;
  if (r?.response && typeof r.response === "object") return JSON.stringify(r.response);
  if (typeof r?.output_text === "string") return r.output_text;
  const out = (r?.output || []).flatMap((o) => (o.type === "reasoning" ? [] : o.content || [])).map((c) => c.text || "").join("");
  if (out) return out;
  return r?.choices?.[0]?.message?.content || r?.result?.response || "";
}
export function parseJsonLoose(text) {
  const s = String(text || "").replace(/```(?:json)?/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
const toSec = (t) => {
  if (typeof t === "number") return t;
  const p = String(t || "").split(":").map(Number);
  return p.some((x) => !Number.isFinite(x)) ? NaN : p.reduce((a, x) => a * 60 + x, 0);
};
export function cleanSummary(j, duration = 0) {
  if (!j || typeof j !== "object") return null;
  const summary = clip(j.summary, 600);
  if (!summary) return null;
  const rawPoints = (Array.isArray(j.points) ? j.points : []).map((x) => ({ text: clip(typeof x === "string" ? x : x?.text, 80), t: typeof x === "object" && x && x.t != null && x.t !== "" ? Math.floor(toSec(x.t)) : NaN })).filter((x) => x.text).slice(0, 6);
  const points = rawPoints.map((x) => x.text);
  const pointTimesAi = rawPoints.map((x) => (Number.isFinite(x.t) ? x.t : null));
  const tickers = (Array.isArray(j.tickers) ? j.tickers : []).map((x) => ({ name: clip(x?.name, 20), note: clip(x?.note, 60) })).filter((x) => x.name).slice(0, 8);
  const max = duration > 0 ? duration : Infinity;
  const seen = new Set();
  const chapters = (Array.isArray(j.chapters) ? j.chapters : []).map((c) => ({ t: Math.floor(toSec(c?.t)), title: clip(c?.title, 24) }))
    .filter((c) => Number.isFinite(c.t) && c.t >= 0 && c.t < max && c.title && !seen.has(c.t) && seen.add(c.t))
    .sort((a, b) => a.t - b.t).slice(0, 12);
  if (chapters.length && chapters[0].t !== 0) chapters[0].t = 0;
  return { summary, points, pointTimesAi, tickers, chapters };
}
// 章節有沒有涵蓋整場：最後一章要在 60% 之後、相鄰兩章不能隔超過整場的 40%（短片不檢查）
export function chaptersCover(chapters, duration) {
  if (!duration || duration < 900 || !chapters?.length) return true;
  const ts = [...chapters.map((c) => c.t), duration];
  if (chapters[chapters.length - 1].t < duration * 0.6) return false;
  return ts.every((t, i) => i === 0 || t - ts[i - 1] <= duration * 0.4);
}
export async function summarize(v, transcript) {
  let last, best = null;
  // gpt-oss 試兩次（章節沒涵蓋整場就再試），還不行再換 llama；都不理想就用最好的那一次
  for (const model of [LLMS[0], ...LLMS]) {
    // llama 一次能讀的比較少（約 24k token），給它短一點的
    const p = summaryPrompt(v, fitTranscript(transcript, model.includes("gpt-oss") ? 45000 : 16000));
    try {
      const input = model.includes("gpt-oss")
        ? { instructions: p.system, input: p.user, reasoning: { effort: "low" } }
        : { messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }], max_tokens: 2048, temperature: 0.3 };
      const r = await ai().run(model, input);
      const out = cleanSummary(parseJsonLoose(textOf(r)), v.duration_sec || 0);
      if (out && chaptersCover(out.chapters, v.duration_sec || 0)) return { ...out, model };
      if (out) {
        // 章節只涵蓋前面：留著當備案，但後面沒涵蓋的章節不給（寧可少也不要誤導）
        if (!best) best = { ...out, model };
        last = new Error(`${model} 的章節沒有涵蓋整場`);
        continue;
      }
      last = new Error(`${model} 回傳的格式不對`);
    } catch (e) { last = e; }
  }
  if (best) return { ...best, chapters: [] };
  throw last || new Error("整理失敗");
}

// ── 4. 貼到 Discord ──
export function highlightEmbed(v, h) {
  const url = `${SITE}/lab#/v/${v.id}`;
  const fields = [];
  if (h.points?.length) fields.push({ name: "📌 重點", value: clip(h.points.map((x) => `• ${x}`).join("\n"), 1024) });
  if (h.tickers?.length) fields.push({ name: "🎯 提到的標的", value: clip(h.tickers.map((x) => `\`${x.name}\`${x.note ? ` ${x.note}` : ""}`).join("\n"), 1024) });
  if (h.chapters?.length) fields.push({ name: "🧭 章節", value: clip(h.chapters.slice(0, 10).map((c) => `\`${mmss(c.t)}\` ${c.title}`).join("\n"), 1024) });
  return {
    author: { name: "CCC 交易實驗室｜直播精華", icon_url: LOGO },
    title: `🎬 ${clip(v.title, 200)}`,
    url,
    description: `${clip(h.summary, 1500)}\n\n▶️ [到網站看完整直播](${url})`,
    color: 0xcda45e,
    fields,
    footer: { text: `整理內容可能有誤，以影片內容為準${v.hosts?.length ? `｜講者 ${v.hosts.join("、")}` : ""}`, icon_url: LOGO },
    timestamp: new Date().toISOString(),
  };
}
// v1.26.32：已經貼出去的精華卡片，頁尾的「AI 自動整理」改成新的寫法（只跑一次，做完記在 bot_state）
export async function fixHighlightFooters() {
  const KEY = "highlight_footer_fix";
  const { data } = await supabaseAdmin.from("bot_state").select("value").eq("key", KEY).maybeSingle();
  if (data?.value?.done) return null;
  const s = await getDiscordSettings();
  const ch = s.highlightChannelId || "";
  if (!ch || !env.DISCORD_BOT_TOKEN) return null;
  const msgs = (await discordApi("GET", `/channels/${ch}/messages?limit=100`)) || [];
  let edited = 0;
  for (const m of msgs) {
    if (!m.author?.bot || !(m.embeds || []).some((e) => /AI/.test(e.footer?.text || ""))) continue;
    const embeds = m.embeds.map((e) => (e.footer?.text ? { ...e, footer: { ...e.footer, text: e.footer.text.replace(/^AI 自動整理，/, "整理內容").replace(/AI\s*/g, "") } } : e));
    await editMessage(ch, m.id, { embeds });
    edited++;
  }
  await supabaseAdmin.from("bot_state").upsert({ key: KEY, value: { done: true, edited }, updated_at: new Date().toISOString() });
  return { edited };
}
export async function postHighlight(v, h) {
  const s = await getDiscordSettings();
  const ch = s.highlightChannelId || "";
  if (!ch || !env.DISCORD_BOT_TOKEN) return false;
  await sendMessage(ch, { embeds: [highlightEmbed(v, h)], allowed_mentions: { parse: [] } });
  return true;
}

// ── 工作佇列 ──
// 要做的：已發布的直播紀錄（不是系統分享、不是公開影片）、長度 5 分鐘以上、45 天內上傳
// 還沒做過、被設成重做、做到一半卡住超過 3 小時、失敗了（1 小時後再試，最多 3 次）
export const WINDOW_DAYS = 14; // 只自動做最近兩週的直播（舊的要做可以在後台按「重新產生」）
export const STALE_MS = 3 * 3600e3;
export const LIVE_FILTER = (q) => q.eq("is_published", true).is("course_host", null).eq("is_public", false);
export function pickJob(videos, rows, now = Date.now()) {
  const byId = new Map((rows || []).map((r) => [Number(r.video_id), r]));
  const ready = (r) => {
    if (!r) return true;
    const age = now - Date.parse(r.updated_at || 0);
    if (r.status === "pending") return true;
    if (r.status === "processing") return age > STALE_MS && r.attempts < MAX_ATTEMPTS;
    if (r.status === "failed") return age > 3600e3 && r.attempts < MAX_ATTEMPTS;
    return false;
  };
  return (videos || []).filter((v) => (v.duration_sec || 0) >= 300 && v.r2_key && ready(byId.get(Number(v.id))))
    .sort((a, b) => (byId.get(Number(a.id))?.status === "pending" ? -1 : 0) - (byId.get(Number(b.id))?.status === "pending" ? -1 : 0) || Date.parse(b.created_at) - Date.parse(a.created_at))[0] || null;
}
export async function nextJob(now = Date.now()) {
  // 卡住太久、次數用完的（GitHub 那邊被中斷沒回報）：標成失敗，後台可以按重做
  await supabaseAdmin.from("video_highlights").update({ status: "failed", error: "處理太久沒有回報（GitHub 那邊可能被中斷）", updated_at: new Date(now).toISOString() })
    .eq("status", "processing").gte("attempts", MAX_ATTEMPTS).lt("updated_at", new Date(now - STALE_MS).toISOString());
  const since = new Date(now - WINDOW_DAYS * 86400e3 + 8 * 3600e3).toISOString().slice(0, 10);
  const { data: vids, error } = await LIVE_FILTER(supabaseAdmin.from("videos").select("id, title, hosts, duration_sec, r2_key, created_at")).gte("published_at", since).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  const { data: found } = await supabaseAdmin.from("video_highlights").select("video_id, status, attempts, updated_at").in("video_id", (vids || []).map((v) => v.id));
  const rows = [...(found || [])];
  // 有人在後台按「重做」的不受 45 天限制
  const { data: redo } = await supabaseAdmin.from("video_highlights").select("video_id").eq("status", "pending").limit(5);
  let list = vids || [];
  const extra = (redo || []).map((r) => r.video_id).filter((id) => !list.some((v) => Number(v.id) === Number(id)));
  if (extra.length) {
    const { data: more } = await LIVE_FILTER(supabaseAdmin.from("videos").select("id, title, hosts, duration_sec, r2_key, created_at")).in("id", extra);
    list = [...(more || []), ...list];
    const { data: moreRows } = await supabaseAdmin.from("video_highlights").select("video_id, status, attempts, updated_at").in("video_id", extra);
    rows.push(...(moreRows || []));
  }
  const v = pickJob(list, rows, now);
  if (!v) return null;
  const cur = rows.find((r) => Number(r.video_id) === Number(v.id));
  const { error: upErr } = await supabaseAdmin.from("video_highlights").upsert({
    video_id: v.id, status: "processing", attempts: (cur?.status === "pending" ? 0 : cur?.attempts || 0) + 1,
    chunks: {}, error: null, updated_at: new Date(now).toISOString(),
  });
  if (upErr) throw upErr;
  return v;
}
