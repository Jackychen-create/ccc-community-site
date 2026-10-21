// 測試用（npm test 會自動啟動）：提供 public/ 靜態檔，並模擬 /api 與 Supabase Auth、R2。只在本機測試用。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// 規則跟正式網站讀同一份
import { canUseApi } from "../public/assets/js/shared/roles.js";
import { BOTS as BOT_LIST, GROUPS as BOT_GROUPS } from "../supabase/functions/bots/registry.js";
import { EXCHANGES, AUTO_EXCHANGES, addDays, periodOf, nextPeriod, prevPeriod, COURSE_HOSTS as CH, courseUnlockDate, cleanExId, exIdOk, exIdError, needsName, cleanAccountName, accountNameOk, ACCOUNT_NAME_ERROR, BADGES, earnedBadges, themeUnlocked, courseTierOk, courseSkipSchedule, tierOf, tierStatus, FIRST_CYCLE_TIER, progressTo, tierName, tierRuleText, gapTo, TIERS, rankOneOnOne, oneOnOneScore, ONE_ON_ONE_HOSTS, ONE_ON_ONE_CAP, fmtAmount, streakOf, bestStreakOf, weekOf, QUESTS } from "../public/assets/js/shared/rules.js";

const PORT = Number(process.env.PORT || 4321);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PUB = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "public");
const FONTS = path.join(ROOT, "tests", "node_modules", "@fontsource");
const MEDIA = path.join(ROOT, "tests", "fixtures");
// 跟正式環境一樣的 CSP（讀 Cloudflare 的 _headers）
const CSP = fs.readFileSync(path.join(PUB, "_headers"), "utf8").match(/Content-Security-Policy:\s*(.+)/)[1].trim();

const ADMIN = "boss@gmail.com";
const EDITOR = "oc@gmail.com"; // 協作管理員（只能管影片、提問、統計、看研究員）
const users = {
  "boss@gmail.com": { id: "00000000-0000-4000-8000-000000000001", password: "password1" },
  "oc@gmail.com": { id: "00000000-0000-4000-8000-0000000000c0", password: "password1" },
  "amy@example.com": { id: "00000000-0000-4000-8000-000000000002", password: "password1" },
  "banned@example.com": { id: "00000000-0000-4000-8000-000000000003", password: "password1" },
};
const tokens = new Map();
const d = (n) => new Date(Date.now() + 8 * 3600e3 - n * 86400000).toISOString().slice(0, 10); // 台灣日期
let nextId = 10;
const videos = [
  { id: 6, hosts: ["CCC", "OC"], chapters: [{ t: 0, title: "開場" }, { t: 20, title: "本週違規回顧" }, { t: 50, title: "追單之後怎麼處理" }, { t: 75, title: "Q&A" }], title: "10/9 直播：本週盤勢與紀律檢討", description: "回顧這週的進場理由與違規，重點放在追單之後的處理。", published_at: d(1), is_published: true, duration_sec: 90, size_bytes: 30944161, thumb: "thumb5.jpg", attachments: [{ id: 1, title: "10-9 盤勢整理.pdf", size_bytes: 1830000 }, { id: 2, title: "交易紀錄範本.xlsx", size_bytes: 42000 }] },
  { id: 5, hosts: ["OC"], title: "10/2 直播：NQ 開盤區間怎麼看", description: "開盤 30 分鐘的區間判斷與兩個常見陷阱。", published_at: d(8), is_published: true, duration_sec: 90, size_bytes: 30944161, thumb: "thumb20.jpg", attachments: [] },
  { id: 4, hosts: ["X"], chapters: [{ t: 0, title: "結構停損" }, { t: 30, title: "波動停損" }, { t: 60, title: "時間停損" }], title: "9/25 直播：停損設在哪裡", description: "", published_at: d(15), is_published: true, duration_sec: 90, size_bytes: 30944161, thumb: null, attachments: [{ id: 3, title: "停損講義.pdf", size_bytes: 920000 }] },
  { id: 3, hosts: ["CCC", "X", "OC"], title: "9/18 直播：Q&A", description: "研究員提問整理。", published_at: d(22), is_published: true, duration_sec: 90, size_bytes: 30944161, thumb: "thumb40.jpg", attachments: [] },
  { id: 2, title: "9/11 直播：資金控管", description: "每筆風險怎麼設定，連續虧損時怎麼調整部位。", published_at: d(29), is_published: true, duration_sec: 90, size_bytes: 30944161, thumb: null, attachments: [] },
  { id: 1, title: "10/10 直播（剪輯中）", description: null, published_at: d(0), is_published: false, duration_sec: 90, size_bytes: 30944161, thumb: null, attachments: [] },
];
videos.push(
  { id: 20, course_host: "CCC", course_part: 1, hosts: ["CCC"], title: "交易計畫怎麼寫", description: "課程第一份。", published_at: d(40), is_published: true, duration_sec: 90, size_bytes: 1, thumb: null, attachments: [] },
  { id: 21, course_host: "X", course_part: 1, hosts: ["X"], title: "看懂市場結構", description: null, published_at: d(40), is_published: true, duration_sec: 90, size_bytes: 1, thumb: null, attachments: [] },
  { id: 22, course_host: "OC", course_part: 1, hosts: ["OC"], title: "開盤前的準備", description: null, published_at: d(40), is_published: true, duration_sec: 90, size_bytes: 1, thumb: null, attachments: [] },
  { id: 23, course_host: "CCC", course_part: 2, hosts: ["CCC"], title: "部位大小怎麼算", description: null, published_at: d(40), is_published: true, duration_sec: 90, size_bytes: 1, thumb: null, attachments: [] },
);
const progress = new Map([
  ["00000000-0000-4000-8000-000000000002:5", { position_sec: 40, duration_sec: 90, updated_at: new Date(Date.now() - 3600e3).toISOString() }],
  ["00000000-0000-4000-8000-000000000002:3", { position_sec: 90, duration_sec: 90, updated_at: new Date(Date.now() - 86400e3).toISOString() }],
]);
const invites = [
  { code: "K7QM-2XPA", max_uses: 30, used_count: 12, note: "第一批研究員", disabled: false, created_at: new Date(Date.now() - 20 * 86400e3).toISOString() },
  { code: "HW3N-8RTE", max_uses: 5, used_count: 5, note: "朋友", disabled: false, created_at: new Date(Date.now() - 10 * 86400e3).toISOString() },
  { code: "ZP4D-Y6UC", max_uses: 10, used_count: 1, note: null, disabled: true, created_at: new Date(Date.now() - 3 * 86400e3).toISOString() },
  { code: "GF7T-2FRE", max_uses: 1, used_count: 0, note: "贈送：小明", disabled: false, free: true, created_at: new Date(Date.now() - 1 * 86400e3).toISOString() },
];
const chatCfg = { channels: [], report: "", mode: "own" };
const botCfg = { outlets: [], bots: {}, alert: "", runs: [] };
let chatStats = [];
const members = [
  { user_id: users["amy@example.com"].id, email: "amy@example.com", invite_code: "K7QM-2XPA", banned: false, created_at: new Date(Date.now() - 18 * 86400e3).toISOString(), last_sign_in_at: new Date(Date.now() - 3600e3).toISOString(), watched_count: 2, min_tier: 2, min_tier_until: d(-5), note: "10 月交易量 120 口", notify: true },
  { user_id: users["banned@example.com"].id, email: "banned@example.com", invite_code: "HW3N-8RTE", banned: true, created_at: new Date(Date.now() - 9 * 86400e3).toISOString(), last_sign_in_at: null, watched_count: 0 },
];
const r2 = new Map();
const notes = [{ id: 1, user_id: users["amy@example.com"].id, video_id: 5, t: 25, body: "開盤區間：先等 30 分鐘再畫高低點", created_at: new Date().toISOString() }];
let noteId = 2;
const log = [];
const feedback = [];
let fbId = 1;
const clientErrors = [];
const EX = EXCHANGES;
// 自動同步的交易所：假的代理商資料
// BingX UID 88880001 是我們邀請的，這個月 350 萬（10 號跨過門檻）；Bybit UID 77770001 這個月 150 萬（Bybit 隔天才更新，達標日記昨天）
const autoLinks = Object.fromEntries(EXCHANGES.map((ex) => [ex, new Map()])); // exchange → (user_id → uid)；OKX、UM 只是記下來
const accNames = new Map(); // `${ex}:${user_id}` → UM 註冊用的 Email
const INVITED = { BingX: { "88880001": 3500000 }, Bybit: { "77770001": 1500000 } };
const syncLast = {};
// 直播預告（假的 Discord：只記下發了什麼）
const lives = [];
let liveSeq = 0;
const liveNext = () => lives.filter((l) => l.status === "scheduled" && Date.parse(l.starts_at) >= Date.now() - 3 * 3600e3).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] || null;
const livesOut = (extra = {}) => ({ lives: lives.filter((l) => Date.parse(l.starts_at) >= Date.now() - 30 * 86400e3).sort((a, b) => a.starts_at.localeCompare(b.starts_at)), discord: { configured: true, channelId: "800000000000000004" }, ...extra });
function liveClean(b, partial) {
  const o = {};
  if (!partial || b.title !== undefined) { o.title = String(b.title || "").trim().slice(0, 60); if (!o.title) return { error: "要填直播標題" }; }
  if (!partial || b.startsAt !== undefined) {
    const t = Date.parse(b.startsAt);
    if (!Number.isFinite(t)) return { error: "直播時間格式不正確" };
    if (t < Date.now() - 10 * 60e3) return { error: "直播時間已經過了" };
    o.starts_at = new Date(t).toISOString();
  }
  if (!partial || b.hosts !== undefined) o.hosts = Array.isArray(b.hosts) ? [...new Set(b.hosts.map((h) => String(h).trim()).filter(Boolean))].slice(0, 5) : [];
  if (!partial || b.note !== undefined) o.note = String(b.note || "").trim().slice(0, 500) || null;
  if (!partial || b.link !== undefined) { const l = String(b.link || "").trim(); if (l && !/^https:\/\/\S{4,300}$/.test(l)) return { error: "直播連結要是 https:// 開頭的網址" }; o.link = l || null; }
  return { row: o };
}

