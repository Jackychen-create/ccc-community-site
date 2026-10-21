// 直播精華、研究員等級卡：不用瀏覽器的測試（假的 Supabase、假的 Discord、假的 Workers AI）
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv, env } from "../server/lib/env.js";
import handler from "../server/cron/highlights.js";
import { parseWhisper, transcriptOf, fitTranscript, cleanSummary, parseJsonLoose, textOf, pickJob, highlightEmbed, summaryPrompt, mmss } from "../server/lib/highlights.js";
import { verifyGithubOidc, resetOidcCache, OIDC } from "../server/lib/oidc.js";
import { levelCard } from "../server/share.js";
import { mix, emblemSvg } from "../public/assets/js/member/sharecard.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e?.stack || e).split("\n").slice(0, 4).join("\n  ")); }
}
const listen = (s) => new Promise((ok) => s.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${s.address().port}`)));
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : null); } catch { r(null); } }); });

// ── 純函式 ──
await test("whisper 結果：segments 加上這一段的起點、去掉亂補的字幕", () => {
  const s = parseWhisper({ segments: [{ start: 1.23, end: 4.5, text: " 大家好 " }, { start: 5, end: 6, text: "字幕由某某提供" }, { start: 7, end: 9, text: "今天講 BTC" }] }, 600);
  assert.deepEqual(s, [{ s: 601.2, e: 604.5, t: "大家好" }, { s: 607, e: 609, t: "今天講 BTC" }]);
});
await test("whisper 結果：只有 vtt 也讀得懂", () => {
  const s = parseWhisper({ segments: [{ vtt: "00:01.000 --> 00:03.500\n開盤了\n\n01:02.000 --> 01:04.000\n停損設這裡" }] }, 0);
  assert.deepEqual(s.map((x) => [x.s, x.t]), [[1, "開盤了"], [62, "停損設這裡"]]);
});
await test("逐字稿：短句合成一行、照段落順序、時間格式", () => {
  const t = transcriptOf({ 1: [{ s: 600, e: 603, t: "第二段" }], 0: [{ s: 0, e: 2, t: "大家好" }, { s: 3, e: 5, t: "今天看台積電" }, { s: 40, e: 42, t: "接著看 BTC" }] });
  assert.equal(t, "[0:00] 大家好，今天看台積電\n[0:40] 接著看 BTC\n[10:00] 第二段");
  assert.equal(mmss(3725), "1:02:05");
});
await test("逐字稿太長：平均取樣到上限內", () => {
  const long = Array.from({ length: 3000 }, (_, i) => `[${i}:00] ${"字".repeat(40)}`).join("\n");
  assert.ok(fitTranscript(long, 45000).length <= 45000);
});
await test("AI 回的各種格式都拿得到文字、JSON 前後有廢話也讀得懂", () => {
  assert.equal(textOf({ response: "a" }), "a");
  assert.equal(textOf({ output: [{ type: "reasoning", content: [{ text: "想一下" }] }, { type: "message", content: [{ type: "output_text", text: "b" }] }] }), "b");
  assert.equal(textOf({ choices: [{ message: { content: "c" } }] }), "c");
  assert.deepEqual(parseJsonLoose('好的：```json\n{"summary":"x"}\n```'), { summary: "x" });
  assert.equal(parseJsonLoose("沒有 JSON"), null);
});
await test("整理結果：限制長度、章節排序去重、第一章從 0、不能超過影片長度、時間可以是 mm:ss", () => {
  const r = cleanSummary({ summary: "摘要", points: ["一", { text: "二" }, ""], tickers: [{ name: "BTC", note: "看多" }, { note: "沒名字" }], chapters: [{ t: "05:00", title: "第二章" }, { t: 30, title: "開場" }, { t: 30, title: "重複" }, { t: 99999, title: "超過" }] }, 3600);
  assert.deepEqual(r.points, ["一", "二"]);
  assert.deepEqual(r.tickers, [{ name: "BTC", note: "看多" }]);
  assert.deepEqual(r.chapters, [{ t: 0, title: "開場" }, { t: 300, title: "第二章" }]);
  assert.equal(cleanSummary({ points: ["沒有摘要"] }), null);
});
await test("提示詞：要繁體中文、不要投資建議、章節不能超過影片長度", () => {
  const p = summaryPrompt({ title: "週三直播", hosts: ["CCC"], duration_sec: 3600 }, "[0:00] 大家好");
  assert.match(p.system, /繁體中文/); assert.match(p.system, /不要給投資建議/); assert.match(p.system, /3600 秒/);
  assert.match(p.user, /週三直播/);
});
await test("工作佇列：沒做過的先、卡住或失敗的過一陣子再試、做好的不再做、太短的不做", () => {
  const now = Date.parse("2026-10-22T00:00:00Z");
  const vids = [
    { id: 1, duration_sec: 3600, r2_key: "videos/a", created_at: "2026-10-21T00:00:00Z" },
    { id: 2, duration_sec: 3600, r2_key: "videos/b", created_at: "2026-10-20T00:00:00Z" },
    { id: 3, duration_sec: 120, r2_key: "videos/c", created_at: "2026-10-21T10:00:00Z" },
  ];
  assert.equal(pickJob(vids, [], now).id, 1);
  assert.equal(pickJob(vids, [{ video_id: 1, status: "done" }], now).id, 2);
  assert.equal(pickJob(vids, [{ video_id: 1, status: "done" }, { video_id: 2, status: "processing", attempts: 1, updated_at: "2026-10-21T23:00:00Z" }], now), null);
  assert.equal(pickJob(vids, [{ video_id: 1, status: "done" }, { video_id: 2, status: "processing", attempts: 1, updated_at: "2026-10-21T19:00:00Z" }], now).id, 2);
  assert.equal(pickJob(vids, [{ video_id: 1, status: "failed", attempts: 3, updated_at: "2026-10-20T00:00:00Z" }, { video_id: 2, status: "done" }], now), null);
  assert.equal(pickJob(vids, [{ video_id: 1, status: "done" }, { video_id: 2, status: "pending" }], now).id, 2);
});
await test("Discord 精華卡片：標題連到影片、重點、標的、章節、AI 提醒", () => {
  const e = highlightEmbed({ id: 7, title: "週三直播", hosts: ["CCC", "X"] }, { summary: "今天講 BTC", points: ["一"], tickers: [{ name: "BTC", note: "看多" }], chapters: [{ t: 0, title: "開場" }, { t: 330, title: "BTC" }] });
  assert.equal(e.url, "https://ccc-community-site.pages.dev/#/v/7");
  assert.deepEqual(e.fields.map((f) => f.name), ["📌 重點", "🎯 提到的標的", "🧭 章節"]);
  assert.match(e.fields[2].value, /`5:30` BTC/);
  assert.match(e.footer.text, /AI 自動整理/);
});
await test("等級卡：@ 研究員（只允許 @ 他）、等級顏色和徽章圖、不放交易量", () => {
  const c = levelCard({ level: 2, discordId: "500000000000000001", streak: 5, badges: 3 });
  assert.match(c.content, /<@500000000000000001> 升上 \*\*第二級/);
  assert.deepEqual(c.allowed_mentions, { users: ["500000000000000001"] });
  assert.equal(c.embeds[0].thumbnail.url, "https://ccc-community-site.pages.dev/assets/brand/tier2.png");
  assert.ok(c.embeds[0].fields.some((f) => /5/.test(f.value) && /連續/.test(f.name)));
  assert.doesNotMatch(JSON.stringify(c), /USDT|交易量/);
  const anon = levelCard({ level: 3 });
  assert.match(anon.content, /一位研究員/);
  assert.deepEqual(anon.allowed_mentions, { users: [] });
});
await test("下載卡片用的徽章 SVG：顏色寫死、顏色混合跟 CSS 一樣", () => {
  assert.equal(mix("#ffffff", "#000000", 0.5), "#808080");
  const svg = emblemSvg(3, 100);
  assert.match(svg, /#CDA45E/); assert.match(svg, />三</);
});

// ── GitHub OIDC ──
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
const b64u = (buf) => Buffer.from(buf).toString("base64url");
async function jwt(claims, { kid = "k1" } = {}) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid })), p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
}
const fakeJwks = async () => new Response(JSON.stringify({ keys: [jwk] }));
const good = () => ({ iss: OIDC.issuer, aud: "ccc-highlights", exp: Math.floor(Date.now() / 1000) + 300, repository: "Jackychen-create/ccc-community-site", repository_id: "1412597765", repository_owner_id: "214575415", ref: "refs/heads/main", workflow_ref: "Jackychen-create/ccc-community-site/.github/workflows/highlights.yml@refs/heads/main" });
await test("GitHub 身分證明：對的過、別的 repo／分支／流程／過期／簽名錯都擋", async () => {
  resetOidcCache();
  assert.ok(await verifyGithubOidc(await jwt(good()), { fetchImpl: fakeJwks }));
  for (const bad of [{ repository: "evil/ccc-community-site" }, { repository_id: "1" }, { repository_owner_id: "2" }, { ref: "refs/heads/feature" }, { workflow_ref: "Jackychen-create/ccc-community-site/.github/workflows/test.yml@refs/heads/main" }, { exp: 10 }, { aud: "other" }, { iss: "https://evil" }]) {
    assert.equal(await verifyGithubOidc(await jwt({ ...good(), ...bad }), { fetchImpl: fakeJwks }), null, JSON.stringify(bad));
  }
  const t = await jwt(good());
  assert.equal(await verifyGithubOidc(t.slice(0, -4) + "AAAA", { fetchImpl: fakeJwks }), null);
  assert.equal(await verifyGithubOidc(await jwt(good(), { kid: "nope" }), { fetchImpl: fakeJwks }), null);
  assert.equal(await verifyGithubOidc("garbage", { fetchImpl: fakeJwks }), null);
});

// ── 整個流程：假的 Supabase、Discord、Workers AI ──
const db = {
  videos: [
    { id: 1, title: "週三直播", hosts: ["CCC"], duration_sec: 1200, r2_key: "videos/2026/10/aaaaaaaaaaaa-live.mp4", is_published: true, is_public: false, course_host: null, published_at: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString() },
    { id: 2, title: "課程", hosts: ["CCC"], duration_sec: 1200, r2_key: "videos/2026/10/bbbbbbbbbbbb-c.mp4", is_published: true, is_public: false, course_host: "CCC", published_at: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString() },
    { id: 3, title: "草稿", hosts: [], duration_sec: 1200, r2_key: "videos/2026/10/cccccccccccc-d.mp4", is_published: false, is_public: false, course_host: null, published_at: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString() },
  ],
  video_highlights: [],
  settings: [{ key: "discord", value: { highlightChannelId: "900000000000000001" } }],
};
const val = (v) => (v === "null" ? null : v === "true" ? true : v === "false" ? false : v);
function match(row, sp) {
  for (const [k, raw] of sp) {
    if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
    const [op, ...rest] = raw.split("."); const v = rest.join(".");
    const cell = row[k];
    if (op === "eq" && String(cell) !== v) return false;
    if (op === "is" && (cell ?? null) !== val(v)) return false;
    if (op === "in" && !v.replace(/^\(|\)$/g, "").split(",").includes(String(cell))) return false;
    if (op === "gte" && !(typeof cell === "number" ? cell >= Number(v) : String(cell) >= v)) return false;
    if (op === "lt" && !(String(cell) < v)) return false;
  }
  return true;
}
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const table = u.pathname.split("/").pop();
  const rows = db[table] || [];
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? (d[0] ?? null) : d)); };
  const body = await readBody(req);
  if (req.method === "GET") { let out = rows.filter((r) => match(r, u.searchParams)); const l = Number(u.searchParams.get("limit")); if (l) out = out.slice(0, l); return send(out); }
  if (req.method === "POST") {
    const out = [];
    for (const it of Array.isArray(body) ? body : [body]) {
      const key = table === "video_highlights" ? "video_id" : "key";
      const i = rows.findIndex((r) => String(r[key]) === String(it[key]));
      if (i >= 0) rows[i] = { ...rows[i], ...it }; else rows.push({ status: "pending", attempts: 0, chunks: {}, posted_at: null, ...it });
      out.push(rows[i >= 0 ? i : rows.length - 1]);
    }
    db[table] = rows;
    return send(out, 201);
  }
  if (req.method === "PATCH") { const out = rows.filter((r) => match(r, u.searchParams)); for (const r of out) Object.assign(r, body); return send(out); }
  send([], 405);
});
const posts = [];
const disc = http.createServer(async (req, res) => { posts.push({ path: req.url, body: await readBody(req) }); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"1"}'); });
const [SUPA, DISC] = await Promise.all([listen(supa), listen(disc)]);
if (!globalThis.WebSocket) globalThis.WebSocket = class {};
const aiCalls = [];
const AI = {
  async run(model, input) {
    aiCalls.push({ model, input });
    if (model.includes("whisper")) return { text: "x", segments: [{ start: 0, end: 5, text: "大家好今天我們來看比特幣的走勢" }, { start: 30, end: 40, text: "台積電的法說會也要注意".repeat(12) }] };
    return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ summary: "這場講 BTC 和台積電。", points: ["BTC 回測支撐", "台積電法說"], tickers: [{ name: "BTC", note: "支撐" }, { name: "2330", note: "法說" }], chapters: [{ t: 0, title: "開場" }, { t: 600, title: "台積電" }] }) }] }] };
  },
};
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test", CRON_SECRET: "cron-secret-for-tests-1234", DISCORD_BOT_TOKEN: "bot", DISCORD_API_BASE: DISC, R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b", AI });

async function call(method, { query = {}, body, rawBytes, headers = { "x-cron-secret": "cron-secret-for-tests-1234" } } = {}) {
  const res = { statusCode: 200, body: null, headersSent: false, headers: {} };
  res.status = (c) => ((res.statusCode = c), res);
  res.setHeader = (k, v) => ((res.headers[k] = v), res);
  res.json = (d) => ((res.body = d), (res.headersSent = true), res);
  res.end = () => ((res.headersSent = true), res);
  await handler({ method, headers, query, body: body || {}, rawBytes }, res);
  return res;
}

await test("沒有密碼、亂給的 Bearer 都不能用", async () => {
  assert.equal((await call("GET", { headers: {} })).statusCode, 401);
  assert.equal((await call("GET", { headers: { authorization: "Bearer abc.def.ghi" } })).statusCode, 401);
});
await test("拿工作：只給已發布的直播留檔（不給教學課程、草稿），附 6 小時的下載連結、標成處理中", async () => {
  const r = await call("GET");
  assert.equal(r.body.job.videoId, 1);
  assert.match(r.body.job.url, /X-Amz-Expires=21600/);
  assert.equal(db.video_highlights.find((x) => x.video_id === 1).status, "processing");
  assert.equal((await call("GET")).body.job, null, "處理中的不會再給一次、其他兩支不是直播留檔");
});
await test("送聲音：每段轉文字、時間加上段落起點；太大、沒在處理中的擋掉", async () => {
  const a = await call("PUT", { query: { video: "1", chunk: "0" }, rawBytes: new Uint8Array([1, 2, 3]).buffer });
  assert.equal(a.statusCode, 200); assert.equal(a.body.segments, 2);
  await call("PUT", { query: { video: "1", chunk: "1" }, rawBytes: new Uint8Array([4]).buffer });
  const ch = db.video_highlights.find((x) => x.video_id === 1).chunks;
  assert.equal(ch[1][0].s, 600);
  assert.equal(aiCalls[0].input.language, "zh");
  assert.equal(aiCalls[0].input.audio, Buffer.from([1, 2, 3]).toString("base64"));
  assert.equal((await call("PUT", { query: { video: "1", chunk: "0" }, rawBytes: new ArrayBuffer(9 * 1024 * 1024) })).statusCode, 413);
  assert.equal((await call("PUT", { query: { video: "3", chunk: "0" }, rawBytes: new Uint8Array([1]).buffer })).statusCode, 409);
});
await test("送完：AI 整理、存起來、貼到直播精華頻道（只貼一次）", async () => {
  const r = await call("POST", { body: { video: 1, done: true } });
  assert.equal(r.statusCode, 200); assert.equal(r.body.posted, true);
  const h = db.video_highlights.find((x) => x.video_id === 1);
  assert.equal(h.status, "done"); assert.equal(h.summary, "這場講 BTC 和台積電。");
  assert.deepEqual(h.chapters, [{ t: 0, title: "開場" }, { t: 600, title: "台積電" }]);
  assert.ok(h.posted_at);
  const p = posts.find((x) => x.path === "/channels/900000000000000001/messages");
  assert.equal(p.body.embeds[0].title, "🎬 週三直播");
  assert.deepEqual(p.body.allowed_mentions, { parse: [] });
  const llm = aiCalls.find((c) => c.model.includes("gpt-oss"));
  assert.match(llm.input.input, /大家好今天我們來看比特幣/);
});
await test("重做：不會再貼一次 Discord", async () => {
  Object.assign(db.video_highlights.find((x) => x.video_id === 1), { status: "pending", attempts: 0 });
  assert.equal((await call("GET")).body.job.videoId, 1);
  await call("PUT", { query: { video: "1", chunk: "0" }, rawBytes: new Uint8Array([1]).buffer });
  await call("PUT", { query: { video: "1", chunk: "1" }, rawBytes: new Uint8Array([1]).buffer });
  const n = posts.length;
  const r = await call("POST", { body: { video: 1, done: true } });
  assert.equal(r.body.ok, true); assert.equal(r.body.posted, false); assert.equal(posts.length, n);
});
await test("GitHub 那邊出錯：記成失敗；聽不到內容：略過", async () => {
  db.videos.push({ id: 4, title: "安靜", hosts: [], duration_sec: 900, r2_key: "videos/2026/10/dddddddddddd-q.mp4", is_published: true, is_public: false, course_host: null, published_at: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString() });
  assert.equal((await call("GET")).body.job.videoId, 4);
  await call("POST", { body: { video: 4, error: "影片下載失敗：403" } });
  const h = db.video_highlights.find((x) => x.video_id === 4);
  assert.equal(h.status, "failed"); assert.match(h.error, /403/);
  Object.assign(h, { status: "processing", chunks: { 0: [{ s: 0, e: 1, t: "嗯" }] } });
  const r = await call("POST", { body: { video: 4, done: true } });
  assert.equal(r.body.skipped, true);
  assert.equal(h.status, "skipped");
});
await test("沒接 Workers AI：轉文字回 502、看得出原因", async () => {
  const saved = env.AI; env.AI = null;
  Object.assign(db.video_highlights.find((x) => x.video_id === 4), { status: "processing" });
  const r = await call("PUT", { query: { video: "4", chunk: "0" }, rawBytes: new Uint8Array([1]).buffer });
  env.AI = saved;
  assert.equal(r.statusCode, 502); assert.match(r.body.error, /Workers AI/);
});

await test("額度用完：回 429、排回去不算失敗次數", async () => {
  const saved = AI.run;
  AI.run = async () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); };
  const h = db.video_highlights.find((x) => x.video_id === 4);
  Object.assign(h, { status: "processing", attempts: 1 });
  const r = await call("PUT", { query: { video: "4", chunk: "0" }, rawBytes: new Uint8Array([1]).buffer });
  AI.run = saved;
  assert.equal(r.statusCode, 429); assert.equal(r.body.code, "quota");
  await call("POST", { body: { video: 4, error: r.body.error, quota: true } });
  assert.equal(h.status, "pending"); assert.equal(h.attempts, 0);
});
await test("卡在處理中、次數用完：下一次拿工作時標成失敗", async () => {
  const h = db.video_highlights.find((x) => x.video_id === 4);
  Object.assign(h, { status: "processing", attempts: 3, updated_at: new Date(Date.now() - 4 * 3600e3).toISOString() });
  await call("GET");
  assert.equal(h.status, "failed"); assert.match(h.error, /太久/);
});
await test("聲音上傳一定要有驗證和 content-length、邊讀邊算", async () => {
  const { onRequest } = await import("../functions/api/[[path]].js");
  const mk = (headers, body) => onRequest({ request: new Request("https://x/api/cron/highlights?video=1&chunk=0", { method: "PUT", headers, body, duplex: "half" }), env: { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test", CRON_SECRET: "cron-secret-for-tests-1234", AI }, params: { path: ["cron", "highlights"] }, waitUntil() {} });
  assert.equal((await mk({}, "x")).status, 401);
  assert.equal((await mk({ "x-cron-secret": "nope", "content-length": String(9 * 1024 * 1024) }, "x")).status, 413);
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 9; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); } });
  assert.equal((await mk({ "x-cron-secret": "nope", "content-length": "10" }, big)).status, 413, "content-length 說謊也擋得住");
});

supa.close(); disc.close();
console.log(`\n直播精華、等級卡：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
