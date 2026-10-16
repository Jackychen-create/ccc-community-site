// 測試用（npm test 會自動啟動）：提供 public/ 靜態檔，並模擬 /api 與 Supabase Auth、R2。只在本機測試用。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
// 規則跟正式網站讀同一份
import { EXCHANGES, AUTO_EXCHANGES, isQualified, addDays, cycleEnd, COURSE_HOSTS as CH, courseUnlockDate } from "../public/assets/js/shared/rules.js";

const PORT = Number(process.env.PORT || 4321);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PUB = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "public");
const FONTS = path.join(ROOT, "tests", "node_modules", "@fontsource");
const MEDIA = path.join(ROOT, "tests", "fixtures");
// 跟正式環境一樣的 CSP（讀 Cloudflare 的 _headers）
const CSP = fs.readFileSync(path.join(PUB, "_headers"), "utf8").match(/Content-Security-Policy:\s*(.+)/)[1].trim();

const ADMIN = "boss@gmail.com";
const users = {
  "boss@gmail.com": { id: "00000000-0000-4000-8000-000000000001", password: "password1" },
  "amy@example.com": { id: "00000000-0000-4000-8000-000000000002", password: "password1" },
  "banned@example.com": { id: "00000000-0000-4000-8000-000000000003", password: "password1" },
};
const tokens = new Map();
const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
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
];
const members = [
  { user_id: users["amy@example.com"].id, email: "amy@example.com", invite_code: "K7QM-2XPA", banned: false, created_at: new Date(Date.now() - 18 * 86400e3).toISOString(), last_sign_in_at: new Date(Date.now() - 3600e3).toISOString(), watched_count: 2, access_until: d(-5), note: "10 月交易量 120 口", notify: true },
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
let threshold = 1000000;
// 自動同步的交易所：假的代理商資料
// BingX UID 88880001 是我們邀請的，這個月 350 萬（10 號跨過門檻）；Bybit UID 77770001 這個月 150 萬（Bybit 隔天才更新，達標日記昨天）
const autoLinks = Object.fromEntries(AUTO_EXCHANGES.map((ex) => [ex, new Map()])); // exchange → (user_id → uid)
const INVITED = { BingX: { "88880001": 3500000 }, Bybit: { "77770001": 1500000 } };
const syncLast = {};
// Discord 審核機器人：設定和最近的申請
const discordSettings = { roleId: "1560542923173400596", panelChannelId: "", reviewChannelId: "", invites: {} };
let discordPanels = 0;
const discordApps = [
  { id: 3, discord_name: "小明", exchange: "OKX", exchange_uid: "123456789012345678", status: "pending", auto: false, reviewed_by: null, created_at: new Date(Date.now() - 600e3).toISOString(), reviewed_at: null },
  { id: 2, discord_name: "阿美", exchange: "BingX", exchange_uid: "88880001", status: "approved", auto: true, reviewed_by: "BingX 自動確認", created_at: new Date(Date.now() - 3600e3).toISOString(), reviewed_at: new Date(Date.now() - 3600e3).toISOString() },
  { id: 1, discord_name: "Bob", exchange: "Bybit", exchange_uid: "12345678", status: "rejected", auto: true, reviewed_by: "Bybit 自動確認", created_at: new Date(Date.now() - 86400e3).toISOString(), reviewed_at: new Date(Date.now() - 86400e3).toISOString() },
];
const vols = new Map(); // `${user_id}:${month}` → {amounts, updated_at, updated_by}
const monthNow = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const qualified = (a) => isQualified(a, threshold);
const TODAY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const twDate = (ts) => new Date(new Date(ts).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const unlockOn = courseUnlockDate;
function linkOf(userId) { return Object.fromEntries(AUTO_EXCHANGES.filter((ex) => autoLinks[ex].has(userId)).map((ex) => [ex, autoLinks[ex].get(userId)])); }
function autoSyncUser(ex, userId) {
  const uid = autoLinks[ex].get(userId); if (!uid) return 0;
  const month = monthNow(); const key = userId + ":" + month; const prev = vols.get(key);
  const amounts = { ...(prev?.amounts || {}), [ex]: INVITED[ex][uid] || 0 };
  const yesterday = addDays(TODAY(), -1);
  const ok = qualified(amounts); const qOn = ex === "Bybit" ? (yesterday.startsWith(month) ? yesterday : month + "-01") : month + "-10";
  vols.set(key, { amounts, qualified_at: ok ? prev?.qualified_at || qOn : null, updated_at: new Date().toISOString(), updated_by: `${ex} 自動同步` });
  const m = members.find((x) => x.user_id === userId);
  if (ok && !prev?.qualified_at && m?.access_until && m.access_until < cycleEnd(qOn)) { m.access_until = cycleEnd(qOn); return 1; }
  return 0;
}
function volSnap(month) {
  return { month, monthEnd: monthEnd(month), exchanges: EX, autoExchanges: AUTO_EXCHANGES, threshold, rows: [...members].reverse().map((m) => { const v = vols.get(m.user_id + ":" + month); return { user_id: m.user_id, email: m.email, banned: m.banned, access_until: m.access_until, note: m.note, amounts: v?.amounts || {}, updated_at: v?.updated_at || null, updated_by: v?.updated_by || null, qualified: v ? qualified(v.amounts) : false, qualified_at: v?.qualified_at || null, qualified_until: v?.qualified_at ? cycleEnd(v.qualified_at) : null, links: linkOf(m.user_id) }; }) };
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
const isMember = (u) => u && (u.email === ADMIN || members.some((m) => m.user_id === u.id && !m.banned));
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
      inv.used_count++;
      const id = crypto.randomUUID();
      users[body.email] = { id, password: body.password };
      members.unshift({ user_id: id, email: body.email, invite_code: inv.code, banned: false, created_at: new Date().toISOString(), last_sign_in_at: null, watched_count: 0, access_until: cycleEnd(TODAY()), notify: true });
      return send(res, 200, { ok: true });
    }
    if (p === "/api/stats") {
      const pub = videos.filter((v) => v.is_published && !v.course_host).sort((a, b) => String(b.published_at).localeCompare(a.published_at));
      return send(res, 200, { latest: pub[0]?.published_at || null, count: pub.length });
    }
    if (!u) return send(res, 401, { error: "請先登入" });
    const admin = u.email === ADMIN;
    if (!admin && !isMember(u)) return send(res, 403, { error: "這個帳號目前沒有觀看權限，請聯絡管理員" });

    const mrow = members.find((m) => m.user_id === u.id);
    if (mrow?.access_until && mrow.access_until < d(0)) return send(res, 403, { error: `你的觀看資格到 ${mrow.access_until} 為止，請聯絡管理員更新`, code: "expired" });
    if (p === "/api/me") {
      if (req.method === "PATCH") {
        mrow.notify = body.notify;
        return send(res, 200, { ok: true, notify: body.notify });
      }
      return send(res, 200, { links: mrow ? AUTO_EXCHANGES.map((ex) => ({ exchange: ex, enabled: true, uid: autoLinks[ex].get(mrow.user_id) || null, boundAt: null })) : null, feedbackUnread: feedback.filter((x) => x.user_id === u.id && x.seen_reply === false).length, email: u.email, isAdmin: admin, accessUntil: mrow?.access_until || null, notify: mrow ? mrow.notify !== false : null, volume: mrow ? (() => { const v = vols.get(mrow.user_id + ":" + monthNow()); return { month: monthNow(), exchanges: EX, threshold, amounts: v?.amounts || null, updatedAt: v?.updated_at || null, qualified: v ? qualified(v.amounts) : false, qualifiedAt: v?.qualified_at || null, qualifiedUntil: v?.qualified_at ? cycleEnd(v.qualified_at) : null }; })() : null });
    }
    if (p === "/api/exchange-link") {
      const mrow = members.find((m) => m.user_id === u.id);
      if (!mrow) return send(res, 400, { error: "管理員帳號不用綁定交易所" });
      if (req.method === "GET") return send(res, 200, { links: Object.entries(linkOf(u.id)).map(([exchange, exchange_uid]) => ({ exchange, exchange_uid })), enabled: Object.fromEntries(AUTO_EXCHANGES.map((ex) => [ex, true])) });
      const ex = req.method === "DELETE" ? url.searchParams.get("exchange") : body.exchange;
      if (!AUTO_EXCHANGES.includes(ex)) return send(res, 400, { error: "不支援這間交易所" });
      if (req.method === "DELETE") { autoLinks[ex].delete(u.id); return send(res, 200, { ok: true }); }
      const uid = String(body.uid || "");
      if (!/^\d{5,15}$/.test(uid)) return send(res, 400, { error: "UID 是一串數字，請再確認一次" });
      if ([...autoLinks[ex]].some(([k, v]) => v === uid && k !== u.id)) return send(res, 409, { error: "這個 UID 已經被其他研究員綁定了，有問題請聯絡管理員" });
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
        videos: videos.filter((v) => v.is_published && !v.course_host).map((v) => {
          const pr = progress.get(`${u.id}:${v.id}`);
          return { id: v.id, title: v.title, description: v.description, published_at: v.published_at, duration_sec: v.duration_sec, thumb_url: thumbUrl(v), position_sec: pr?.position_sec || 0, watched_at: pr?.updated_at || null, attachment_count: v.attachments.length, hosts: v.hosts || [], chapters: v.chapters || [] };
        }),
      });
    }
    if (p === "/api/videos") {
      const v = videos.find((x) => x.id === Number(url.searchParams.get("id")));
      if (!v || (!v.is_published && !admin)) return send(res, 404, { error: "找不到這支影片" });
      if (v.course_host && !admin) { const un = unlockOn(twDate(mrow.created_at), v.course_host, v.course_part); if (un > TODAY()) return send(res, 403, { error: `這一份課程 ${un} 解鎖`, code: "locked", unlock_on: un }); }
      const pr = progress.get(`${u.id}:${v.id}`);
      return send(res, 200, { id: v.id, title: v.title, description: v.description, published_at: v.published_at, duration_sec: v.duration_sec, is_published: v.is_published, thumb_url: thumbUrl(v), hosts: v.hosts || [], chapters: v.chapters || [], course_host: v.course_host || null, course_part: v.course_part || null, url: "/media/" + (process.env.VIDEO || "live.webm") + "?sig=" + Date.now(), position_sec: pr?.position_sec || 0, attachments: v.attachments.map((a) => ({ ...a, url: "/media/thumb5.jpg?dl=1" })) });
    }
    if (p === "/api/course") {
      const start = mrow ? twDate(mrow.created_at) : TODAY();
      const slots = [];
      for (let part = 1; part <= 6; part++) for (const h of CH) {
        const un = unlockOn(start, h, part); const unlocked = !mrow || un <= TODAY();
        const v = videos.find((x) => x.is_published && x.course_host === h && x.course_part === part);
        const pr = v && progress.get(`${u.id}:${v.id}`);
        slots.push({ host: h, part, week: (part - 1) * 4 + CH.indexOf(h) + 1, unlock_on: un, unlocked,
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

    if (p === "/api/admin/videos") {
      if (req.method === "GET") return send(res, 200, { videos: videos.map((v) => ({ ...v, thumb_url: thumbUrl(v) })) });
      if (req.method === "POST") {
        const v = { id: nextId++, title: body.title, description: null, published_at: body.published_at, is_published: false, duration_sec: body.duration_sec, size_bytes: body.size_bytes, thumb: null, thumbKey: body.thumb_key, attachments: [] };
        videos.unshift(v);
        return send(res, 200, { id: v.id });
      }
      if (req.method === "PATCH") {
        const v = videos.find((x) => x.id === body.id);
        for (const k of ["description", "published_at", "is_published", "hosts", "chapters", "course_host", "course_part"]) if (body[k] !== undefined) v[k] = body[k];
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
        const inv = { code: "NEW4-C0DE", max_uses: body.max_uses, used_count: 0, note: body.note || null, disabled: false, created_at: new Date().toISOString() };
        invites.unshift(inv);
        return send(res, 200, { invite: inv });
      }
      if (req.method === "DELETE") {
        const code = url.searchParams.get("code");
        if (discordSettings.labCode === code) return send(res, 409, { error: "這組放在 Discord 的實驗室頻道，請先到「Discord 審核」換一組再刪" });
        const i = invites.findIndex((x) => x.code === code);
        if (i < 0) return send(res, 404, { error: "找不到這組實驗室密碼" });
        invites.splice(i, 1);
        return send(res, 200, { ok: true });
      }
      const inv = invites.find((i) => i.code === body.code);
      inv.disabled = body.disabled;
      return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/discord") {
      if (req.method === "GET") return send(res, 200, { configured: true, settings: discordSettings, applications: discordApps, inviteUrl: "https://discord.com/oauth2/authorize?client_id=111111111111111111&scope=bot&permissions=268528656", suggestCode: "K7QM-2XPA" });
      if (req.method === "PATCH") {
        for (const k of ["roleId", "panelChannelId", "reviewChannelId"]) {
          if (body[k] === undefined) continue;
          const v = String(body[k] || "").trim();
          if (v && !/^\d{17,20}$/.test(v)) return send(res, 400, { error: "ID 是 17–20 位數字，請在 Discord 對頻道或身分組按右鍵「複製 ID」" });
          discordSettings[k] = v;
        }
        if (body.invites) discordSettings.invites = body.invites;
        return send(res, 200, { ok: true, settings: discordSettings });
      }
      if (body.action === "setup") {
        if (body.code && !invites.some((x) => x.code === body.code && !x.disabled)) return send(res, 400, { error: "找不到這組實驗室密碼，或已經停用" });
        const created = discordSettings.labChannelId ? [] : ["🧪 CCC 交易實驗室", "📝申請加入實驗室", "🔒申請審核", "🧪實驗室"];
        Object.assign(discordSettings, { guildId: "222222222222222222", categoryId: "800000000000000001", panelChannelId: "800000000000000002", reviewChannelId: "800000000000000003", labChannelId: "800000000000000004", labCode: body.code || discordSettings.labCode });
        return send(res, 200, { ok: true, guildName: "CCC 交易實驗室", hierarchyOk: false, roleName: "實驗室研究員", created, pinned: true, settings: discordSettings });
      }
      if (!discordSettings.panelChannelId) return send(res, 400, { error: "先填申請頻道的 ID" });
      discordPanels++;
      return send(res, 200, { ok: true, messageId: "900000000000000001" });
    }
    if (p === "/api/admin/sync") {
      const overview = () => Object.fromEntries(AUTO_EXCHANGES.map((ex) => [ex, { configured: true, linked: autoLinks[ex].size, last: syncLast[ex] || null }]));
      if (req.method === "GET") return send(res, 200, { exchanges: overview() });
      for (const ex of body.exchange ? [body.exchange] : AUTO_EXCHANGES) {
        let extended = 0; for (const id of autoLinks[ex].keys()) extended += autoSyncUser(ex, id);
        syncLast[ex] = { at: new Date().toISOString(), ok: true, months: [{ month: monthNow(), users: autoLinks[ex].size, saved: autoLinks[ex].size, extended }] };
      }
      return send(res, 200, { ok: true, exchanges: overview() });
    }
    if (p === "/api/admin/volumes") {
      if (req.method === "GET") return send(res, 200, volSnap(url.searchParams.get("month") || monthNow()));
      if (req.method === "PATCH") { threshold = Math.round(Number(body.threshold)); return send(res, 200, { ok: true, threshold }); }
      const qOn = body.qualifiedOn || TODAY(); let saved = 0, extended = 0;
      for (const r of body.rows || []) {
        const m = members.find((x) => x.user_id === r.userId); if (!m) continue;
        const amounts = {}; for (const e of EX) if (!AUTO_EXCHANGES.includes(e) && r.amounts?.[e] != null && r.amounts[e] !== "") amounts[e] = Math.round(Number(r.amounts[e]) * 100) / 100;
        const prevRow = vols.get(m.user_id + ":" + body.month);
        for (const e of AUTO_EXCHANGES) if (prevRow?.amounts?.[e] != null) amounts[e] = prevRow.amounts[e];
        const prevQ = prevRow?.qualified_at || null;
        const ok = qualified(amounts);
        vols.set(m.user_id + ":" + body.month, { amounts, qualified_at: ok ? prevQ || qOn : null, updated_at: new Date().toISOString(), updated_by: u.email }); saved++;
        if (ok && !prevQ && m.access_until && m.access_until < cycleEnd(qOn)) { m.access_until = cycleEnd(qOn); extended++; }
      }
      return send(res, 200, { ...volSnap(body.month), saved, extended, until: cycleEnd(qOn) });
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
    if (p === "/api/admin/followup") {
      const today = TODAY(); const out = [];
      for (const m of members) {
        if (m.banned) continue;
        const reasons = []; const prog = [...progress.entries()].filter(([k]) => k.startsWith(m.user_id + ":")).map(([k, v]) => ({ video_id: Number(k.split(":")[1]), ...v }));
        if (m.access_until && m.access_until < today) reasons.push({ key: "expired", label: `已過期（${m.access_until.slice(5)}）`, level: 3 });
        else if (m.access_until && m.access_until <= addDays(today, 7)) reasons.push({ key: "expiring", label: `${m.access_until.slice(5).replace("-", "/")} 到期`, level: 2 });
        const vv = vols.get(m.user_id + ":" + monthNow());
        if (m.access_until && !(vv && qualified(vv.amounts))) reasons.push({ key: "volume", label: vv ? "這個月還差一點" : "這個月還沒有交易量", level: 1 });
        const last = prog.map((x) => x.updated_at).sort().pop() || null;
        const away = last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : null;
        if (!last) reasons.push({ key: "inactive", label: "加入後還沒看過影片", level: 2 }); else if (away >= 14) reasons.push({ key: "inactive", label: `${away} 天沒來看`, level: 1 });
        const q = feedback.filter((x) => x.user_id === m.user_id && x.status === "open").length;
        if (q) reasons.push({ key: "feedback", label: `${q} 則提問還沒回`, level: 2 });
        out.push({ user_id: m.user_id, email: m.email, access_until: m.access_until, note: m.note, joined: twDate(m.created_at), last_watched_at: last, watched: prog.length, completed: 0, course: { unlocked: 3, behind: 1 }, reasons, score: reasons.reduce((a, r) => a + r.level, 0) });
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
      if (req.method === "GET") return send(res, 200, { members });
      const m = members.find((x) => x.user_id === body.userId);
      if (body.action === "reset") return send(res, 200, { password: "Tq8mWz3kPa7c" });
      if (body.action === "access") {
        if (body.accessUntil !== undefined) m.access_until = body.accessUntil;
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
