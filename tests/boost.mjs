// v1.26.19：直播留檔搜尋、AI 重點對時間、課程解鎖提醒、補發給掉隊的人
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { linesOf, hitsIn, metaHits, likeEscape, cleanQuery, matchTime, pointTimesOf, snippet } from "../server/lib/search.js";
import { cleanSummary, transcriptOf } from "../server/lib/highlights.js";
import { unlocksToday, courseMailHtml, courseUnlockEmbed } from "../server/lib/course-mail.js";
import { nudgeLists, runNudge, unregisteredEmbed } from "../server/lib/nudge.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c).toString())); });

// 逐字稿：第 0 段、第 1 段（第二段從 600 秒開始）
const CHUNKS = {
  0: [{ s: 1, e: 4, t: "大家好" }, { s: 5, e: 9, t: "今天講開盤區間" }, { s: 30, e: 36, t: "假突破要看成交量有沒有放大" }, { s: 62, e: 70, t: "倉位管理最重要的是先決定停損" }],
  1: [{ s: 610, e: 620, t: "NQ 今天又假突破了一次" }, { s: 700, e: 710, t: "最後回答大家的問題" }],
};

await test("逐字稿合成每 20 秒一行，搜尋找得到是哪一行、幾秒", () => {
  const lines = linesOf(CHUNKS);
  assert.equal(lines[0].t, "大家好，今天講開盤區間");
  const h = hitsIn(CHUNKS, "假突破");
  assert.deepEqual(h.map((x) => x.t), [30, 610]);
  assert.ok(h[0].text.includes("假突破要看成交量"));
  assert.deepEqual(hitsIn(CHUNKS, "nq").map((x) => x.t), [610]); // 英文不分大小寫
  assert.equal(transcriptOf(CHUNKS).split("\n")[0], "[0:01] 大家好，今天講開盤區間"); // 原本的逐字稿格式不變
});
await test("搜尋字要整理、跳脫 % _ \\", () => {
  assert.equal(cleanQuery("  假突破   NQ \n"), "假突破 NQ");
  assert.equal(cleanQuery("x".repeat(99)).length, 40);
  assert.equal(likeEscape("100%_a\\b"), "100\\%\\_a\\\\b");
  assert.equal(snippet("很長".repeat(40) + "關鍵字" + "後面".repeat(40), "關鍵字").length < 70, true);
});
await test("標題、章節、AI 重點也一起找（重點有時間就帶時間）", () => {
  const m = metaHits({ title: "倉位管理直播", chapters: [{ t: 0, title: "開場" }, { t: 300, title: "倉位怎麼抓" }] }, { summary: "", points: ["先決定停損再決定倉位"], point_times: [62], chapters: [] }, "倉位");
  assert.equal(m.title, true);
  assert.deepEqual(m.hits, [{ t: 300, text: "章節：倉位怎麼抓" }, { t: 62, text: "重點：先決定停損再決定倉位" }]);
});
await test("AI 重點對到逐字稿的時間；對不到給 null", () => {
  const lines = linesOf(CHUNKS);
  assert.equal(matchTime("假突破要確認成交量放大", lines), 30);
  assert.equal(matchTime("倉位管理先決定停損", lines), 62);
  assert.equal(matchTime("完全沒講到的東西喔喔喔", lines), null);
});
await test("AI 給的時間跟比對差不多就用 AI 的；差太多或亂給用比對的", () => {
  const t = pointTimesOf(["假突破要確認成交量放大", "倉位管理先決定停損", "完全沒講到的東西喔喔喔"], CHUNKS, [35, 3000, 120], 800);
  assert.deepEqual(t, [35, 62, 120]); // 第二點 AI 給 3000 超過片長 → 比對；第三點對不到 → 用 AI 的
});
await test("AI 回的重點可以帶時間 {t, text}，存的重點還是文字", () => {
  const r = cleanSummary({ summary: "摘要", points: [{ t: "1:02", text: "倉位" }, "沒有時間", { text: "物件沒時間" }] }, 3600);
  assert.deepEqual(r.points, ["倉位", "沒有時間", "物件沒時間"]);
  assert.deepEqual(r.pointTimesAi, [62, null, null]);
});

