// 機器人共用工具（Supabase Edge Function「bots」和 Node 測試都用這一份，所以只用標準的 fetch，不用 Deno／Node 專屬的東西）
// - 資料庫：用 service role 直接打 PostgREST（設定在 settings.bots、狀態在 bot_state、執行紀錄在 bot_runs）
// - 發文：Discord Webhook（可以指定討論串 thread_id）
// - 時間：一律用台灣時間判斷「今天」「幾點」

export const UA = "Mozilla/5.0 (compatible; CCCMarketLabBot/1.0; +https://ccc-community-site.pages.dev)";
export const BRAND = "CCC Market Lab";
export const COLOR = { gold: 0xcda45e, up: 0xc9665d, down: 0x5fa285, warn: 0xd08b57, info: 0x7f9790 };

// ── 台灣時間 ──
const tw = (now = new Date()) => new Date(now.getTime() + 8 * 3600e3);
export const twDate = (now) => tw(now).toISOString().slice(0, 10); // 2026-10-21
export const twHM = (now) => tw(now).toISOString().slice(11, 16); // 15:15
export const twWeekday = (now) => tw(now).getUTCDay(); // 0 = 週日
export const twStamp = (ms) => tw(new Date(ms)).toISOString().replace("T", " ").slice(0, 16);
export const addDays = (day, n) => { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// 民國日期 1151021 → 2026-10-21
export const rocToDate = (s) => { const m = String(s || "").match(/^(\d{2,3})(\d{2})(\d{2})$/); return m ? `${Number(m[1]) + 1911}-${m[2]}-${m[3]}` : null; };
export const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

// ── 數字 ──
export const num = (v) => { const t = String(v ?? "").replace(/<[^>]*>/g, "").replace(/[,\s+]/g, ""); if (!t || t === "-" || t === "--") return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
export const fmt = (n, d = 2) => (n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const signed = (n, d = 2) => (n == null ? "—" : `${n > 0 ? "+" : ""}${fmt(n, d)}`);
export const pct = (n, d = 2) => (n == null ? "—" : `${n > 0 ? "+" : ""}${Number(n).toFixed(d)}%`);
// 金額：億元
export const yi = (n, d = 1) => (n == null ? "—" : `${signedIf(n / 1e8, d)} 億`);
const signedIf = (x, d) => Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const arrow = (n) => (n == null ? "" : n > 0 ? "🔺" : n < 0 ? "🔻" : "▪️");
export const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// ── 抓資料：帶 User-Agent，失敗重試一次 ──
export async function getText(url, { headers = {}, timeout = 20000, retries = 1 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*", ...headers }, signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw Object.assign(new Error(`${new URL(url).host} 回應 ${r.status}`), { status: r.status });
      return await r.text();
    } catch (e) {
      last = e;
      if (e.status && e.status < 500 && e.status !== 429) break;
      if (i < retries) await new Promise((res) => setTimeout(res, 1500));
    }
  }
  throw last;
}
export async function getJson(url, opts = {}) {
  const t = await getText(url, { ...opts, headers: { Accept: "application/json", ...(opts.headers || {}) } });
  try { return JSON.parse(t); } catch { throw new Error(`${new URL(url).host} 回傳的不是 JSON`); }
}
// 物件的欄位名稱統一：去掉空白、轉小寫（TPEx 的欄位名稱常常多一個空白）
export const normKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.replace(/\s+/g, "").toLowerCase(), v]));

// ── 資料庫（PostgREST）──
export function makeDb(url, key) {
  const base = String(url || "").replace(/\/$/, "") + "/rest/v1";
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  async function req(method, path, body, extra = {}) {
    const r = await fetch(base + path, { method, headers: { ...h, ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    if (!r.ok) throw new Error(`資料庫 ${r.status}：${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  }
  return {
    req,
    async getState(key, fallback = {}) {
      const rows = await req("GET", `/bot_state?key=eq.${encodeURIComponent(key)}&select=value`);
      return rows?.[0]?.value ?? fallback;
    },
    async setState(key, value) {
      await req("POST", "/bot_state?on_conflict=key", { key, value, updated_at: new Date().toISOString() }, { Prefer: "resolution=merge-duplicates" });
    },
    async settings() {
      const rows = await req("GET", "/settings?key=eq.bots&select=value");
      return rows?.[0]?.value || {};
    },
    async logRun(bot, r) {
      await req("POST", "/bot_runs", { bot, ok: !!r.ok, posted: r.posted || 0, note: clip(r.note || "", 480), ms: r.ms ?? null });
    },
    async auth(secret) {
      try { return (await req("POST", "/rpc/bots_auth", { secret: String(secret || "") })) === true; } catch { return false; }
    },
  };
}

// ── Discord Webhook ──
export const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d{17,20})\/([\w-]{20,100})$/;
// 測試時換成假的伺服器（DISCORD_API_BASE）
export function webhookUrl(url, base) {
  return base ? url.replace(/^https:\/\/[^/]+\/api(?:\/v\d+)?/, base) : url;
}
// 貼一則（最多 10 個 embed）；thread：討論串 ID；被封存的討論串 Webhook 發文時 Discord 會自動解除封存
export async function postWebhook(url, payload, { thread, base, username, avatar } = {}) {
  if (!WEBHOOK_RE.test(String(url || ""))) throw new Error("Webhook 網址不對");
  const q = new URLSearchParams({ wait: "true" });
  if (thread) q.set("thread_id", thread);
  const body = { allowed_mentions: { parse: [] }, ...payload };
  if (username) body.username = username;
  if (avatar) body.avatar_url = avatar;
  const r = await fetch(`${webhookUrl(url, base)}?${q}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (r.status === 429) {
    const wait = Math.min(10, Number((await r.json().catch(() => ({}))).retry_after) || 2);
    await new Promise((res) => setTimeout(res, wait * 1000));
    return postWebhook(url, payload, { thread, base, username, avatar });
  }
  if (!r.ok) {
    const t = (await r.text()).slice(0, 200);
    if (r.status === 404 || r.status === 401) throw new Error("Webhook 已經被刪掉了，請到後台重新設定");
    if (/thread/i.test(t)) throw new Error(`討論串 ID 不對或 Webhook 不在那個頻道：${t}`);
    throw new Error(`Discord ${r.status}：${t}`);
  }
  return r.json();
}

// Discord embed 的限制：標題 256、描述 4096、欄位 25 個（名稱 256、內容 1024）、總長 6000
export function safeEmbed(e) {
  const out = { ...e };
  if (out.title) out.title = clip(out.title, 256);
  if (out.description) out.description = clip(out.description, 4000);
  if (out.fields) out.fields = out.fields.filter((f) => f && f.value).slice(0, 25).map((f) => ({ ...f, name: clip(f.name, 256), value: clip(f.value, 1024) }));
  if (out.footer?.text) out.footer = { ...out.footer, text: clip(out.footer.text, 2048) };
  return out;
}
export const footer = (text) => ({ text: `${BRAND}｜${text}` });

// ── 去重：記住已經發過的項目（最多留 n 筆）──
export async function seenFilter(db, key, ids, { keep = 500 } = {}) {
  const st = await db.getState(key, { ids: [] });
  const seen = new Set(st.ids || []);
  return {
    fresh: ids.filter((id) => !seen.has(id)),
    first: !(st.ids || []).length && !st.initialized,
    async commit(newIds) {
      const all = [...(st.ids || []), ...newIds.filter((x) => !seen.has(x))].slice(-keep);
      await db.setState(key, { ids: all, initialized: true });
    },
  };
}
