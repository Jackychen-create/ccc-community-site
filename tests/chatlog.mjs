// 聊天統計：假的 Discord（頻道、訊息分頁、上傳檔案）、假的 Supabase，整個流程跑一遍
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { runChatlog, fetchDay, summarizeDay, transcript, snowflakeAt, twDayStart, reportText } from "../server/lib/chatlog.js";
import cron from "../server/cron/chatlog.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c))); });

// ── 假 Supabase：settings、chat_stats ──
const db = { settings: [], chat_stats: [] };
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const table = u.pathname.split("/").pop();
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? d[0] ?? null : d)); };
  if (req.method === "GET") {
    const key = u.searchParams.get("key");
    return send(db[table].filter((r) => !key || r.key === key.replace(/^eq\./, "")));
  }
  const body = JSON.parse((await readBody(req)).toString() || "null");
  for (const it of Array.isArray(body) ? body : [body]) {
    const k = table === "settings" ? (r) => r.key === it.key : (r) => r.day === it.day && r.channel_id === it.channel_id;
    const i = db[table].findIndex(k);
    if (i >= 0) db[table][i] = { ...db[table][i], ...it }; else db[table].push(it);
  }
  return send(Array.isArray(body) ? body : [body], 201);
});

// ── 假 Discord ──
const DAY = "2026-10-20";
const at = (hh, mm) => new Date(twDayStart(DAY) + (hh * 60 + mm) * 60e3).toISOString();
let seq = 0;
const msg = (t, author, content, extra = {}) => ({ id: String(BigInt(snowflakeAt(Date.parse(t))) + BigInt(++seq)), timestamp: t, type: 0, author, content, attachments: [], ...extra });
const A1 = { id: "111111111111111111", username: "amy", global_name: "Amy" };
const B1 = { id: "222222222222222222", username: "bob" };
const BOT = { id: "999999999999999999", username: "bot", bot: true };
const LOBBY = "100000000000000001", LAB = "100000000000000002", REPORT = "100000000000000009", SECRET = "100000000000000003";
const channels = {
  [LOBBY]: [
    msg(new Date(twDayStart(DAY) - 60e3).toISOString(), A1, "前一天的不算"),
    msg(at(9, 1), A1, "早安"),
    msg(at(9, 2), B1, "今天 NQ 怎麼看？\n第二行"),
    msg(at(9, 3), BOT, "機器人不算"),
    msg(at(10, 0), A1, "", { attachments: [{ filename: "chart.png", url: "https://cdn.example/chart.png" }] }),
    msg(at(10, 1), A1, "", { type: 7 }), // 系統訊息（有人加入）不算
    msg(new Date(twDayStart(DAY) + 86400e3 + 60e3).toISOString(), B1, "隔天的不算"),
  ],
  [LAB]: Array.from({ length: 150 }, (_, i) => msg(at(12, i % 60), i % 3 ? A1 : B1, `研究員聊天 ${i}`)),
};
const posted = [];
const calls = [];
const disc = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  calls.push(`${req.method} ${u.pathname}`);
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
  const m = u.pathname.match(/^\/channels\/(\d+)(\/messages)?$/);
  if (!m) return send({ message: "not found" }, 404);
  const id = m[1];
  if (id === SECRET) return send({ message: "Missing Access", code: 50001 }, 403);
  if (req.method === "POST") {
    const raw = (await readBody(req)).toString();
    posted.push({ channel: id, raw, type: req.headers["content-type"] });
    return send({ id: "5" });
  }
  if (!m[2]) return send({ id, name: id === LOBBY ? "大廳" : id === LAB ? "研究員大廳" : "其他" });
  const after = BigInt(u.searchParams.get("after") || "0");
  const limit = Number(u.searchParams.get("limit") || 50);
  const list = (channels[id] || []).filter((x) => BigInt(x.id) > after).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).slice(0, limit).reverse(); // 新的在前（跟 Discord 一樣）
  return send(list);
});

const [SUPA, DISC] = await Promise.all([listen(supa), listen(disc)]);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test", DISCORD_API_BASE: DISC, DISCORD_BOT_TOKEN: "t", DISCORD_APP_ID: "1", DISCORD_PUBLIC_KEY: "k", CRON_SECRET: "cron-test" });