// ── 課程解鎖提醒 ──
const CV = [{ id: 1, course_host: "CCC", course_part: 1, title: "EP1" }, { id: 3, course_host: "X", course_part: 1, title: "X 一" }, { id: 4, course_host: "CCC", course_part: 2, title: "EP2" }];
const tiers = new Map([["a", { tier: 2 }], ["b", { tier: 2 }], ["c", { tier: 1 }], ["d", { tier: 3 }], ["e", { tier: 2 }], ["f", { tier: 2 }]]);
await test("課程解鎖提醒：今天解鎖的人收到（加入當天那份不寄、第三級不寄、關通知不寄、第一級只到第 1 份）", () => {
  const today = "2026-11-02";
  const ms = [
    { user_id: "a", email: "a@x", created_at: "2026-10-26T02:00:00Z" }, // 加入第 7 天 → X 第 1 份
    { user_id: "b", email: "b@x", created_at: "2026-11-02T02:00:00Z" }, // 今天加入（CCC 第 1 份是加入當天，不寄）
    { user_id: "c", email: "c@x", created_at: "2026-10-05T02:00:00Z" }, // 第一級，第 28 天 → X 第 2 份但看不到
    { user_id: "d", email: "d@x", created_at: "2026-10-26T02:00:00Z" }, // 第三級全部已解鎖
    { user_id: "e", email: "e@x", created_at: "2026-10-26T02:00:00Z", notify: false },
    { user_id: "f", email: "f@x", created_at: "2026-10-12T02:00:00Z" }, // 第 21 天 → CCC 第 2 份（第 14 天那週休息）
  ];
  const r = unlocksToday(ms, tiers, CV, today);
  assert.deepEqual(r.map((x) => [x.email, x.list.map((y) => `${y.host}${y.part}`).join()]), [["a@x", "X1"], ["f@x", "CCC2"]]);
  const html = courseMailHtml(r[0].list);
  assert.ok(html.includes("/#/v/3") && html.includes("X 講師第 1 份"));
});
await test("課程解鎖私訊卡片：有連結、不想收怎麼關", () => {
  const e = courseUnlockEmbed([{ host: "X", part: 1, id: 3, title: "X 一" }]);
  assert.ok(e.title.includes("X 講師第 1 份") && e.description.includes("/#/v/3") && e.footer.text.includes("關掉"));
});
await test("影片還沒上傳的那份不寄", () => {
  const r = unlocksToday([{ user_id: "a", email: "a@x", created_at: "2026-10-26T02:00:00Z" }], tiers, CV.filter((v) => v.course_host !== "X"), "2026-11-02");
  assert.equal(r.length, 0);
});