// Discord 審核機器人：設定和最近的申請
const discordSettings = { roleId: "1560542923173400596", panelChannelId: "", reviewChannelId: "", invites: {} };
let discordPanels = 0;
const discordApps = [
  { id: 3, discord_name: "小明", exchange: "OKX", exchange_uid: "123456789012345678", status: "pending", auto: false, reviewed_by: null, created_at: new Date(Date.now() - 600e3).toISOString(), reviewed_at: null },
  { id: 2, discord_name: "阿美", exchange: "BingX", exchange_uid: "88880001", status: "approved", invite_code: "Q7MZ-4KPA", auto: true, reviewed_by: "BingX 自動確認", created_at: new Date(Date.now() - 3600e3).toISOString(), reviewed_at: new Date(Date.now() - 3600e3).toISOString() },
  { id: 1, discord_name: "Bob", exchange: "Bybit", exchange_uid: "12345678", status: "rejected", auto: true, reviewed_by: "Bybit 自動確認", created_at: new Date(Date.now() - 86400e3).toISOString(), reviewed_at: new Date(Date.now() - 86400e3).toISOString() },
];
const vols = new Map(); // `${user_id}:${month}` → {amounts, updated_at, updated_by}
const monthNow = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const qualified = (a) => tierOf(a) >= 2; // 第二級以上（記 qualified_at 用）
const TODAY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const twDate = (ts) => new Date(new Date(ts).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const unlockOn = courseUnlockDate;
function linkOf(userId) { return Object.fromEntries(EXCHANGES.filter((ex) => autoLinks[ex].has(userId)).map((ex) => [ex, autoLinks[ex].get(userId)])); }
// 每人一輪：從加入那天（台灣日期）起算
const anchorOf = (m) => twDate(m.created_at);
const curP = (m) => periodOf(anchorOf(m), TODAY());
const periodFor = (m, which) => (which === "previous" ? prevPeriod(anchorOf(m), curP(m)) : curP(m));
// 三級制度：今天第幾級（跟 server/lib/tier.js 一樣）
const tierM = (m) => m.free ? { tier: 2, until: null, cycleTier: 2, period: curP(m), free: true } : tierStatus({ anchor: anchorOf(m), today: TODAY(), amountsOf: (st) => vols.get(m.user_id + ":" + st)?.amounts || {}, override: m.min_tier ? { tier: m.min_tier, until: m.min_tier_until || null } : null });
const clampDay = (d, p) => (d < p.start ? p.start : d > p.end ? p.end : d);
// 進度里程碑：`${user_id}:${period_start}:${level}` → { seen }
const msRows = new Map();
function msHit(m, p, before, after) {
  if (m.free) return;
  const lvl = tierOf(after);
  // 本來就有的等級（第一輪先給的、手動給的）比較高就不恭喜
  const given = Math.max(p.start === anchorOf(m) ? FIRST_CYCLE_TIER : 0, m.min_tier && (!m.min_tier_until || m.min_tier_until >= TODAY()) ? m.min_tier : 0);
  if (lvl < given) return;
  if (lvl > tierOf(before || {}) && !msRows.has(`${m.user_id}:${p.start}:${lvl}`)) msRows.set(`${m.user_id}:${p.start}:${lvl}`, { level: lvl, seen: false });
}
// 徽章：`${user_id}` → Map(badge → { earned_at, seen })
const badgeRows = new Map();
function badgeFacts(m) {
  const rows = [...vols.entries()].filter(([k]) => k.startsWith(m.user_id + ":")).map(([k, v]) => ({ start: k.split(":")[1], ...v }));
  const done = [...progress.entries()].filter(([k]) => k.startsWith(m.user_id + ":")).map(([k, p]) => { const v = videos.find((x) => x.id === Number(k.split(":")[1])); return v && p.position_sec >= (v.duration_sec || p.duration_sec) * 0.95 ? v : null; }).filter(Boolean);
  const course = done.filter((v) => v.course_host);
  const idx = rows.filter((r) => qualified(r.amounts)).map((r) => periodOf(anchorOf(m), r.start).index).sort((a, b) => a - b);
  let streak = 0, run = 0; idx.forEach((i, n) => { run = n && i === idx[n - 1] + 1 ? run + 1 : 1; streak = Math.max(streak, run); });
  return { traded: rows.some((r) => Object.values(r.amounts || {}).some((x) => x > 0)), bestPct: Math.max(0, ...rows.map((r) => progressTo(r.amounts || {}, 2).ratio * 100)), qualified: rows.filter((r) => qualified(r.amounts)).length, maxTier: Math.max(0, ...rows.map((r) => tierOf(r.amounts))), streak,
    hostsDone: CH.filter((h) => new Set(course.filter((v) => v.course_host === h).map((v) => v.course_part)).size >= 6), courseDone: course.length, liveDone: done.length - course.length,
    notes: notes.filter((n) => n.user_id === m.user_id).length, questions: feedback.filter((f) => f.user_id === m.user_id).length,
    questWeeks: [...questRows.entries()].filter(([k, v]) => k.startsWith(m.user_id + ":") && v.done_at).length, bestStreak: bestStreakOf([...(checkinsM.get(m.user_id) || [])]) };
}
function syncBadgesM(m) {
  const f = badgeFacts(m); const had = badgeRows.get(m.user_id) || new Map(); badgeRows.set(m.user_id, had);
  for (const id of earnedBadges(f)) if (!had.has(id)) had.set(id, { earned_at: new Date().toISOString(), seen: false });
  return { f, had };
}
// 一對一：[{ user_id, month, host, booked, created_at }]
const oneRows = [];
function oneBoard(month) {
  const entries = oneRows.filter((x) => x.month === month).map((x) => { const m = members.find((y) => y.user_id === x.user_id); if (!m || m.banned) return null; const a = vols.get(m.user_id + ":" + curP(m).start)?.amounts || {}; const b = progressTo(a, 3); return { ...x, email: m.email, tier: tierM(m).tier, score: oneOnOneScore(a), volume: b.n ? `${b.ex} ${fmtAmount(b.ex, b.n)}${b.ex === "UM" ? "" : " USDT"}` : "—" }; }).filter((e) => e && (e.booked || e.tier >= 3));
  return { month, hosts: ONE_ON_ONE_HOSTS.map((host) => ({ host, list: rankOneOnOne(entries, host) })) };
}
// 連續打卡：user_id → Set(台灣日期)；每週任務：`${user_id}:${week}` → { base, done_at }
const checkinsM = new Map();
const questRows = new Map();
function checkinM(m) { const set = checkinsM.get(m.user_id) || new Set(); set.add(TODAY()); checkinsM.set(m.user_id, set); return { days: streakOf([...set], TODAY()), best: bestStreakOf([...set]) }; }
function questsM(m) {
  const wk = weekOf(TODAY()); const since = Date.parse(wk.start + "T00:00:00Z") - 8 * 3600e3;
  const key = m.user_id + ":" + wk.start;
  let row = questRows.get(key);
  if (!row) { row = { done_at: null }; questRows.set(key, row); }
  const watched = [...progress.entries()].filter(([k, v]) => k.startsWith(m.user_id + ":") && Date.parse(v.updated_at) >= since).filter(([k, v]) => { const vid = videos.find((x) => x.id === Number(k.split(":")[1])); return vid && v.position_sec >= (vid.duration_sec || v.duration_sec) * 0.95; }).length;
  const nn = notes.filter((n) => n.user_id === m.user_id && Date.parse(n.created_at) >= since).length;
  const days = [...(checkinsM.get(m.user_id) || [])].filter((d) => d >= wk.start).length;
  const value = { watch: watched, notes: nn, days };
  const quests = QUESTS.map((q) => ({ id: q.id, icon: q.icon, name: q.name, target: q.target, progress: Math.min(q.target, value[q.id]), done: value[q.id] >= q.target }));
  const allDone = quests.every((q) => q.done); let justDone = false;
  if (allDone && !row.done_at) { row.done_at = new Date().toISOString(); justDone = true; }
  const weeksDone = [...questRows.entries()].filter(([k, v]) => k.startsWith(m.user_id + ":") && v.done_at).length;
  return { week: wk, quests, allDone, justDone, weeksDone };
}
const msUnseen = (m, p) => [...msRows.entries()].filter(([k, v]) => k.startsWith(`${m.user_id}:${p.start}:`) && !v.seen).map(([, v]) => ({ ...v, share: !!discordSettings.celebrateChannelId && !v.shared_at })).sort((a, b) => b.level - a.level)[0] || null;
// 直播精華（AI 整理）：video_id → { status, summary, points, tickers, chapters, posted_at, transcript }
const highlights = new Map();
const sharePosts = [];
function autoSyncUser(ex, userId) {
  const uid = autoLinks[ex].get(userId); if (!uid) return 0;
  const m = members.find((x) => x.user_id === userId); if (!m) return 0;
  const p = curP(m); const key = userId + ":" + p.start; const prev = vols.get(key);
  const amounts = { ...(prev?.amounts || {}), [ex]: INVITED[ex][uid] || 0 };
  const ok = qualified(amounts);
  const qOn = clampDay(ex === "Bybit" ? addDays(TODAY(), -1) : addDays(p.start, 3), p);
  vols.set(key, { amounts, qualified_at: ok ? prev?.qualified_at || qOn : null, updated_at: new Date().toISOString(), updated_by: `${ex} 自動同步` });
  msHit(m, p, prev?.amounts, amounts);
  return tierOf(amounts) > tierOf(prev?.amounts || {}) ? 1 : 0; // 升級幾位
}
function volSnap(which) {
  return { which, today: TODAY(), exchanges: EX, autoExchanges: AUTO_EXCHANGES, tiers: TIERS.map(({ tier, usdt, lots }) => ({ tier, usdt, lots })), rows: [...members].reverse().map((m) => ({ m, p: periodFor(m, which) })).filter((x) => x.p).map(({ m, p }) => { const v = vols.get(m.user_id + ":" + p.start); const ts = tierM(m); return { user_id: m.user_id, email: m.email, banned: m.banned, note: m.note, free: !!m.free, tier: ts.tier, tier_until: ts.until, period_start: p.start, period_end: p.end, next_end: nextPeriod(anchorOf(m), p).end, amounts: v?.amounts || {}, updated_at: v?.updated_at || null, updated_by: v?.updated_by || null, cycle_tier: tierOf(v?.amounts || {}), qualified_at: v?.qualified_at || null, links: linkOf(m.user_id) }; }) };
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((r) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => r(Buffer.concat(chunks)));
  });
}
function auth(req) {
  const t = (req.headers.authorization || "").replace("Bearer ", "");
  return tokens.get(t) || null;
}
const isMember = (u) => u && (u.email === ADMIN || u.email === EDITOR || members.some((m) => m.user_id === u.id && !m.banned));
const thumbUrl = (v) => (v.thumb ? `/media/${v.thumb}?sig=1` : v.thumbKey ? `/r2/${v.thumbKey}` : null);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  log.push(`${req.method} ${p}${url.search}`);

  // ── Supabase Auth 模擬 ──
  if (p.startsWith("/sb/auth/v1/")) {
    if (req.method === "OPTIONS") return send(res, 204);
    const body = (await readBody(req)).toString();
    if (p === "/sb/auth/v1/token") {
      const b = JSON.parse(body || "{}");
      const u = users[b.email];
      if (!u || u.password !== b.password) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
      if (b.email === "banned@example.com") return send(res, 400, { error_code: "user_banned", msg: "User is banned" });
      const t = crypto.randomBytes(8).toString("hex");
      const user = { id: u.id, email: b.email, aud: "authenticated", role: "authenticated", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {} };
      tokens.set(t, user);
      return send(res, 200, { access_token: t, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r" + t, user });
    }
    if (p === "/sb/auth/v1/user") {
      const u = auth(req);
      if (!u) return send(res, 401, { msg: "invalid" });
      if (req.method === "PUT") return send(res, 200, u);
      return send(res, 200, u);
    }
    if (p === "/sb/auth/v1/logout") return send(res, 204);
    return send(res, 404, {});
  }

  // ── R2 模擬（上傳）──
  if (p.startsWith("/r2/")) {
    if (req.method === "PUT") {
      const buf = await readBody(req);
      r2.set(p.slice(4), { size: buf.length, type: req.headers["content-type"] });
      return send(res, 200);
    }
    const f = r2.get(p.slice(4));
    if (!f) return send(res, 404);
    res.writeHead(200, { "Content-Type": f.type });
    return res.end();
  }

  // ── 測試用字型（取代 Google Fonts，因為測試環境連不到外網）──
  if (p.startsWith("/__fonts/")) {
    const file = path.join(FONTS, p.slice(9));
    if (!file.startsWith(FONTS) || !fs.existsSync(file)) return send(res, 404);
    res.writeHead(200, { "Content-Type": file.endsWith(".css") ? "text/css" : "font/woff2" });
    return fs.createReadStream(file).pipe(res);
  }

  // ── 媒體 ──
  if (p.startsWith("/media/")) {
    const file = path.join(MEDIA, path.basename(p));
    if (!fs.existsSync(file)) return send(res, 404);
    const stat = fs.statSync(file);
    const type = file.endsWith(".mp4") ? "video/mp4" : file.endsWith(".webm") ? "video/webm" : "image/jpeg";
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace("bytes=", "").split("-");
      const start = Number(s);
      const end = e ? Number(e) : stat.size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
    return fs.createReadStream(file).pipe(res);
  }

  // ── API 模擬 ──
  if (p.startsWith("/api/")) {
    const u = auth(req);
    const body = req.method === "GET" || req.method === "DELETE" ? {} : JSON.parse((await readBody(req)).toString() || "{}");
    if (p === "/api/register") {
      if (body.email === ADMIN) return send(res, 400, { error: "這個 Email 不能用邀請碼註冊" });
      const inv = invites.find((i) => i.code === body.inviteCode && !i.disabled && i.used_count < i.max_uses);
      if (!inv) return send(res, 400, { error: "邀請碼無效、已停用或已被用完" });
      if (users[body.email]) return send(res, 400, { error: "這個 Email 已經註冊過了，請直接登入" });
      const rex = String(body.exchange || ""), ruid = cleanExId(rex, body.uid);
      // 贈送名額：不用填交易所，不限期
      if (inv.free && !rex) {
        inv.used_count++;
        const id = crypto.randomUUID();
        users[body.email] = { id, password: body.password };
        members.unshift({ user_id: id, email: body.email, invite_code: inv.code, banned: false, created_at: new Date().toISOString(), last_sign_in_at: null, watched_count: 0, access_until: null, free: true, min_tier: 2, min_tier_until: null, notify: true });
        return send(res, 200, { ok: true, free: true });
      }
      if (!EXCHANGES.includes(rex)) return send(res, 400, { error: "請選擇你用 CCC 邀請連結註冊的交易所" });
      if (!exIdOk(rex, ruid)) return send(res, 400, { error: "請填交易所 UID（一串數字）" });
      const racc = needsName(rex) ? cleanAccountName(body.accountName) : null;
      if (needsName(rex) && !accountNameOk(racc)) return send(res, 400, { error: ACCOUNT_NAME_ERROR });
      if ([...autoLinks[rex].values()].includes(ruid)) return send(res, 409, { error: `這個 ${rex} UID 已經被其他研究員填過了，有問題請聯絡管理員` });
      if (AUTO_EXCHANGES.includes(rex) && !(ruid in INVITED[rex])) return send(res, 400, { error: `這個 UID 不是用 CCC 的 ${rex} 邀請連結註冊的。請確認 UID，或用邀請連結重新註冊`, code: "not_invited" });
      inv.used_count++;
      const id = crypto.randomUUID();
      users[body.email] = { id, password: body.password };
      members.unshift({ user_id: id, email: body.email, invite_code: inv.code, banned: false, created_at: new Date().toISOString(), last_sign_in_at: null, watched_count: 0, access_until: null, notify: true });
      autoLinks[rex].set(id, ruid); if (racc) accNames.set(`${rex}:${id}`, racc); if (AUTO_EXCHANGES.includes(rex)) autoSyncUser(rex, id);
      return send(res, 200, { ok: true });
    }
    if (p === "/api/invite") {
      const c = String(url.searchParams.get("code") || "").toUpperCase();
      const i = invites.find((x) => x.code === c);
      return send(res, 200, { free: !!(i?.free && !i.disabled && i.used_count < i.max_uses) });
    }
    // 測試用：補幾天之前的打卡（「這週打開網站 3 天」）
    // 測試用：把研究員的加入日往前移 days 天（進到第二輪以後），可以順便給上一輪的交易量
    if (p === "/api/__test/age") { const m = members.find((x) => x.email === body.email); if (!m) return send(res, 404, {}); m.created_at = new Date(Date.now() - body.days * 86400e3).toISOString(); if (body.prevAmounts) { const pp = prevPeriod(anchorOf(m), curP(m)); if (pp) vols.set(m.user_id + ":" + pp.start, { amounts: body.prevAmounts, qualified_at: null, updated_at: new Date().toISOString(), updated_by: "test" }); } return send(res, 200, { ok: true }); }
    if (p === "/api/__test/highlight") { highlights.set(Number(body.video), body.highlight); return send(res, 200, { ok: true }); }
    if (p === "/api/__test/shares") return send(res, 200, sharePosts);
    if (p === "/api/__test/checkin") { const m = members.find((x) => x.email === body.email); if (!m) return send(res, 404, {}); const set = checkinsM.get(m.user_id) || new Set(); for (const dd of body.days || []) set.add(dd); checkinsM.set(m.user_id, set); return send(res, 200, { ok: true }); }
    // 公開影片（不用登入）
    if (p === "/api/public-video") {
      const pubs = videos.filter((v) => v.is_published && v.is_public);
      if (!url.searchParams.has("id")) return send(res, 200, { videos: pubs.map((v) => ({ id: v.id, title: v.title, duration_sec: v.duration_sec, thumb_url: thumbUrl(v) })) });
      const v = pubs.find((x) => x.id === Number(url.searchParams.get("id")));
      if (!v) return send(res, 404, { error: "找不到這支影片，可能已經下架了" });
      return send(res, 200, { id: v.id, title: v.title, description: v.description, published_at: v.published_at, duration_sec: v.duration_sec, chapters: v.chapters || [], thumb_url: thumbUrl(v), url: "/media/" + (process.env.VIDEO || "live.webm") + "?sig=" + Date.now() });
    }
    if (p === "/api/stats") {
      const pub = videos.filter((v) => v.is_published && !v.course_host).sort((a, b) => String(b.published_at).localeCompare(a.published_at));
      return send(res, 200, { latest: pub[0]?.published_at || null, count: pub.length });
    }
    if (!u) return send(res, 401, { error: "請先登入" });
    const admin = u.email === ADMIN || u.email === EDITOR;
    const role = u.email === EDITOR ? "editor" : "owner";
    if (!admin && !isMember(u)) return send(res, 403, { error: "這個帳號目前沒有觀看權限，請聯絡管理員" });

    const mrow = members.find((m) => m.user_id === u.id);
    // 三級制度：網站內容要第二級；個人資料、提問、徽章每一級都可以
    const ts = mrow ? tierM(mrow) : null;
    // 第一級：教學課程（每位講師第 1 份）、播放、進度、筆記也可以（詳細的在各自的地方檢查）
    const t1ok = ts && ts.tier >= 1 && (["/api/course", "/api/progress", "/api/notes"].includes(p) || (p === "/api/videos" && url.searchParams.has("id")));
    if (ts && ts.tier < 2 && !t1ok && !["/api/me", "/api/exchange-link", "/api/feedback", "/api/report", "/api/badges", "/api/oneonone", "/api/quests", "/api/share"].includes(p)) return send(res, 403, { error: `這個內容要第二級（這一輪 ${tierRuleText(2)}）`, code: "tier", tier: ts.tier });
    if (p === "/api/me") {
      if (req.method === "PATCH") {
        if (body.theme !== undefined) {
          if (!themeUnlocked(String(body.theme), [...(badgeRows.get(mrow.user_id) || new Map()).keys()])) return send(res, 400, { error: "這個主題還沒解鎖", code: "locked" });
          mrow.theme = body.theme; return send(res, 200, { ok: true, theme: body.theme });
        }
        if (body.milestoneSeen) { for (const [k, v] of msRows) if (k.startsWith(mrow.user_id + ":")) v.seen = true; return send(res, 200, { ok: true }); }
        mrow.notify = body.notify;
        return send(res, 200, { ok: true, notify: body.notify });
      }
      return send(res, 200, { links: mrow ? EXCHANGES.map((ex) => ({ exchange: ex, auto: AUTO_EXCHANGES.includes(ex), enabled: true, uid: autoLinks[ex].get(mrow.user_id) || null, accountName: accNames.get(`${ex}:${mrow.user_id}`) || null, needsName: needsName(ex), boundAt: null })) : null, feedbackUnread: feedback.filter((x) => x.user_id === u.id && x.seen_reply === false).length, email: u.email, isAdmin: admin, adminRole: admin ? role : null, tier: mrow ? ts.tier : null, streak: mrow ? checkinM(mrow) : null, invites: mrow ? Object.fromEntries(Object.entries(discordSettings.invites || {}).filter(([, x]) => /^https:\/\//.test(String(x)))) : {}, free: !!mrow?.free, theme: mrow?.theme || null, notify: mrow ? mrow.notify !== false : null, nextLive: (() => { const l = liveNext(); return l ? { title: l.title, startsAt: l.starts_at, hosts: l.hosts || [], note: l.note, link: l.link } : null; })(), volume: mrow ? (() => { const p = curP(mrow); const v = vols.get(mrow.user_id + ":" + p.start); return { periodStart: p.start, periodEnd: p.end, nextEnd: nextPeriod(anchorOf(mrow), p).end, exchanges: EX, amounts: v?.amounts || null, updatedAt: v?.updated_at || null, tier: ts.tier, tierUntil: ts.until, cycleTier: ts.cycleTier, milestone: mrow.free ? null : msUnseen(mrow, p) }; })() : null });
    }
    if (p === "/api/badges") {
      const all = BADGES.map(({ id, icon, name, desc }) => ({ id, icon, name, desc }));
      if (!mrow) return send(res, 200, { badges: [], all, progress: null });
      if (req.method === "PATCH") { for (const v of (badgeRows.get(mrow.user_id) || new Map()).values()) v.seen = true; return send(res, 200, { ok: true }); }
      const { f, had } = syncBadgesM(mrow);
      return send(res, 200, { badges: BADGES.filter((b) => had.has(b.id)).map((b) => ({ id: b.id, earnedAt: had.get(b.id).earned_at, isNew: !had.get(b.id).seen })), all, progress: { bestPct: Math.min(100, Math.round(f.bestPct)), streak: f.streak, liveDone: f.liveDone, courseDone: f.courseDone, notes: f.notes, questions: f.questions, hostsDone: f.hostsDone } });
    }
    if (p === "/api/quests") {
      if (!mrow) return send(res, 200, { quests: null, streak: null });
      const streak = checkinM(mrow); return send(res, 200, { ...questsM(mrow), streak });
    }
    if (p === "/api/oneonone") {
      if (!mrow) return send(res, 200, { month: monthNow(), cap: ONE_ON_ONE_CAP, eligible: false, hosts: [], mine: null });
      if (req.method === "POST") {
        if (ts.tier < 3) return send(res, 403, { error: "這個內容要第三級", code: "tier" });
        if (!ONE_ON_ONE_HOSTS.includes(body.host)) return send(res, 400, { error: "請選一位講師" });
        const old = oneRows.find((x) => x.user_id === mrow.user_id && x.month === monthNow());
        if (old?.booked && old.host !== body.host) return send(res, 400, { error: `這個月已經跟 ${old.host} 約好了，要改請聯絡管理員` });
        if (old) { if (old.host !== body.host) { old.host = body.host; old.created_at = new Date().toISOString(); } }
        else oneRows.push({ user_id: mrow.user_id, month: monthNow(), host: body.host, booked: false, created_at: new Date().toISOString() });
      }
      if (req.method === "DELETE") {
        const i = oneRows.findIndex((x) => x.user_id === mrow.user_id && x.month === monthNow());
        if (i >= 0 && oneRows[i].booked) return send(res, 400, { error: "已經約好時間了，要取消請聯絡管理員" });
        if (i >= 0) oneRows.splice(i, 1);
      }
      const bd = oneBoard(monthNow());
      let mine = null;
      for (const h of bd.hosts) { const me = h.list.find((e) => e.user_id === mrow.user_id); if (me) mine = { host: h.host, rank: me.rank, confirmed: me.confirmed, booked: !!me.booked, waiting: me.confirmed ? 0 : me.rank - ONE_ON_ONE_CAP }; }
      return send(res, 200, { month: bd.month, cap: ONE_ON_ONE_CAP, eligible: ts.tier >= 3, hosts: bd.hosts.map((h) => ({ host: h.host, total: h.list.length, confirmed: h.list.filter((e) => e.confirmed).length })), mine });
    }
    if (p === "/api/exchange-link") {
      const mrow = members.find((m) => m.user_id === u.id);
      if (!mrow) return send(res, 400, { error: "管理員帳號不用綁定交易所" });
      if (req.method === "GET") return send(res, 200, { links: Object.entries(linkOf(u.id)).map(([exchange, exchange_uid]) => ({ exchange, exchange_uid })), enabled: Object.fromEntries(EXCHANGES.map((ex) => [ex, true])) });
      const ex = req.method === "DELETE" ? url.searchParams.get("exchange") : body.exchange;
      if (!EXCHANGES.includes(ex)) return send(res, 400, { error: "不支援這間交易所" });
      if (req.method === "DELETE") { autoLinks[ex].delete(u.id); return send(res, 200, { ok: true }); }
      // 測試用：模擬舊版填的 UM 號碼（沒有姓名）
      if (body.legacy && ex === "UM") { autoLinks.UM.set(u.id, String(body.uid)); accNames.delete(`UM:${u.id}`); return send(res, 200, { ok: true }); }
      const uid = cleanExId(ex, body.uid);
      if (!exIdOk(ex, uid)) return send(res, 400, { error: exIdError(ex) });
      if ([...autoLinks[ex]].some(([k, v]) => v === uid && k !== u.id)) return send(res, 409, { error: "這個 UID 已經被其他研究員綁定了，有問題請聯絡管理員" });
      const acc = needsName(ex) ? cleanAccountName(body.accountName) : null;
      if (needsName(ex) && !accountNameOk(acc)) return send(res, 400, { error: ACCOUNT_NAME_ERROR });
      if (!AUTO_EXCHANGES.includes(ex)) { autoLinks[ex].set(u.id, uid); if (acc) accNames.set(`${ex}:${u.id}`, acc); return send(res, 200, { ok: true, exchange: ex, uid, accountName: acc, synced: false }); }
      if (!(uid in INVITED[ex])) return send(res, 400, { error: `這個 UID 不是用 CCC 的 ${ex} 邀請碼註冊的${ex === "Bybit" ? "（Bybit 要填主帳號的 UID）" : ""}。請確認 UID，或用我們的邀請連結註冊`, code: "not_invited" });
      autoLinks[ex].set(u.id, uid); autoSyncUser(ex, u.id);
      return send(res, 200, { ok: true, exchange: ex, uid, synced: true });
    }
    if (p === "/api/feedback") {
      if (req.method === "POST") {
        if (!String(body.body || "").trim()) return send(res, 400, { error: "請寫下你的問題" });
        const v = videos.find((x) => x.id === body.videoId);
        feedback.unshift({ id: fbId++, user_id: u.id, email: u.email, video_id: v ? v.id : null, t: v ? body.t : null, kind: body.kind === "problem" ? "problem" : "question", body: body.body.trim(), status: "open", reply: null, replied_by: null, replied_at: null, seen_reply: true, created_at: new Date().toISOString() });
        return send(res, 200, { ok: true });
      }
      const mine = feedback.filter((x) => x.user_id === u.id);
      const out = mine.map((x) => ({ ...x, video_title: videos.find((v) => v.id === x.video_id)?.title || null, is_new: x.seen_reply === false }));
      mine.forEach((x) => (x.seen_reply = true));
      return send(res, 200, { feedback: out });
    }
    if (p === "/api/report") {
      clientErrors.unshift({ email: u.email, kind: body.kind, message: body.message, context: body.context || {}, created_at: new Date().toISOString() });
      return send(res, 204);
    }
    if (p === "/api/notes") {
      if (req.method === "GET") {
        const vid = url.searchParams.get("videoId");
        const list = notes.filter((n) => n.user_id === u.id && (!vid || n.video_id === Number(vid))).sort((a, b) => a.t - b.t)
          .map((n) => { const v = videos.find((x) => x.id === n.video_id); return { ...n, video_title: v.title, published_at: v.published_at }; });
        return send(res, 200, { notes: list });
      }
      if (req.method === "POST") {
        if (!String(body.body || "").trim()) return send(res, 400, { error: "筆記內容不能空白" });
        const n = { id: noteId++, user_id: u.id, video_id: body.videoId, t: Math.floor(body.t), body: body.body.trim(), created_at: new Date().toISOString() };
        notes.push(n);
        return send(res, 200, { note: n });
      }
      if (req.method === "DELETE") {
        const i = notes.findIndex((n) => n.id === Number(url.searchParams.get("id")) && n.user_id === u.id);
        if (i >= 0) notes.splice(i, 1);
        return send(res, 200, { ok: true });
      }
    }
    if (p === "/api/videos" && !url.searchParams.has("id")) {
      return send(res, 200, {
        videos: videos.filter((v) => v.is_published && !v.course_host && !v.is_public).map((v) => {
          const pr = progress.get(`${u.id}:${v.id}`);
          return { id: v.id, title: v.title, description: v.description, published_at: v.published_at, duration_sec: v.duration_sec, thumb_url: thumbUrl(v), position_sec: pr?.position_sec || 0, watched_at: pr?.updated_at || null, attachment_count: v.attachments.length, hosts: v.hosts || [], chapters: v.chapters || [] };
        }),
      });
    }
    if (p === "/api/videos") {
      const v = videos.find((x) => x.id === Number(url.searchParams.get("id")));
      if (!v || (!v.is_published && !admin)) return send(res, 404, { error: "找不到這支影片" });
      if (ts && (v.course_host ? !courseTierOk(ts.tier, v.course_part) : ts.tier < 2)) return send(res, 403, { error: `這個內容要第二級（這一輪 ${tierRuleText(2)}）`, code: "tier" });
      if (v.course_host && !admin && !courseSkipSchedule(ts?.tier ?? 0)) { const un = unlockOn(twDate(mrow.created_at), v.course_host, v.course_part); if (un > TODAY()) return send(res, 403, { error: `這一份課程 ${un} 解鎖`, code: "locked", unlock_on: un }); }
      const pr = progress.get(`${u.id}:${v.id}`);
      return send(res, 200, { id: v.id, title: v.title, description: v.description, published_at: v.published_at, duration_sec: v.duration_sec, is_published: v.is_published, thumb_url: thumbUrl(v), hosts: v.hosts || [], chapters: v.chapters || [], course_host: v.course_host || null, course_part: v.course_part || null, url: "/media/" + (process.env.VIDEO || "live.webm") + "?sig=" + Date.now(), position_sec: pr?.position_sec || 0, attachments: v.attachments.map((a) => ({ ...a, url: "/media/thumb5.jpg?dl=1" })), highlight: (() => { const h = highlights.get(v.id); return h?.status === "done" ? { summary: h.summary, points: h.points, tickers: h.tickers, chapters: h.chapters } : null; })() });
    }
    // 升級後「分享到 Discord」
    if (p === "/api/share" && req.method === "POST") {
      if (!mrow) return send(res, 400, { error: "管理員帳號沒有等級可以分享" });
      if (!discordSettings.celebrateChannelId) return send(res, 400, { error: "管理員還沒設定要分享到哪個頻道" });
      const hit = [...msRows.entries()].find(([k, v]) => k.startsWith(mrow.user_id + ":") && v.level === Number(body.level));
      if (!hit) return send(res, 404, { error: "找不到這次升級" });
      if (hit[1].shared_at) return send(res, 409, { error: "這次升級已經分享過了" });
      hit[1].shared_at = new Date().toISOString();
      sharePosts.push({ user_id: mrow.user_id, level: Number(body.level), channel: discordSettings.celebrateChannelId });
      return send(res, 200, { ok: true });
    }
    if (p === "/api/course") {
      const start = mrow ? twDate(mrow.created_at) : TODAY();
      const slots = [];
      for (let part = 1; part <= 6; part++) for (const h of CH) {
        const un = unlockOn(start, h, part); const tierLocked = !!mrow && !courseTierOk(ts.tier, part); const unlocked = !mrow || ((un <= TODAY() || courseSkipSchedule(ts.tier)) && !tierLocked);
        const v = videos.find((x) => x.is_published && x.course_host === h && x.course_part === part);
        const pr = v && progress.get(`${u.id}:${v.id}`);
        slots.push({ host: h, part, week: (part - 1) * 4 + CH.indexOf(h) + 1, unlock_on: un, unlocked, tier_locked: tierLocked,
          video: v ? (unlocked ? { id: v.id, title: v.title, description: v.description, duration_sec: v.duration_sec, thumb_url: thumbUrl(v), position_sec: pr?.position_sec || 0, watched_at: pr?.updated_at || null, attachment_count: v.attachments.length, chapters: v.chapters || [] } : { title: v.title }) : null });
      }
      slots.sort((a, b) => a.week - b.week);
      return send(res, 200, { start, today: TODAY(), slots });
    }
    if (p === "/api/progress") {
      const prevP = progress.get(`${u.id}:${body.videoId}`);
      const bk = { ...(prevP?.buckets || {}) };
      if (!admin && body.seen) for (const [k, c] of Object.entries(body.seen)) bk[k] = (bk[k] || 0) + Math.min(5, c);
      progress.set(`${u.id}:${body.videoId}`, { position_sec: body.position, duration_sec: body.duration, updated_at: new Date().toISOString(), buckets: bk });
      return send(res, 204);
    }
    if (!admin) return send(res, 403, { error: "只有管理員可以使用後台" });
    if (!canUseApi(role, p.replace(/^\/api\//, ""), req.method)) return send(res, 403, { error: "這個功能只有主要管理員可以使用", code: "owner_only" });

    if (p === "/api/admin/lives") {
      if (req.method === "GET") return send(res, 200, livesOut());
      if (req.method === "POST") {
        const { row, error } = liveClean(body, false);
        if (error) return send(res, 400, { error });
        const l = { id: ++liveSeq, ...row, mention: body.mention !== false, status: "scheduled", discord_message_id: "95000000000000000" + liveSeq, reminded_at: null, created_by: u.email };
        lives.push(l);
        return send(res, 200, livesOut({ id: l.id, announce: { posted: true } }));
      }
      if (req.method === "PATCH") {
        const l = lives.find((x) => x.id === Number(body.id));
        if (!l) return send(res, 404, { error: "找不到這場直播" });
        if (l.status !== "scheduled") return send(res, 400, { error: "這場直播已經取消了" });
        const { row, error } = liveClean(body, true);
        if (error) return send(res, 400, { error });
        Object.assign(l, row);
        return send(res, 200, livesOut({ announce: { posted: true } }));
      }
      if (req.method === "DELETE") {
        const l = lives.find((x) => x.id === Number(url.searchParams.get("id")) && x.status === "scheduled");
        if (!l) return send(res, 404, { error: "找不到這場直播，或已經取消了" });
        l.status = "cancelled";
        return send(res, 200, livesOut({ announce: { posted: true } }));
      }
    }
    // 機器人（假的：預覽回一張固定的卡片）
    if (p === "/api/admin/bots") {
      const masked = () => botCfg.outlets.map((o) => ({ id: o.id, name: o.name, tail: o.url.slice(-4), hasUrl: true, hookName: "CCC Market Lab", channelId: "100000000000000001" }));
      if (req.method === "GET") return send(res, 200, { groups: BOT_GROUPS, bots: BOT_LIST.map((b) => ({ ...b, conf: botCfg.bots[b.key] || {}, runs: botCfg.runs.filter((r) => r.bot === b.key) })), outlets: masked(), alertOutlet: botCfg.alert, engineReady: true });
      if (req.method === "PATCH") {
        if (body.addOutlet) {
          if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{20,}$/.test(body.addOutlet.url || "")) return send(res, 400, { error: "Webhook 網址不對：要是 https://discord.com/api/webhooks/… 開頭" });
          botCfg.outlets.push({ id: "o" + (botCfg.outlets.length + 1), name: body.addOutlet.name, url: body.addOutlet.url });
        }
        if (body.removeOutlet) botCfg.outlets = botCfg.outlets.filter((o) => o.id !== body.removeOutlet);
        if (body.bot) {
          const cur = botCfg.bots[body.bot] || {};
          if (body.thread && !/^\d{17,20}$/.test(body.thread)) return send(res, 400, { error: "討論串 ID 是 17–20 位數字（對討論串按右鍵「複製討論串 ID」），不用就留空白" });
          if (body.enabled && !body.outlet) return send(res, 400, { error: "先選要貼到哪個 Webhook 再打開" });
          botCfg.bots[body.bot] = { ...cur, outlet: body.outlet ?? cur.outlet, thread: body.thread ?? cur.thread, opts: body.opts ?? cur.opts, ...(body.enabled !== undefined ? { enabled: body.enabled } : {}) };
        }
        if (body.alertOutlet !== undefined) botCfg.alert = body.alertOutlet;
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST") {
        if (body.dryRun) return send(res, 200, { ok: true, posted: 0, preview: [{ title: "📋 台股盤後報告｜2026/10/21", color: 13198941, fields: [{ name: "📈 大盤", value: "加權 46,887.77　🔺 594.84（+1.28%）" }], footer: { text: "CCC Market Lab｜資訊整理，不是投資建議" } }] });
        botCfg.runs.unshift({ bot: body.run, at: new Date().toISOString(), ok: true, posted: 1, note: "加權 +1.28%" });
        return send(res, 200, { ok: true, posted: 1, note: "加權 +1.28%" });
      }
    }
    // 聊天統計（假的：頻道名稱照 ID 尾數，統計固定數字）
    if (p === "/api/admin/chatlog") {
      if (req.method === "GET") return send(res, 200, { configured: true, channels: chatCfg.channels.map(({ webhook, ...c }) => ({ ...c, hasWebhook: !!webhook, webhookTail: webhook ? webhook.slice(-4) : "" })), reportChannelId: chatCfg.report, postMode: chatCfg.mode, reviewChannelId: "100000000000000008", stats: chatStats });
      if (req.method === "PATCH") {
        const ids = String(body.channelIds || "").split(/[\s,，、]+/).filter(Boolean);
        if (ids.some((v) => !/^\d{17,20}$/.test(v))) return send(res, 400, { error: "頻道 ID 是 17–20 位數字（在 Discord 對頻道按右鍵「複製頻道 ID」），多個用逗號分開" });
        for (const [id, url] of Object.entries(body.webhooks || {})) if (url && !/^https:\/\/discord\.com\/api\/webhooks\/\d{17,20}\/[\w-]{20,}$/.test(url)) return send(res, 400, { error: "Webhook 網址不對：要是 https://discord.com/api/webhooks/… 開頭" });
        chatCfg.channels = ids.map((id) => {
          const old = chatCfg.channels.find((c) => c.id === id) || {};
          const w = body.webhooks?.[id];
          const c = { ...old, id, name: id.endsWith("1") ? "大廳" : "研究員大廳" };
          if (w === null) { delete c.webhook; delete c.webhookName; delete c.webhookChannelName; }
          else if (w) Object.assign(c, { webhook: w, webhookName: "CCC｜每日回顧", webhookChannelName: id.endsWith("1") ? "每日回顧" : "研究員大廳" });
          return c;
        });
        chatCfg.report = body.reportChannelId || "";
        if (body.postMode === "single" && !chatCfg.report) return send(res, 400, { error: "選「全部貼到同一個頻道」要填那個頻道的 ID" });
        chatCfg.mode = body.postMode || "own";
        return send(res, 200, { ok: true, channels: chatCfg.channels.map(({ webhook, ...c }) => ({ ...c, hasWebhook: !!webhook })), reportChannelId: chatCfg.report });
      }
      if (req.method === "POST") {
        const rows = chatCfg.channels.map((c, i) => ({ id: c.id, name: c.name, messages: 40 + i * 20, authors: 6 + i, top: [{ name: "Amy", n: 12 }] }));
        for (const r of rows) { chatStats = chatStats.filter((s) => !(s.day === body.day && s.channel_id === r.id)); chatStats.unshift({ day: body.day, channel_id: r.id, channel_name: r.name, messages: r.messages, authors: r.authors, top: r.top, truncated: false }); }
        return send(res, 200, { ok: true, day: body.day, rows, total: { messages: rows.reduce((a, r) => a + r.messages, 0), authors: 8 }, posted: true, posts: [], mode: chatCfg.mode, postError: null, noContent: false });
      }
    }
    if (p === "/api/admin/videos") {
      if (req.method === "GET") return send(res, 200, { videos: videos.map((v) => ({ ...v, thumb_url: thumbUrl(v) })) });
      if (req.method === "POST") {
        const v = { id: nextId++, title: body.title, description: null, published_at: body.published_at, is_published: false, duration_sec: body.duration_sec, size_bytes: body.size_bytes, thumb: null, thumbKey: body.thumb_key, attachments: [] };
        videos.unshift(v);
        return send(res, 200, { id: v.id });
      }
      if (req.method === "PATCH") {
        const v = videos.find((x) => x.id === body.id);
        for (const k of ["description", "published_at", "is_published", "is_public", "hosts", "chapters", "course_host", "course_part"]) if (body[k] !== undefined) v[k] = body[k];
        const out = { ok: true };
        if (body.title !== undefined) out.title = v.title = String(body.title).replace(/^\s*\d{1,2}\s*[\/.\-]\s*\d{1,2}\s*(?:(?:直播|live)\s*)?(?:[：:\-–—|｜]\s*|\s+(?=\S))/i, "").trim() || body.title;
        if (body.thumb_key) { v.thumb = null; v.thumbKey = body.thumb_key; out.thumb_url = `/r2/${body.thumb_key}`; }
        return send(res, 200, out);
      }
      if (req.method === "DELETE") {
        const i = videos.findIndex((x) => x.id === Number(url.searchParams.get("id")));
        videos.splice(i, 1);
        return send(res, 200, { ok: true });
      }
    }
    if (p === "/api/admin/upload-url") {
      const key = `${body.kind}/${crypto.randomBytes(3).toString("hex")}-${body.filename}`;
      return send(res, 200, { key, url: `/r2/${key}`, contentType: body.contentType });
    }
    if (p === "/api/admin/attachments") {
      if (req.method === "POST") {
        const v = videos.find((x) => x.id === body.video_id);
        const a = { id: nextId++, title: body.title, size_bytes: body.size_bytes };
        v.attachments.push(a);
        return send(res, 200, { id: a.id });
      }
      for (const v of videos) v.attachments = v.attachments.filter((a) => a.id !== Number(url.searchParams.get("id")));
      return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/invites") {
      if (req.method === "GET") return send(res, 200, { invites });
      if (req.method === "POST") {
        const inv = { code: body.free ? "NEW4-FREE" : "NEW4-C0DE", max_uses: body.max_uses, used_count: 0, note: body.note || null, disabled: false, free: body.free === true, created_at: new Date().toISOString() };
        invites.unshift(inv);
        return send(res, 200, { invite: inv });
      }
      if (req.method === "DELETE") {
        const code = url.searchParams.get("code");
        const i = invites.findIndex((x) => x.code === code);
        if (i < 0) return send(res, 404, { error: "找不到這組實驗室密碼" });
        invites.splice(i, 1);
        return send(res, 200, { ok: true });
      }
      const inv = invites.find((i) => i.code === body.code);
      if (typeof body.disabled === "boolean") inv.disabled = body.disabled;
      if (body.note !== undefined) inv.note = String(body.note || "").trim().slice(0, 100) || null;
      return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/discord") {
      if (req.method === "GET") return send(res, 200, { configured: true, settings: discordSettings, applications: discordApps.map((a) => { const hit = members.find((m) => linkOf(m.user_id)[a.exchange] === a.exchange_uid); return { ...a, site_email: hit?.email || null }; }), inviteUrl: "https://discord.com/oauth2/authorize?client_id=111111111111111111&scope=bot&permissions=268528656" });
      if (req.method === "PATCH") {
        for (const k of ["roleId", "panelChannelId", "reviewChannelId", "highlightChannelId", "celebrateChannelId"]) {
          if (body[k] === undefined) continue;
          const v = String(body[k] || "").trim();
          if (v && !/^\d{17,20}$/.test(v)) return send(res, 400, { error: "ID 是 17–20 位數字，請在 Discord 對頻道或身分組按右鍵「複製 ID」" });
          discordSettings[k] = v;
        }
        if (body.staffRoleIds !== undefined) {
          const list = String(body.staffRoleIds || "").split(/[\s,，、]+/).filter(Boolean);
          if (list.some((v) => !/^\d{17,20}$/.test(v))) return send(res, 400, { error: "客服身分組 ID 是 17–20 位數字，多個用逗號分開" });
          discordSettings.staffRoleIds = list;
        }
        if (body.invites) discordSettings.invites = body.invites;
        if (body.hostIds) discordSettings.hostIds = body.hostIds;
        return send(res, 200, { ok: true, settings: discordSettings, synced: null });
      }
      if (body.action === "setup") {
        const created = discordSettings.labChannelId ? [] : ["🧪 CCC 交易實驗室", "📝報名培訓計畫", "🔒報名審核", "📢研究員專屬公告", "🎫 培訓計畫報名"];
        Object.assign(discordSettings, { guildId: "222222222222222222", categoryId: "800000000000000001", panelChannelId: "800000000000000002", reviewChannelId: "800000000000000003", labChannelId: "800000000000000004", ticketCategoryId: "800000000000000005" });
        return send(res, 200, { ok: true, guildName: "CCC 交易實驗室", hierarchyOk: false, roleName: "實驗室研究員", created, settings: discordSettings });
      }
      if (!discordSettings.panelChannelId) return send(res, 400, { error: "先填報名頻道的 ID" });
      discordPanels++;
      return send(res, 200, { ok: true, messageId: "900000000000000001" });
    }
    if (p === "/api/admin/sync") {
      const overview = () => Object.fromEntries(AUTO_EXCHANGES.map((ex) => [ex, { configured: true, linked: autoLinks[ex].size, last: syncLast[ex] || null }]));
      if (req.method === "GET") return send(res, 200, { exchanges: overview() });
      for (const ex of body.exchange ? [body.exchange] : AUTO_EXCHANGES) {
        let tierUps = 0; for (const id of autoLinks[ex].keys()) tierUps += autoSyncUser(ex, id);
        syncLast[ex] = { at: new Date().toISOString(), ok: true, users: autoLinks[ex].size, saved: autoLinks[ex].size, tierUps };
      }
      return send(res, 200, { ok: true, exchanges: overview() });
    }
    if (p === "/api/admin/volumes") {
      if (req.method === "GET") return send(res, 200, volSnap(url.searchParams.get("which") === "previous" ? "previous" : "current"));
      const which = body.which === "previous" ? "previous" : "current";
      let saved = 0, tierUps = 0;
      for (const r of body.rows || []) {
        const m = members.find((x) => x.user_id === r.userId); if (!m) continue;
        const pp = periodFor(m, which); if (!pp) continue;
        const qOn = clampDay(body.qualifiedOn || TODAY(), pp);
        const amounts = {}; for (const e of EX) if (!AUTO_EXCHANGES.includes(e) && r.amounts?.[e] != null && r.amounts[e] !== "") amounts[e] = Math.round(Number(r.amounts[e]) * 100) / 100;
        const prevRow = vols.get(m.user_id + ":" + pp.start);
        for (const e of AUTO_EXCHANGES) if (prevRow?.amounts?.[e] != null) amounts[e] = prevRow.amounts[e];
        const prevQ = prevRow?.qualified_at || null;
        const ok = qualified(amounts);
        vols.set(m.user_id + ":" + pp.start, { amounts, qualified_at: ok ? prevQ || qOn : null, updated_at: new Date().toISOString(), updated_by: u.email }); saved++;
        msHit(m, pp, prevRow?.amounts, amounts);
        if (tierOf(amounts) > tierOf(prevRow?.amounts || {})) tierUps++;
      }
      return send(res, 200, { ...volSnap(which), saved, tierUps });
    }
    if (p === "/api/admin/highlights") {
      const id = Number(req.method === "GET" ? url.searchParams.get("video") : body.video);
      const v = videos.find((x) => x.id === id);
      if (!v) return send(res, 404, { error: "找不到這支影片" });
      if (req.method === "GET") { const h = highlights.get(id); return send(res, 200, { highlight: h ? { ...h, chunk_count: h.transcript ? 2 : 0 } : null }); }
      if (body.action === "redo") { highlights.set(id, { ...(highlights.get(id) || {}), status: "pending", error: null }); return send(res, 200, { ok: true }); }
      const h = highlights.get(id);
      if (!h || h.status !== "done") return send(res, 400, { error: "精華還沒做好" });
      if (body.action === "apply") { v.chapters = h.chapters; return send(res, 200, { ok: true, chapters: h.chapters }); }
      if (body.action === "post") { if (!discordSettings.highlightChannelId) return send(res, 400, { error: "還沒設定直播精華要貼到哪個頻道（後台 Discord 審核 → 直播精華頻道）" }); h.posted_at = new Date().toISOString(); return send(res, 200, { ok: true }); }
      return send(res, 400, { error: "不知道要做什麼" });
    }
    if (p === "/api/admin/notify" && videos.find((x) => x.id === body.videoId)?.course_host) return send(res, 400, { error: "教學課程依每個人的加入日期解鎖，不寄全體通知" });
    if (p === "/api/admin/notify") return send(res, 200, { ok: true, sent: members.filter((m) => !m.banned && m.notify !== false).length });
    if (p === "/api/admin/feedback") {
      if (req.method === "PATCH") {
        const x = feedback.find((y) => y.id === body.id);
        if (body.status) x.status = body.status;
        if (body.reply) Object.assign(x, { reply: body.reply, replied_by: u.email, replied_at: new Date().toISOString(), seen_reply: false, status: "done" });
        return send(res, 200, { ok: true, mailed: !!body.reply });
      }
      const st = url.searchParams.get("status");
      return send(res, 200, { open: feedback.filter((x) => x.status === "open").length, feedback: feedback.filter((x) => !st || x.status === st).map((x) => ({ ...x, video_title: videos.find((v) => v.id === x.video_id)?.title || null })) });
    }
    if (p === "/api/admin/errors") {
      if (req.method === "DELETE") {
        const k = url.searchParams.get("kind"), msg = url.searchParams.get("message");
        for (let i = clientErrors.length - 1; i >= 0; i--) if (clientErrors[i].kind === k && (k === "search_empty" ? String(clientErrors[i].context.q).toLowerCase() === msg.toLowerCase() : clientErrors[i].message === msg)) clientErrors.splice(i, 1);
        return send(res, 200, { ok: true });
      }
      const groups = new Map(), searches = new Map();
      for (const e of clientErrors) {
        if (e.kind === "search_empty") { const q = String(e.context.q || e.message); const g = searches.get(q.toLowerCase()) || { q, count: 0, users: new Set(), last_at: e.created_at }; g.count++; g.users.add(e.email); searches.set(q.toLowerCase(), g); continue; }
        const key = e.kind + "|" + e.message; const g = groups.get(key) || { kind: e.kind, message: e.message, count: 0, users: new Set(), last_at: e.created_at, samples: [] };
        g.count++; g.users.add(e.email); if (g.samples.length < 5) g.samples.push({ email: e.email, at: e.created_at, context: e.context }); groups.set(key, g);
      }
      const pack = (g) => ({ ...g, users: [...g.users], user_count: g.users.size });
      return send(res, 200, { days: Number(url.searchParams.get("days") || 7), total: clientErrors.length, groups: [...groups.values()].map(pack), searches: [...searches.values()].map(pack) });
    }
    if (p === "/api/admin/oneonone") {
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || body.month || "") ? url.searchParams.get("month") || body.month : monthNow();
      if (req.method === "PATCH") { const r = oneRows.find((x) => x.user_id === body.userId && x.month === month); if (!r) return send(res, 404, { error: "找不到這筆" }); r.booked = body.booked; }
      if (req.method === "DELETE") { const i = oneRows.findIndex((x) => x.user_id === url.searchParams.get("userId") && x.month === month); if (i >= 0) oneRows.splice(i, 1); }
      return send(res, 200, oneBoard(month));
    }
    if (p === "/api/admin/followup") {
      const today = TODAY(); const out = [];
      for (const m of members) {
        if (m.banned) continue;
        const reasons = []; const prog = [...progress.entries()].filter(([k]) => k.startsWith(m.user_id + ":")).map(([k, v]) => ({ video_id: Number(k.split(":")[1]), ...v }));
        const ts = tierM(m); const vv = vols.get(m.user_id + ":" + curP(m).start);
        if (ts.tier === 0) reasons.push({ key: "notier", label: "沒有等級（Discord 身分組可以拿掉）", level: 2 });
        else if (ts.cycleTier < ts.tier && ts.until && !m.free) reasons.push({ key: "drop", label: `${ts.until.slice(5).replace("-", "/")} 後降到${tierName(ts.cycleTier)}（${tierName(ts.tier)}${gapTo(vv?.amounts || {}, ts.tier)}）`, level: ts.until <= addDays(today, 7) ? 2 : 1 });
        if (ts.tier >= 3) { const pk = oneBoard(monthNow()).hosts.flatMap((h) => h.list.map((e) => ({ host: h.host, ...e }))).find((e) => e.user_id === m.user_id); if (!pk) reasons.push({ key: "oneonone", label: "第三級：這個月還沒選一對一講師", level: 1 }); else if (!pk.booked) reasons.push({ key: "oneonone", label: `一對一：${pk.host} 第 ${pk.rank} 位（${pk.confirmed ? "確定，還沒約時間" : "候補"}）`, level: pk.confirmed ? 2 : 1 }); }
        const last = prog.map((x) => x.updated_at).sort().pop() || null;
        const away = last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : null;
        if (!last) reasons.push({ key: "inactive", label: "加入後還沒看過影片", level: 2 }); else if (away >= 14) reasons.push({ key: "inactive", label: `${away} 天沒來看`, level: 1 });
        const q = feedback.filter((x) => x.user_id === m.user_id && x.status === "open").length;
        if (q) reasons.push({ key: "feedback", label: `${q} 則提問還沒回`, level: 2 });
        out.push({ user_id: m.user_id, email: m.email, tier: ts.tier, tier_until: ts.until, cycle_tier: ts.cycleTier, min_tier: m.min_tier || null, min_tier_until: m.min_tier_until || null, note: m.note, joined: twDate(m.created_at), last_watched_at: last, watched: prog.length, completed: 0, course: { unlocked: 3, behind: 1 }, reasons, score: reasons.reduce((a, r) => a + r.level, 0) });
      }
      out.sort((a, b) => b.score - a.score);
      const counts = {}; for (const r of out) for (const x of r.reasons) counts[x.key] = (counts[x.key] || 0) + 1;
      return send(res, 200, { today, counts, rows: out });
    }
    if (p === "/api/admin/stats" && url.searchParams.has("video")) {
      const v = videos.find((x) => x.id === Number(url.searchParams.get("video")));
      const ids = new Set(members.map((m) => m.user_id));
      const rows = [...progress.entries()].filter(([k]) => k.endsWith(":" + v.id) && ids.has(k.split(":")[0])).map(([, x]) => x);
      const n = Math.max(1, Math.ceil(v.duration_sec / 30));
      const b = Array.from({ length: n }, () => ({ viewers: 0, plays: 0, stops: 0 }));
      let tracked = 0;
      for (const r of rows) { const ks = Object.keys(r.buckets || {}); if (ks.length) tracked++; for (const k of ks) if (b[k]) { b[k].viewers++; b[k].plays += r.buckets[k]; } if (r.position_sec < v.duration_sec * 0.95) b[Math.min(n - 1, Math.floor(r.position_sec / 30))].stops++; }
      return send(res, 200, { video: { id: v.id, title: v.title, chapters: v.chapters || [] }, duration: v.duration_sec, bucket_sec: 30, viewers_total: rows.length, tracked, completed: rows.filter((r) => r.position_sec >= v.duration_sec * 0.95).length, buckets: b, feedback: feedback.filter((x) => x.video_id === v.id) });
    }
    if (p === "/api/admin/stats") {
      const ids = new Set(members.map((m) => m.user_id));
      const pr = [...progress.entries()].map(([k, v]) => ({ user_id: k.split(":")[0], video_id: Number(k.split(":")[1]), ...v })).filter((x) => ids.has(x.user_id));
      return send(res, 200, {
        memberCount: members.length,
        videos: videos.map((v) => { const rows = pr.filter((x) => x.video_id === v.id); return { id: v.id, title: v.title, published_at: v.published_at, is_published: v.is_published, viewers: rows.length, completed: rows.filter((x) => x.position_sec >= v.duration_sec * 0.95).length, avg_pct: rows.length ? Math.round(rows.reduce((a, x) => a + Math.min(1, x.position_sec / v.duration_sec), 0) / rows.length * 100) : 0 }; }),
        members: members.map((m) => { const rows = pr.filter((x) => x.user_id === m.user_id); return { user_id: m.user_id, email: m.email, banned: m.banned, access_until: m.access_until, watched: rows.length, completed: rows.filter((x) => x.position_sec >= 85).length, last_watched_at: rows.map((x) => x.updated_at).sort().pop() || null }; }),
      });
    }
    if (p === "/api/admin/members") {
      if (req.method === "GET") {
        const dcBy = new Map(discordApps.filter((a) => a.status === "approved").map((a) => [`${a.exchange}:${a.exchange_uid}`, a.discord_name]));
        return send(res, 200, { members: members.map((m) => { const uids = linkOf(m.user_id); const ts = tierM(m); return { ...m, tier: ts.tier, tier_until: ts.until, cycle_tier: ts.cycleTier, uids, account_names: Object.fromEntries(EXCHANGES.filter((ex) => accNames.has(`${ex}:${m.user_id}`)).map((ex) => [ex, accNames.get(`${ex}:${m.user_id}`)])), discord: Object.entries(uids).map(([ex, id]) => dcBy.get(`${ex}:${id}`)).find(Boolean) || null }; }) });
      }
      const m = members.find((x) => x.user_id === body.userId);
      if (body.action === "reset") return send(res, 200, { password: "Tq8mWz3kPa7c" });
      if (body.action === "access") {
        if (body.volumeFrom !== undefined) {
          if (body.volumeFrom && body.volumeFrom >= twDate(m.created_at)) return send(res, 400, { error: "要早於加入網站那天" });
          m.volume_from = body.volumeFrom || null;
        }
        if (body.minTier !== undefined) { m.min_tier = body.minTier || null; m.min_tier_until = body.minTier ? body.minTierUntil || null : null; }
        if (body.note !== undefined) m.note = body.note || null;
        return send(res, 200, { ok: true });
      }
      m.banned = body.action === "ban";
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  }

  if (p === "/__log") return send(res, 200, log.splice(0));

  // ── 靜態檔 ──
  let file = p === "/" ? "/index.html" : p;
  if (p === "/admin") file = "/admin.html";
  if (p === "/watch") file = "/watch.html";
  if (p === "/config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(`window.APP_CONFIG = { SUPABASE_URL: "http://localhost:${PORT}/sb", SUPABASE_ANON_KEY: "anon", SITE_NAME: "CCC 交易實驗室", HOSTS: ["CCC", "X", "OC"] };`);
  }
  const full = path.join(PUB, path.normalize(file));
  if (!full.startsWith(PUB) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, { error: "nf" });
  const ext = path.extname(full);
  const types = { ".mp4": "video/mp4", ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Content-Security-Policy": CSP });
  fs.createReadStream(full).pipe(res);
});
server.listen(PORT, () => console.log("mock on " + PORT));
