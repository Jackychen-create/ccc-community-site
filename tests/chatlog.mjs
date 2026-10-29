// 聊天統計：假的 Discord（頻道、訊息分頁、上傳檔案）、假的 Supabase，整個流程跑一遍
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { runChatlog, fetchDay, summarizeDay, transcript, snowflakeAt, twDayStart, recapEmbed, topicsOf, hottestOf, isWebhookUrl, webhookInfo } from "../server/lib/chatlog.js";
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
  const wm = u.pathname.match(/^\/webhooks\/(\d+)\/([\w-]+)$/);
  if (wm) {
    if (wm[2] === "deleted-token-xxxxxxxxxxxxxx") return send({ message: "Unknown Webhook", code: 10015 }, 404);
    if (req.method === "GET") return send({ id: wm[1], name: "CCC｜每日回顧", channel_id: "100000000000000007" });
    posted.push({ channel: `webhook:${wm[1]}`, raw: (await readBody(req)).toString(), type: req.headers["content-type"], auth: req.headers.authorization || "", wait: u.searchParams.get("wait") });
    return send({ id: "6" });
  }
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
await test("完整紀錄文字檔：跟舊的每日回顧一樣（期間、訊息數、[時間] 名字、下一行內容）", async () => {
  const { messages } = await fetchDay(LOBBY, DAY);
  const t = transcript("大廳", DAY, messages, summarizeDay(messages));
  assert.ok(t.startsWith("CCC Market Lab｜#大廳｜DC 每日完整討論紀錄\n期間：2026-10-20 00:00:00 +0800 至 2026-10-21 00:00:00 +0800\n訊息數：3\n===="), t.slice(0, 200));
  assert.ok(t.includes("[2026-10-20 09:01:00] Amy\n早安"), t);
  assert.ok(t.includes("[2026-10-20 09:02:00] bob\n今天 NQ 怎麼看？\n第二行"));
  assert.ok(t.includes("［附件］chart.png：https://cdn.example/chart.png"));
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
await test("預設各自貼回自己的頻道：大廳只附大廳的紀錄，研究員大廳的紀錄不會出現在大廳", () => {
  assert.equal(posted.length, 2);
  const lobby = posted.find((p) => p.channel === LOBBY), lab = posted.find((p) => p.channel === LAB);
  assert.ok(lobby && lab, posted.map((p) => p.channel).join());
  assert.ok(/multipart\/form-data/.test(lobby.type));
  assert.ok(lobby.raw.includes(`filename="ccc_dc_recap_20261020_大廳.txt"`) && !lobby.raw.includes("研究員聊天 "), "大廳不能有研究員大廳的內容");
  assert.ok(lab.raw.includes(`filename="ccc_dc_recap_20261020_研究員大廳.txt"`) && lab.raw.includes("研究員聊天 0"));
  const embed = JSON.parse(lobby.raw.match(/name="payload_json"\r\n(?:[^\r\n]*\r\n)?\r\n(\{.*?\})\r\n--/s)[1]).embeds[0];
  assert.ok(embed.title.includes("#大廳 每日回顧｜2026/10/20"), embed.title);
  const f = Object.fromEntries(embed.fields.map((x) => [x.name, x.value]));
  assert.ok(f["📊 討論概況"].includes("訊息 3 則｜參與者 2 人｜區間 09:01–10:00"), f["📊 討論概況"]);
  assert.equal(f["🧪 全部大廳"], undefined, "大廳的卡片不能有研究員大廳的數字");
  assert.ok(!lobby.raw.includes("研究員大廳"), "大廳那則完全不能提到研究員大廳");
  assert.ok(f["📎 完整紀錄"].includes("ccc_dc_recap_20261020_大廳.txt"));
});
await test("同一天再跑一次：資料庫覆蓋，不會重複", async () => {
  await runChatlog(DAY, { post: false });
  assert.equal(db.chat_stats.length, 2);
  assert.equal(posted.length, 2);
});
await test("大廳的回顧改貼到原本的每日回顧頻道；研究員大廳照樣貼回自己", async () => {
  const RECAP = "100000000000000007";
  db.settings[0].value.chatChannels[0].postTo = RECAP;
  const n = posted.length;
  await runChatlog(DAY);
  const mine = posted.slice(n);
  assert.deepEqual(mine.map((p) => p.channel).sort(), [LAB, RECAP].sort());
  assert.ok(mine.find((p) => p.channel === RECAP).raw.includes("ccc_dc_recap_20261020_大廳.txt"));
  assert.ok(!mine.find((p) => p.channel === RECAP).raw.includes("研究員聊天 "));
  delete db.settings[0].value.chatChannels[0].postTo;
});
await test("大廳設了 Webhook：用 Webhook 貼（不帶機器人 Token），研究員大廳沒設照樣由機器人貼回自己", async () => {
  const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF";
  assert.ok(isWebhookUrl(HOOK) && !isWebhookUrl("https://evil.example/api/webhooks/1/2") && !isWebhookUrl(HOOK + "/../x"));
  assert.deepEqual(await webhookInfo(HOOK), { name: "CCC｜每日回顧", channelId: "100000000000000007" });
  db.settings[0].value.chatChannels[0].webhook = HOOK;
  const n = posted.length;
  const r = await runChatlog(DAY);
  const mine = posted.slice(n);
  const hook = mine.find((p) => p.channel === "webhook:123456789012345678");
  assert.ok(hook, mine.map((p) => p.channel).join());
  assert.equal(hook.auth, ""); assert.equal(hook.wait, "true");
  assert.ok(hook.raw.includes("ccc_dc_recap_20261020_大廳.txt") && !hook.raw.includes("研究員聊天 "));
  assert.ok(mine.some((p) => p.channel === LAB));
  assert.deepEqual(r.posts.map((p) => p.via).sort(), ["bot", "webhook"]);
  db.settings[0].value.chatChannels[0].webhook = "https://discord.com/api/webhooks/123456789012345678/deleted-token-xxxxxxxxxxxxxx";
  const r2 = await runChatlog(DAY);
  assert.ok(r2.postError.includes("Webhook 已經被刪掉了"), r2.postError);
  delete db.settings[0].value.chatChannels[0].webhook;
});
await test("「也貼到」：大廳的回顧再由機器人貼一份到別的頻道（附紀錄）；研究員大廳也貼到公開頻道但不附紀錄", async () => {
  const PUB = "100000000000000006";
  db.settings[0].value.chatChannels[0].alsoTo = PUB;
  db.settings[0].value.chatChannels[1].alsoTo = PUB;
  db.settings[0].value.chatChannels[1].alsoLog = false;
  const n = posted.length;
  const r = await runChatlog(DAY);
  const mine = posted.slice(n);
  const extra = mine.filter((p) => p.channel === PUB);
  assert.equal(extra.length, 2, mine.map((p) => p.channel).join());
  const lobbyCopy = extra.find((p) => p.raw.includes("ccc_dc_recap_20261020_大廳.txt"));
  assert.ok(lobbyCopy, "大廳那份附紀錄檔");
  const labCopy = extra.find((p) => p !== lobbyCopy);
  assert.ok(!labCopy.raw.includes("研究員聊天 ") && !labCopy.raw.includes("filename=") && labCopy.raw.includes("精簡版"), "研究員大廳那份不附紀錄");
  assert.ok(mine.some((p) => p.channel === LAB) && mine.some((p) => p.channel === LOBBY), "原本的照貼");
  assert.equal(r.posts.length, 4);
  for (const c of db.settings[0].value.chatChannels) { delete c.alsoTo; delete c.alsoLog; }
});
await test("選全部貼到同一個頻道：一則訊息兩張卡片、兩個檔案", async () => {
  db.settings[0].value.chatPostMode = "single";
  const r = await runChatlog(DAY);
  assert.equal(r.mode, "single");
  const p = posted.at(-1);
  assert.equal(p.channel, REPORT);
  assert.ok(p.raw.includes("ccc_dc_recap_20261020_大廳.txt") && p.raw.includes("ccc_dc_recap_20261020_研究員大廳.txt"));
  db.settings[0].value.chatPostMode = "own";
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
const mk = (content, extra = {}) => ({ id: String(++seq), author: { id: String(seq % 4) }, content, type: 0, timestamp: at(9, 0), ...extra });
await test("討論主題：拿掉網址和沒意義的字，同一則只算一次，長的詞優先", () => {
  const t = topicsOf(["今天 NQ 又洗盤了", "NQ 洗盤好兇", "固態電池股票大漲", "固態電池還能追嗎", "https://www.threads.net/xx 分享", "https://www.threads.net/yy", "BTC 破十萬", "BTC 好強"].map((x) => mk(x)));
  assert.ok(t.includes("固態電池") && t.includes("NQ") && t.includes("BTC") && t.includes("洗盤"), t.join());
  assert.ok(!t.some((w) => /https|www|com|threads/i.test(w)) && !t.includes("固態"), t.join());
});
await test("最多人回應：回覆＋表情最多的那一則", () => {
  const a = mk("今晚 CPI 大家怎麼看", { reactions: [{ count: 2 }] });
  const h = hottestOf([a, mk("看多", { message_reference: { message_id: a.id } }), mk("普通的一句")]);
  assert.equal(h.text, "今晚 CPI 大家怎麼看"); assert.equal(h.score, 3);
});
await test("卡片：沒有聊天也寫清楚", () => {
  const e = recapEmbed(DAY, { name: "大廳", messages: 0, authors: 0, topics: [], first: null, last: null }, { file: "x.txt" });
  assert.ok(e.fields.find((x) => x.name === "🔥 討論主題").value.includes("沒有聊天"));
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