// ── 補發給掉隊的人 ──
const NOW = Date.parse("2026-11-02T12:00:00Z");
const D = 86400e3;
const db = {
  bot_state: [],
  discord_applications: [
    { discord_user_id: "111111111111111101", discord_name: "沒註冊", invite_code: "AAAA-0001", status: "approved", reviewed_at: new Date(NOW - 10 * D).toISOString() },
    { discord_user_id: "111111111111111102", discord_name: "已註冊", invite_code: "BBBB-0001", status: "approved", reviewed_at: new Date(NOW - 10 * D).toISOString() },
    { discord_user_id: "111111111111111103", discord_name: "昨天才通過", invite_code: "CCCC-0001", status: "approved", reviewed_at: new Date(NOW - 1 * D).toISOString() },
    { discord_user_id: "111111111111111106", discord_name: "連到的人", invite_code: null, exchange: "OKX", exchange_uid: "55550001", status: "approved", reviewed_at: new Date(NOW - 20 * D).toISOString() },
  ],
  members: [
    { user_id: "m1", email: "watched@x", banned: false, invite_code: "BBBB-0001", created_at: new Date(NOW - 20 * D).toISOString() },
    { user_id: "m2", email: "never@x", banned: false, invite_code: "ZZ", created_at: new Date(NOW - 20 * D).toISOString() },
    { user_id: "m3", email: "new@x", banned: false, invite_code: "YY", created_at: new Date(NOW - 1 * D).toISOString() },
    { user_id: "m4", email: "boss@gmail.com", banned: false, invite_code: null, created_at: new Date(NOW - 20 * D).toISOString() },
    { user_id: "m5", email: "banned@x", banned: true, invite_code: null, created_at: new Date(NOW - 20 * D).toISOString() },
    { user_id: "m6", email: "linked@x", banned: false, invite_code: "QQ", created_at: new Date(NOW - 20 * D).toISOString() }, // 用交易所 UID 連到 Discord
  ],
  watch_progress: [{ user_id: "m1" }],
  exchange_links: [{ user_id: "m6", exchange: "OKX", exchange_uid: "55550001" }],
  member_discord: [],
  videos: [{ id: 1, title: "EP1 我的進出場規則以及邏輯", is_published: true, course_host: "CCC", course_part: 1 }],
};
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const table = u.pathname.split("/").pop();
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? d[0] ?? null : d)); };
  if (req.method === "GET") {
    let rows = db[table];
    for (const [k, v] of u.searchParams) {
      if (["select", "order", "limit"].includes(k)) continue;
      if (v === "not.is.null") { rows = rows.filter((r) => r[k] != null); continue; }
      const [op, ...rest] = v.split("."); const val = rest.join(".");
      if (op === "eq") rows = rows.filter((r) => String(r[k]) === val);
      if (op === "in") { const list = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")); rows = rows.filter((r) => list.includes(String(r[k]))); }
    }
    return send(rows);
  }
  const body = JSON.parse((await readBody(req)) || "null");
  for (const it of Array.isArray(body) ? body : [body]) { const i = db[table].findIndex((r) => r.key === it.key); if (i >= 0) db[table][i] = { ...db[table][i], ...it }; else db[table].push(it); }
  return send(Array.isArray(body) ? body : [body], 201);
});
const dms = [];
const disc = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
  const body = JSON.parse((await readBody(req)) || "null");
  if (u.pathname === "/users/@me/channels") return send({ id: "7" + body.recipient_id.slice(1) });
  const m = u.pathname.match(/^\/channels\/(\d+)\/messages$/);
  if (m) { dms.push({ to: "1" + m[1].slice(1), body }); return send({ id: "5" }); }
  return send({}, 404);
});
const mails = [];
const brevo = http.createServer(async (req, res) => { mails.push(JSON.parse(await readBody(req))); res.writeHead(201, { "Content-Type": "application/json" }); res.end("{}"); });
const [SUPA, DISC, BREVO] = await Promise.all([listen(supa), listen(disc), listen(brevo)]);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test", DISCORD_API_BASE: DISC, DISCORD_BOT_TOKEN: "t", DISCORD_APP_ID: "1", DISCORD_PUBLIC_KEY: "k", ADMIN_EMAILS: "boss@gmail.com", BREVO_API_KEY: "test", MAIL_FROM: "lab@example.com" });
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opt) => realFetch(String(url).startsWith("https://api.brevo.com") ? BREVO : url, opt);

await test("補發名單：通過沒註冊（昨天才通過的不算）、註冊了沒看過影片（管理員、停權、剛加入的不算）", async () => {
  const { unregistered, unwatched } = await nudgeLists(NOW);
  assert.deepEqual(unregistered.map((p) => p.name), ["沒註冊"]); // 「連到的人」沒有實驗室密碼，用 UID 連的，不算
  assert.deepEqual(unwatched.map((p) => [p.email, p.discordId]), [["never@x", null], ["linked@x", "111111111111111106"]]);
});
await test("私訊提醒註冊：附他自己的加入連結；30 天內不再發", async () => {
  const r = await runNudge("unregistered", NOW);
  assert.equal(r.sent, 1);
  assert.equal(dms[0].to, "111111111111111101");
  assert.equal(dms.length, 1); // 已經註冊的「連到的人」不在這組
  assert.ok(dms[0].body.embeds[0].description.includes("/?invite=AAAA-0001"));
  const again = await runNudge("unregistered", NOW + D / 2);
  assert.deepEqual([again.sent, again.skipped], [0, 1]);
  assert.ok((await nudgeLists(NOW + D / 2)).unregistered[0].sentAt);
});
await test("推薦 EP1：有連 Discord 的私訊、沒連的寄信，都連到 EP1；30 天內不再發", async () => {
  const r = await runNudge("unwatched", NOW);
  assert.deepEqual([r.sent, r.dms, r.mails], [2, 1, 1], JSON.stringify(r));
  assert.equal(mails.length, 1);
  assert.equal(mails[0].messageVersions[0].to[0].email, "never@x");
  assert.ok(mails[0].htmlContent.includes("/#/v/1") && mails[0].htmlContent.includes("EP1"));
  const d = dms.find((x) => x.to === "111111111111111106");
  assert.ok(d && d.body.embeds[0].description.includes("/#/v/1"));
  assert.equal((await runNudge("unwatched", NOW + D / 2)).sent, 0);
});
await test("提醒註冊的私訊內容", () => {
  assert.ok(unregisteredEmbed("X-1").description.includes("只能用一次") || unregisteredEmbed("X-1").footer.text.includes("只能用一次"));
});

console.log(`\n${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