await test("訊息編號換算：台灣 10/20 00:00 之後的才抓", () => {
  assert.equal(new Date(twDayStart(DAY)).toISOString(), "2026-10-19T16:00:00.000Z");
  assert.ok(BigInt(snowflakeAt(twDayStart(DAY))) > 0n);
});
await test("抓一整天：只要台灣時間那一天、舊到新、會翻頁", async () => {
  const { messages, truncated } = await fetchDay(LAB, DAY);
  assert.equal(messages.length, 150); assert.equal(truncated, false);
  assert.ok(messages.every((x, i) => i === 0 || BigInt(messages[i - 1].id) < BigInt(x.id)));
  const lobby = await fetchDay(LOBBY, DAY);
  assert.deepEqual(lobby.messages.map((x) => x.content), ["早安", "今天 NQ 怎麼看？\n第二行", "機器人不算", "", ""]);
});
await test("統計：機器人、系統訊息不算；發言人數不重複；最常發言排前面", async () => {
  const { messages } = await fetchDay(LOBBY, DAY);
  const s = summarizeDay(messages);
  assert.equal(s.messages, 3); assert.equal(s.authors, 2);
  assert.deepEqual(s.top, [{ name: "Amy", n: 2 }, { name: "bob", n: 1 }]);
});
await test("聊天紀錄文字檔：時間、名字、內容，附件寫網址，換行縮排", async () => {
  const { messages } = await fetchDay(LOBBY, DAY);
  const t = transcript("大廳", DAY, messages, summarizeDay(messages));
  assert.ok(t.startsWith("CCC 交易實驗室｜#大廳｜2026-10-20（台灣時間）聊天紀錄"), t);
  assert.ok(t.includes("[09:01] Amy：早安"));
  assert.ok(t.includes("[09:02] bob：今天 NQ 怎麼看？\n        第二行"));
  assert.ok(t.includes("［附件 chart.png：https://cdn.example/chart.png］"));
  assert.ok(!t.includes("機器人不算") && !t.includes("前一天") && !t.includes("隔天"));
});
await test("還沒設定頻道：不跑", async () => {
  const r = await runChatlog(DAY);
  assert.equal(r.ok, false);
});
db.settings.push({ key: "discord", value: { reviewChannelId: "100000000000000008", chatReportChannelId: REPORT, chatChannels: [{ id: LOBBY, name: "大廳" }, { id: LAB, name: "研究員大廳" }] } });
await test("跑一天：兩個大廳分開算、合計人數不重複、存進資料庫", async () => {
  const r = await runChatlog(DAY);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.rows.map((x) => [x.name, x.messages, x.authors]), [["大廳", 3, 2], ["研究員大廳", 150, 2]]);
  assert.deepEqual(r.total, { messages: 153, authors: 2 });
  assert.equal(db.chat_stats.length, 2);
  assert.deepEqual(db.chat_stats.map((x) => [x.day, x.channel_name, x.messages]), [[DAY, "大廳", 3], [DAY, "研究員大廳", 150]]);
});
await test("貼到回報頻道：統計文字＋兩個文字檔", () => {
  assert.equal(posted.length, 1);
  const p = posted[0];
  assert.equal(p.channel, REPORT);
  assert.ok(/multipart\/form-data/.test(p.type));
  assert.ok(p.raw.includes("10/20 聊天統計") && p.raw.includes("#大廳：3 則・2 人") && p.raw.includes("#研究員大廳：150 則・2 人") && p.raw.includes("合計：153 則・2 人"), p.raw.slice(0, 400));
  assert.ok(p.raw.includes(`filename="${DAY}_大廳.txt"`) && p.raw.includes(`filename="${DAY}_研究員大廳.txt"`));
  assert.ok(p.raw.includes("[09:01] Amy：早安"));
});
await test("同一天再跑一次：資料庫覆蓋，不會重複", async () => {
  await runChatlog(DAY, { post: false });
  assert.equal(db.chat_stats.length, 2);
  assert.equal(posted.length, 1);
});
await test("機器人看不到的頻道：寫原因，其他頻道照跑", async () => {
  db.settings[0].value.chatChannels.push({ id: SECRET, name: "秘密" });
  const r = await runChatlog(DAY, { post: false });
  assert.equal(r.rows.find((x) => x.id === SECRET).error, "機器人看不到這個頻道");
  assert.equal(r.rows.filter((x) => !x.error).length, 2);
  db.settings[0].value.chatChannels.pop();
});
await test("訊息內容都空的：提醒打開 Message Content Intent", async () => {
  const saved = channels[LOBBY];
  channels[LOBBY] = [msg(at(8, 0), A1, ""), msg(at(8, 1), B1, "")];
  const r = await runChatlog("2026-10-20", { post: false });
  assert.equal(r.noContent, true);
  channels[LOBBY] = saved;
});
await test("統計文字：抓不到的頻道寫原因", () => {
  const t = reportText(DAY, [{ name: "大廳", messages: 3, authors: 2, top: [{ name: "Amy", n: 2 }] }, { name: "秘密", error: "機器人看不到這個頻道" }], 2);
  assert.ok(t.includes("#秘密：抓不到（機器人看不到這個頻道）") && t.includes("最常發言：Amy 2"));
});
await test("排程：沒有密碼不能跑；有密碼跑昨天", async () => {
  const mk = (h) => { const res = { statusCode: 0, headers: {}, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} }; return [{ method: "POST", headers: h, query: {}, body: {} }, res]; };
  let [rq, rs] = mk({});
  await cron(rq, rs); assert.equal(rs.statusCode, 401);
  [rq, rs] = mk({ "x-cron-secret": "cron-test" });
  await cron(rq, rs); assert.equal(rs.statusCode, 200, JSON.stringify(rs.body)); assert.equal(rs.body.ok, true);
});

supa.close(); disc.close();
console.log(`\n聊天統計：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
