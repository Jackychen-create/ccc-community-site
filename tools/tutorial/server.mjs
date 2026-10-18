// 錄教學影片用的示範伺服器（假資料）：提供 public/ 靜態檔，並模擬 /api 與 Supabase Auth、R2。只在本機測試用。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EXCHANGES, AUTO_EXCHANGES, tierOf, periodOf, nextPeriod, prevPeriod, needsName, cleanExId, cleanAccountName } from "../../public/assets/js/shared/rules.js";

const PORT = Number(process.env.PORT || 4321);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, "..", "..");
const PUB = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "public");
const FONTS = path.join(ROOT, "tests", "node_modules", "@fontsource");
const MEDIA = path.join(HERE, "media");
const NOW_MONTH = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
// 跟正式環境一樣的 CSP（讀 Cloudflare 的 _headers）
const CSP = fs.readFileSync(path.join(PUB, "_headers"), "utf8").match(/Content-Security-Policy:\s*(.+)/)[1].trim();

const ADMIN = "ccc@example.com";
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const users = { "ccc@example.com": { id: uid(1), password: "password1" }, "member@example.com": { id: uid(2), password: "password1" } };
const tokens = new Map();
const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const MEND = (() => { const t = new Date(Date.now() + 8 * 3600e3); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); })();
let nextId = 10;
const m = (mm, ss = 0) => mm * 60 + ss;
const videos = [
  { id: 6, hosts: ["CCC", "OC"], thumb: "t1.jpg", title: "本週盤勢與紀律檢討", description: "回顧這週每一筆的進場理由與違規，重點放在追單之後怎麼處理。", published_at: d(1), is_published: true, duration_sec: 3720, size_bytes: 1620000000,
    chapters: [{ t: 0, title: "開場" }, { t: m(4, 30), title: "本週盤勢回顧" }, { t: m(18, 20), title: "違規單檢討" }, { t: m(35, 10), title: "追單之後怎麼處理" }, { t: m(49, 40), title: "Q&A" }],
    attachments: [{ id: 1, title: "10-9 盤勢整理.pdf", size_bytes: 1830000 }, { id: 2, title: "交易紀錄範本.xlsx", size_bytes: 42000 }] },
  { id: 5, hosts: ["OC"], thumb: "t2.jpg", title: "NQ 開盤區間怎麼看", description: "開盤 30 分鐘的區間判斷，和兩個最常見的假突破。", published_at: d(8), is_published: true, duration_sec: 3482, size_bytes: 1500000000,
    chapters: [{ t: 0, title: "開場" }, { t: m(6, 10), title: "開盤 30 分鐘區間" }, { t: m(22, 45), title: "假突破的兩個特徵" }, { t: m(41), title: "實盤回放" }], attachments: [{ id: 4, title: "開盤區間筆記.pdf", size_bytes: 760000 }] },
  { id: 4, hosts: ["X"], thumb: "t3.jpg", title: "停損設在哪裡", description: "結構停損、波動停損、時間停損，各自適合什麼情況。", published_at: d(15), is_published: true, duration_sec: 3355, size_bytes: 1400000000,
    chapters: [{ t: 0, title: "結構停損" }, { t: m(15), title: "波動停損" }, { t: m(31, 30), title: "時間停損" }, { t: m(47), title: "Q&A" }], attachments: [{ id: 3, title: "停損講義.pdf", size_bytes: 920000 }] },
  { id: 3, hosts: ["CCC", "X", "OC"], thumb: "t4.jpg", title: "研究員 Q&A", description: "這個月大家問最多的十個問題。", published_at: d(22), is_published: true, duration_sec: 3610, size_bytes: 1580000000, attachments: [] },
  { id: 2, hosts: ["CCC"], thumb: "t5.jpg", title: "資金控管：每筆風險怎麼抓", description: "每筆風險怎麼設定，連續虧損時怎麼調整部位。", published_at: d(29), is_published: true, duration_sec: 3290, size_bytes: 1390000000, attachments: [{ id: 5, title: "部位計算表.xlsx", size_bytes: 38000 }] },
  { id: 1, hosts: ["X"], thumb: "t6.jpg", title: "交易日誌怎麼寫", description: "每天收盤後 10 分鐘，記下什麼最有用。", published_at: d(36), is_published: true, duration_sec: 3150, size_bytes: 1300000000, attachments: [] },
];
videos.push(
  { id: 30, course_host: "CCC", course_part: 1, hosts: ["CCC"], thumb: "c1.jpg", title: "交易計畫怎麼寫", description: "進場前先寫下理由、停損和出場條件。", published_at: d(40), is_published: true, duration_sec: 1840, size_bytes: 800000000, chapters: [{ t: 0, title: "為什麼要寫計畫" }, { t: m(9), title: "計畫表範例" }], attachments: [{ id: 31, title: "交易計畫表.pdf", size_bytes: 320000 }] },
  { id: 32, course_host: "X", course_part: 1, hosts: ["X"], thumb: "c2.jpg", title: "看懂市場結構", description: "高低點、趨勢和盤整怎麼分。", published_at: d(40), is_published: true, duration_sec: 2210, size_bytes: 900000000, attachments: [] },
  { id: 33, course_host: "OC", course_part: 1, hosts: ["OC"], thumb: "c3.jpg", title: "開盤前的準備", description: "開盤前 15 分鐘要看的四件事。", published_at: d(40), is_published: true, duration_sec: 1675, size_bytes: 700000000, attachments: [] },
  { id: 34, course_host: "CCC", course_part: 2, hosts: ["CCC"], thumb: "c4.jpg", title: "部位大小怎麼算", description: "用每筆風險反推口數。", published_at: d(40), is_published: true, duration_sec: 1990, size_bytes: 800000000, attachments: [] },
  { id: 35, course_host: "X", course_part: 2, hosts: ["X"], thumb: "c5.jpg", title: "流動性與假突破", description: null, published_at: d(40), is_published: true, duration_sec: 2105, size_bytes: 800000000, attachments: [] },
);
const progress = new Map([
  [`${uid(2)}:30`, { position_sec: 1840, duration_sec: 1840, updated_at: ago(300) }],
  [`${uid(2)}:32`, { position_sec: 1200, duration_sec: 2210, updated_at: ago(100) }],
  [`${uid(2)}:5`, { position_sec: m(23, 40), duration_sec: 3482, updated_at: ago(20) }],
  [`${uid(2)}:4`, { position_sec: 3355, duration_sec: 3355, updated_at: ago(70) }],
  [`${uid(2)}:3`, { position_sec: 3610, duration_sec: 3610, updated_at: ago(200) }],
]);
const invites = [
  { code: "K7QM-2XPA", max_uses: 30, used_count: 8, note: "第一批研究員", disabled: false, created_at: ago(24 * 20) },
  { code: "HW3N-8RTE", max_uses: 5, used_count: 5, note: "UM 合作", disabled: false, created_at: ago(24 * 10) },
];
const DEMO = [["member@example.com", 2, 3, MEND], ["trader.lin@example.com", 3, 5, MEND], ["wang.k@example.com", 4, 2, MEND], ["chen.yu@example.com", 5, 6, MEND],
  ["jay.h@example.com", 6, 1, d(-3)], ["mei.c@example.com", 7, 4, MEND], ["alex.t@example.com", 8, 0, d(5)], ["kevin.l@example.com", 9, 2, d(-12)]];
const members = DEMO.map(([email, n, w, until], i) => ({ user_id: uid(n), email, invite_code: "K7QM-2XPA", banned: false, created_at: ago(24 * (30 - i * 3)), last_sign_in_at: ago(i * 7 + 1), watched_count: w, access_until: until, note: null, notify: true })).reverse();
const r2 = new Map();
const notes = [
  { id: 1, user_id: uid(2), video_id: 5, t: m(8, 12), body: "開盤區間：先等 30 分鐘再畫高低點", created_at: ago(20) },
  { id: 2, user_id: uid(2), video_id: 4, t: m(16, 5), body: "波動停損 = 1.5 倍 ATR，不要拉太近", created_at: ago(70) },
];
let noteId = 3;
const log = [];
const feedback = [];
let fbId = 1;
const clientErrors = [];
// 示範資料：本週盤勢（id 6，62 分鐘）的觀看分段；41 分（實盤回放）附近重看多，18–20 分很多人離開
{
  const rnd = (() => { let x = 11; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); })();
  const stopsAt = [2400, 1150, 3720, 1180, 3720, 2950, 3720, 610];
  [2, 3, 4, 5, 6, 7, 8, 9].forEach((n, i) => {
    const end = stopsAt[i]; const bk = {};
    for (let b = 0; b * 30 < end; b++) { if (rnd() < 0.08 && b > 6) continue; bk[b] = 1 + (b >= 80 && b <= 86 && rnd() < 0.8 ? 1 + Math.floor(rnd() * 2) : 0) + (b >= 36 && b <= 40 && rnd() < 0.3 ? 1 : 0); }
    progress.set(`${uid(n)}:6`, { position_sec: Math.min(end, 3720), duration_sec: 3720, updated_at: ago(n === 2 ? 48 : 5 + i * 9), buckets: bk });
  });
  feedback.push(
    { id: fbId++, user_id: uid(3), email: "trader.lin@example.com", video_id: 6, t: 2475, kind: "question", body: "實盤回放 41 分那筆，為什麼不在第一次回測就進？", status: "open", reply: null, replied_by: null, replied_at: null, seen_reply: true, created_at: ago(3) },
    { id: fbId++, user_id: uid(5), email: "chen.yu@example.com", video_id: 6, t: 1130, kind: "question", body: "違規單那段講太快了，追單之後的停損要怎麼重設可以再講一次嗎", status: "open", reply: null, replied_by: null, replied_at: null, seen_reply: true, created_at: ago(20) },
    { id: fbId++, user_id: uid(8), email: "alex.t@example.com", video_id: 5, t: null, kind: "problem", body: "手機看到一半會卡住要重新整理", status: "open", reply: null, replied_by: null, replied_at: null, seen_reply: true, created_at: ago(30) },
  );
  const E = (email, kind, message, context, h) => clientErrors.push({ email, kind, message, context, created_at: ago(h) });
  E("alex.t@example.com", "video", "播放失敗（錯誤碼 2）", { video: 5, title: "NQ 開盤區間怎麼看", path: "/#/v/5", ua: "iPhone Safari" }, 30);
  E("kevin.l@example.com", "video", "播放失敗（錯誤碼 2）", { video: 5, title: "NQ 開盤區間怎麼看", path: "/#/v/5", ua: "iPhone Safari" }, 50);
  E("alex.t@example.com", "video", "播放失敗（錯誤碼 2）", { video: 5, title: "NQ 開盤區間怎麼看", path: "/#/v/5", ua: "iPhone Safari" }, 26);
  E("mei.c@example.com", "api", "GET /api/videos → 連線失敗", { path: "/#/" , ua: "Windows Chrome" }, 70);
  for (const [q, n] of [["布林通道", 4], ["ICT", 3], ["資金費率", 2], ["期權", 1]]) for (let i = 0; i < n; i++) E(["wang.k@example.com", "jay.h@example.com", "mei.c@example.com"][i % 3], "search_empty", q, { q }, 10 + i * 7);
}
const EX = EXCHANGES;
let threshold = 1000000;
// 每人一輪：從加入那天（台灣日期）起算一個月；vols 用 `${user_id}:${這一輪第一天}` 存
const twDay = (ts) => new Date(new Date(ts).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const anchorOf = (mm) => twDay(mm.created_at);
const curP = (mm) => periodOf(anchorOf(mm), new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
const periodFor = (mm, which) => (which === "previous" ? prevPeriod(anchorOf(mm), curP(mm)) : curP(mm));
const vols = new Map();
for (const [n, a, by] of [[2, { OKX: 850000, Bybit: 1260000 }, "x"], [3, { OKX: 1120000 }, "oc"], [4, { UM: 12 }, "oc"], [5, { Bybit: 1460000, UM: 4 }, "x"], [7, { OKX: 1510000 }, "x"], [8, { Bybit: 450000 }, "x"]]) {
  const mm = members.find((x) => x.user_id === uid(n)); if (!mm) continue;
  vols.set(`${uid(n)}:${curP(mm).start}`, { amounts: a, updated_at: ago(30 + n), updated_by: by + "@example.com" });
}
// 研究員填的交易所 UID（UM 是 MT5 帳號＋開戶英文姓名）
const links = new Map(); // user_id → { ex: { uid, name } }
for (const [n, ex, id, name] of [[2, "Bybit", "594320471"], [3, "OKX", "701045615417133677"], [4, "UM", "35908033", "TSAI TZU HSU"], [5, "Bybit", "594325795"], [7, "OKX", "884811020408438914"], [8, "BingX", "39104531"]])
  links.set(uid(n), { ...(links.get(uid(n)) || {}), [ex]: { uid: id, name: name || null } });
const linkOf = (id) => Object.fromEntries(Object.entries(links.get(id) || {}).map(([ex, l]) => [ex, l.name ? `${l.uid}・${l.name}` : l.uid]));
const monthNow = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const qualified = (a) => tierOf(a) >= 2; // 三級制度：第二級才看得到網站（示範用）
const TODAY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const addDays = (date, n) => { const x = new Date(date + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const cycleEnd = (date) => { const [y, m, dd] = date.split("-").map(Number); const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return addDays(new Date(Date.UTC(y, m, Math.min(dd, last))).toISOString().slice(0, 10), -1); };
const twDate = (ts) => new Date(new Date(ts).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
const CH = ["CCC", "OC", "X"];
const unlockOn = (start, h, part) => addDays(start, ((part - 1) * 4 + CH.indexOf(h)) * 7);
function volSnap(which) {
  return { which, today: TODAY(), exchanges: EX, autoExchanges: AUTO_EXCHANGES, threshold, rows: [...members].reverse().map((mm) => ({ mm, p: periodFor(mm, which) })).filter((x) => x.p).map(({ mm, p }) => { const v = vols.get(mm.user_id + ":" + p.start); return { user_id: mm.user_id, email: mm.email, banned: mm.banned, access_until: mm.access_until, note: mm.note, period_start: p.start, period_end: p.end, next_end: nextPeriod(anchorOf(mm), p).end, amounts: v?.amounts || {}, updated_at: v?.updated_at || null, updated_by: v?.updated_by || null, qualified: v ? qualified(v.amounts) : false, qualified_at: v?.qualified_at || null, links: linkOf(mm.user_id) }; }) };
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
      if (false) return send(res, 400, { error_code: "user_banned", msg: "User is banned" });
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
      r2.set(p.slice(4), { size: buf.length, type: req.headers["content-type"], buf });
      return send(res, 200);
    }
    const f = r2.get(p.slice(4));
    if (!f) return send(res, 404);
    res.writeHead(200, { "Content-Type": f.type });
    return res.end(f.buf);
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
      if (EX.includes(body.exchange) && body.uid) links.set(id, { [body.exchange]: { uid: cleanExId(body.exchange, body.uid), name: needsName(body.exchange) ? cleanAccountName(body.accountName) : null } });
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
      const mine = mrow ? links.get(mrow.user_id) || {} : {};
      const volume = mrow ? (() => { const pp = curP(mrow); const v = vols.get(mrow.user_id + ":" + pp.start); return { periodStart: pp.start, periodEnd: pp.end, exchanges: EX, threshold, amounts: v?.amounts || null, updatedAt: v?.updated_at || null, qualified: v ? qualified(v.amounts) : false, qualifiedAt: v?.qualified_at || null, qualifiedUntil: v?.qualified_at ? nextPeriod(anchorOf(mrow), pp).end : null }; })() : null;
      return send(res, 200, { feedbackUnread: feedback.filter((x) => x.user_id === u.id && x.seen_reply === false).length, email: u.email, isAdmin: admin, adminRole: admin ? "owner" : null, accessUntil: mrow?.access_until || null, notify: mrow ? mrow.notify !== false : null, nextLive: null, volume,
        links: mrow ? EX.map((ex) => ({ exchange: ex, auto: AUTO_EXCHANGES.includes(ex), enabled: true, uid: mine[ex]?.uid || null, accountName: mine[ex]?.name || null, needsName: needsName(ex), boundAt: null })) : null });
    }
    if (p === "/api/exchange-link") {
      if (!mrow) return send(res, 400, { error: "管理員帳號不用綁定交易所" });
      const ex = req.method === "DELETE" ? url.searchParams.get("exchange") : body.exchange;
      const cur = { ...(links.get(mrow.user_id) || {}) };
      if (req.method === "DELETE") { delete cur[ex]; links.set(mrow.user_id, cur); return send(res, 200, { ok: true }); }
      cur[ex] = { uid: cleanExId(ex, body.uid), name: needsName(ex) ? cleanAccountName(body.accountName) : null };
      links.set(mrow.user_id, cur);
      return send(res, 200, { ok: true, exchange: ex, uid: cur[ex].uid, synced: AUTO_EXCHANGES.includes(ex) });
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
      return send(res, 200, { id: v.id, title: v.title, description: v.description, published_at: v.published_at, duration_sec: v.duration_sec, is_published: v.is_published, hosts: v.hosts || [], chapters: v.chapters || [], course_host: v.course_host || null, course_part: v.course_part || null, url: "/media/" + "live.webm" + "?sig=" + Date.now(), position_sec: pr?.position_sec || 0, attachments: v.attachments.map((a) => ({ ...a, url: "/media/thumb5.jpg?dl=1" })) });
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
        const inv = { code: "R8TW-5JQN", max_uses: body.max_uses, used_count: 0, note: body.note || null, disabled: false, created_at: new Date().toISOString() };
        invites.unshift(inv);
        return send(res, 200, { invite: inv });
      }
      const inv = invites.find((i) => i.code === body.code);
      inv.disabled = body.disabled;
      return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/sync") {
      const overview = { Bybit: { configured: true, linked: 2, last: { at: ago(3), ok: true, users: 2, saved: 2, extended: 0 } }, BingX: { configured: true, linked: 1, last: { at: ago(3), ok: true, users: 1, saved: 1, extended: 0 } } };
      return send(res, 200, req.method === "GET" ? { exchanges: overview } : { ok: true, exchanges: overview });
    }
    if (p === "/api/admin/volumes") {
      const which = (req.method === "GET" ? url.searchParams.get("which") : body.which) === "previous" ? "previous" : "current";
      if (req.method === "GET") return send(res, 200, volSnap(which));
      if (req.method === "PATCH") { threshold = Math.round(Number(body.threshold)); return send(res, 200, { ok: true, threshold }); }
      let saved = 0, extended = 0;
      for (const r of body.rows || []) {
        const mm = members.find((x) => x.user_id === r.userId); if (!mm) continue;
        const pp = periodFor(mm, which); if (!pp) continue;
        let qOn = body.qualifiedOn || TODAY(); if (qOn < pp.start) qOn = pp.start; if (qOn > pp.end) qOn = pp.end;
        const prevRow = vols.get(mm.user_id + ":" + pp.start);
        const amounts = {}; for (const e of EX) if (!AUTO_EXCHANGES.includes(e) && r.amounts?.[e] != null && r.amounts[e] !== "") amounts[e] = Math.round(Number(r.amounts[e]) * 100) / 100;
        for (const e of AUTO_EXCHANGES) if (prevRow?.amounts?.[e] != null) amounts[e] = prevRow.amounts[e];
        const prevQ = prevRow?.qualified_at || null;
        const ok = qualified(amounts);
        vols.set(mm.user_id + ":" + pp.start, { amounts, qualified_at: ok ? prevQ || qOn : null, updated_at: new Date().toISOString(), updated_by: u.email }); saved++;
        const until = nextPeriod(anchorOf(mm), pp).end;
        if (ok && !prevQ && mm.access_until && mm.access_until < until) { mm.access_until = until; extended++; }
      }
      return send(res, 200, { ...volSnap(which), saved, extended });
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
        const vv = vols.get(m.user_id + ":" + curP(m).start);
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
      if (req.method === "GET") return send(res, 200, { members: members.map((mm) => ({ ...mm, uids: Object.fromEntries(Object.entries(links.get(mm.user_id) || {}).map(([ex, l]) => [ex, l.uid])), account_names: Object.fromEntries(Object.entries(links.get(mm.user_id) || {}).filter(([, l]) => l.name).map(([ex, l]) => [ex, l.name])) })) });
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
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Content-Security-Policy": CSP });
  fs.createReadStream(full).pipe(res);
});
server.listen(PORT, () => console.log("mock on " + PORT));
