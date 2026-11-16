// v1.28.0：付費制（綠界）——誰照舊、月費、單集、綠界通知驗證、續扣、扣款失敗、到期、取消、後台設定和手動給、Discord 身分組、註冊不用實驗室密碼
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { macValue, STAGE, handleNotify, sweep, memberPaid } from "../server/lib/pay.js";
import { todayTW } from "../server/lib/dates.js";
import { addDays, addMonths, isLegacyMember, paidStatus } from "../public/assets/js/shared/rules.js";
import payApi from "../server/pay.js";
import adminPay from "../server/admin/pay.js";
import course from "../server/course.js";
import videosApi from "../server/videos.js";
import me from "../server/me.js";
import register from "../server/register.js";
import publicMembership from "../server/public-membership.js";
import { notify as payNotify } from "../server/pay-notify.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c).toString())); });

const today = todayTW();
const at = (d) => new Date(Date.parse(d + "T04:00:00Z")).toISOString();
const PAID_FROM = addDays(today, -10);

// ── 假的 Supabase ──
const db = {
  members: [], pay_orders: [], pay_logs: [], volumes: [], member_discord: [], feedback: [], watch_progress: [], attachments: [], videos: [], exchange_links: [], invite_codes: [], checkins: [], milestones: [],
  settings: [{ key: "pay", value: { mode: "test", monthly: 66, part: 666, paidFrom: PAID_FROM, legacyUntil: null } }, { key: "discord", value: { guildId: "900000000000000001", roleId: "1560542923173400596", reviewChannelId: "900000000000000009" } }],
};
const tokens = {
  "tok-admin": { id: "admin-1", email: "boss@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z" },
  "tok-new": { id: "u-new", email: "new@example.com" },
  "tok-old": { id: "u-old", email: "old@example.com" },
};
const cmp = (a, b) => (/^\d{4}-\d\d-\d\dT/.test(b) ? Date.parse(a) - Date.parse(b) : String(a).localeCompare(b));
const filt = (rows, sp) => {
  for (const [k, v] of sp) {
    if (["select", "order", "limit", "on_conflict", "columns", "offset"].includes(k)) continue;
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    if (op === "eq") rows = rows.filter((r) => String(r[k]) === val);
    if (op === "neq") rows = rows.filter((r) => String(r[k]) !== val);
    if (op === "is") rows = rows.filter((r) => (val === "null" ? r[k] == null : true));
    if (op === "not") rows = rows.filter((r) => (val === "is.null" ? r[k] != null : true));
    if (op === "gt") rows = rows.filter((r) => r[k] != null && cmp(r[k], val) > 0);
    if (op === "gte") rows = rows.filter((r) => r[k] != null && cmp(r[k], val) >= 0);
    if (op === "lt") rows = rows.filter((r) => r[k] != null && cmp(r[k], val) < 0);
    if (op === "lte") rows = rows.filter((r) => r[k] != null && cmp(r[k], val) <= 0);
    if (op === "in") { const list = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")); rows = rows.filter((r) => list.includes(String(r[k]))); }
  }
  return rows;
};
let createdUsers = 0;
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const sendJ = (d, s = 200, extra = {}) => { res.writeHead(s, { "Content-Type": "application/json", ...extra }); res.end(JSON.stringify(d)); };
  if (u.pathname === "/auth/v1/user") { const user = tokens[(req.headers.authorization || "").replace("Bearer ", "")]; return sendJ(user || { message: "invalid" }, user ? 200 : 401); }
  if (u.pathname === "/auth/v1/admin/users" && req.method === "POST") { const b = JSON.parse(await readBody(req)); createdUsers++; return sendJ({ id: `u-reg-${createdUsers}`, email: b.email }); }
  if (u.pathname.startsWith("/rest/v1/rpc/")) return sendJ(u.pathname.endsWith("use_invite_code") ? true : null);
  const t = u.pathname.split("/").pop();
  if (!db[t]) return sendJ([], 404);
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => sendJ(one ? d[0] ?? null : d, s);
  const hit = filt(db[t], u.searchParams);
  if (req.method === "HEAD") { res.writeHead(200, { "Content-Range": `0-0/${hit.length}` }); return res.end(); }
  if (req.method === "GET") return send(hit);
  if (req.method === "DELETE") { db[t] = db[t].filter((r) => !hit.includes(r)); return send(hit); }
  const body = JSON.parse((await readBody(req)) || "null");
  if (req.method === "PATCH") { for (const r of hit) Object.assign(r, body); return send(hit); }
  const conflict = (u.searchParams.get("on_conflict") || (t === "settings" ? "key" : t === "member_discord" ? "user_id" : "")).split(",").filter(Boolean);
  for (const it of Array.isArray(body) ? body : [body]) {
    const i = conflict.length ? db[t].findIndex((r) => conflict.every((c) => String(r[c]) === String(it[c]))) : -1;
    if (i >= 0) db[t][i] = { ...db[t][i], ...it }; else db[t].push({ created_at: new Date().toISOString(), ...it });
  }
  return send(Array.isArray(body) ? body : [body], 201);
});
// ── 假的 Discord：記下給／拿身分組、發訊息 ──
const discordCalls = [];
const discord = http.createServer(async (req, res) => {
  discordCalls.push(`${req.method} ${req.url}`);
  if (req.url === "/users/@me/channels") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ id: "dmch" })); }
  if (/\/roles\//.test(req.url)) { res.writeHead(204); return res.end(); }
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "msg1" }));
});
// ── 假的綠界：停止定期定額 ──
const ecpayCalls = [];
const ecpay = http.createServer(async (req, res) => {
  const b = Object.fromEntries(new URLSearchParams(await readBody(req)));
  ecpayCalls.push(b);
  const okMac = (await macValue(b, STAGE.key, STAGE.iv)) === b.CheckMacValue;
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(okMac ? "MerchantID=3002607&MerchantTradeNo=" + b.MerchantTradeNo + "&RtnCode=1&RtnMsg=成功" : "RtnCode=0&RtnMsg=CheckMacValue Error");
});
const [SUPA, DC, EC] = await Promise.all([listen(supa), listen(discord), listen(ecpay)]);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test", ADMIN_EMAILS: "boss@gmail.com", DISCORD_BOT_TOKEN: "bot", DISCORD_API_BASE: DC, ECPAY_BASE_URL: EC, CRON_SECRET: "cron-test" });
if (!globalThis.WebSocket) globalThis.WebSocket = class {};

async function call(handler, { method = "GET", query = {}, body, token = "tok-admin", route = "" } = {}) {
  const res = { statusCode: 200, body: null, headersSent: false, headers: {} };
  res.status = (c) => ((res.statusCode = c), res);
  res.setHeader = (k, v) => ((res.headers[k] = v), res);
  res.json = (d) => ((res.body = d), (res.headersSent = true), res);
  res.send = (d) => ((res.body = d), (res.headersSent = true), res);
  res.end = () => ((res.headersSent = true), res);
  await handler({ method, route, headers: { authorization: `Bearer ${token}` }, query, body, waitUntil: () => {} }, res);
  return res;
}
const member = (id, joined, extra = {}) => ({ user_id: id, email: `${id.slice(2)}@example.com`, banned: false, notify: true, created_at: at(joined), min_tier: null, min_tier_until: null, free: false, theme: null, ...extra });
db.members.push(member("u-new", addDays(today, -2)), member("u-old", addDays(today, -40)));
db.member_discord.push({ user_id: "u-new", discord_user_id: "800000000000000001", discord_name: "newbie" });
db.videos.push(
  { id: 1, title: "直播 11/10", is_published: true, course_host: null, course_part: null, r2_key: "v/1.mp4", is_public: false, published_at: today },
  { id: 2, title: "CCC 第 1 份", is_published: true, course_host: "CCC", course_part: 1, r2_key: "v/2.mp4" },
  { id: 3, title: "X 第 2 份", is_published: true, course_host: "X", course_part: 2, r2_key: "v/3.mp4" },
);
// 綠界送過來的通知（測試特店的金鑰簽名）
async function ecpayPost(fields) {
  const p = { MerchantID: STAGE.merchant, ...fields };
  p.CheckMacValue = await macValue(p, STAGE.key, STAGE.iv);
  return p;
}
const order = (no) => db.pay_orders.find((o) => o.trade_no === no);

await test("規則：paidFrom 之前加入的照舊；之後加入的付費；贈送名額照舊；legacyUntil 過了舊的也付費", () => {
  const cfg = { paidFrom: "2026-11-20" };
  assert.equal(isLegacyMember({ joined: "2026-11-01" }, cfg, "2026-11-25"), true);
  assert.equal(isLegacyMember({ joined: "2026-11-21" }, cfg, "2026-11-25"), false);
  assert.equal(isLegacyMember({ joined: "2026-11-21", free: true }, cfg, "2026-11-25"), true);
  assert.equal(isLegacyMember({ joined: "2026-11-21" }, cfg, "2026-11-19"), true, "還沒開始");
  assert.equal(isLegacyMember({ joined: "2026-11-01" }, { ...cfg, legacyUntil: "2026-12-31" }, "2027-01-01"), false);
  assert.equal(isLegacyMember({ joined: "2026-11-01" }, { paidFrom: "" }, "2027-01-01"), true, "沒設定日期＝全部照舊");
});
await test("規則：月費到期前是第二級、過期是第一級；手動第三級＝全部集數", () => {
  assert.equal(paidStatus({ subUntil: "2026-12-01", today: "2026-12-01" }).tier, 2);
  assert.equal(paidStatus({ subUntil: "2026-12-01", today: "2026-12-02" }).tier, 1);
  assert.deepEqual(paidStatus({ override: 3, today: "2026-12-02" }).parts, [1, 2, 3, 4, 5, 6]);
});

await test("舊研究員（付費制之前加入）不是付費制，照原本規則", async () => {
  assert.equal(await memberPaid(db.members[1]), null);
  const r = await call(payApi, { token: "tok-old" });
  assert.equal(r.body.paid, false);
  const p = await call(payApi, { method: "POST", token: "tok-old", body: { item: "monthly" } });
  assert.equal(p.statusCode, 400);
});
await test("新研究員還沒付錢：第一級，直播留檔擋住，系統分享每集都鎖、標價 666", async () => {
  const m = await call(me, { token: "tok-new" });
  assert.equal(m.body.tier, 1);
  assert.equal(m.body.volume.paid.sub, false);
  const v = await call(videosApi, { token: "tok-new" });
  assert.equal(v.statusCode, 403); assert.equal(v.body.code, "paid_sub");
  const c = await call(course, { token: "tok-new" });
  assert.equal(c.statusCode, 200);
  assert.ok(c.body.slots.every((s) => !s.unlocked && s.price === 666 && s.unlock_on === null), JSON.stringify(c.body.slots[0]));
  const d = await call(videosApi, { token: "tok-new", query: { id: "2" } });
  assert.equal(d.statusCode, 403); assert.equal(d.body.code, "paid_part");
});

let monthlyNo;
await test("訂閱月費：開一筆訂單，回傳綠界表單（定期定額、每月、檢查碼正確）", async () => {
  const r = await call(payApi, { method: "POST", token: "tok-new", body: { item: "monthly" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const f = r.body.fields;
  assert.equal(r.body.action, `${EC}/Cashier/AioCheckOut/V5`);
  assert.equal(f.TotalAmount, "66"); assert.equal(f.PeriodAmount, "66"); assert.equal(f.PeriodType, "M"); assert.equal(f.Frequency, "1");
  assert.match(f.ReturnURL, /\/api\/pay\/notify$/); assert.match(f.PeriodReturnURL, /\/api\/pay\/period$/);
  assert.equal(f.CheckMacValue, await macValue(f, STAGE.key, STAGE.iv));
  monthlyNo = f.MerchantTradeNo;
  assert.equal(order(monthlyNo).status, "pending");
});
await test("綠界通知檢查碼不對：不理，回 0|", async () => {
  const p = await ecpayPost({ MerchantTradeNo: monthlyNo, RtnCode: "1", RtnMsg: "OK", TradeAmt: "66" });
  p.CheckMacValue = "X" + p.CheckMacValue.slice(1);
  assert.match(await handleNotify(p, "first"), /^0\|/);
  assert.equal(order(monthlyNo).status, "pending");
});
await test("第一次刷卡成功：月費到下個月同一天、給 Discord 身分組、通知管理員、私訊研究員", async () => {
  discordCalls.length = 0;
  const r = await call(payNotify, { method: "POST", body: await ecpayPost({ MerchantTradeNo: monthlyNo, RtnCode: "1", RtnMsg: "交易成功", TradeAmt: "66" }) });
  assert.equal(r.body, "1|OK");
  assert.equal(order(monthlyNo).status, "active");
  assert.equal(order(monthlyNo).paid_until, addMonths(today, 1));
  assert.ok(discordCalls.some((c) => c === "PUT /guilds/900000000000000001/members/800000000000000001/roles/1560542923173400596"), discordCalls.join("\n"));
  assert.ok(discordCalls.some((c) => c === "POST /channels/900000000000000009/messages"));
  assert.equal(db.pay_logs.length, 1);
});
await test("有月費：第二級，直播留檔看得到；系統分享還是要買", async () => {
  const m = await call(me, { token: "tok-new" });
  assert.equal(m.body.tier, 2);
  assert.equal((await call(videosApi, { token: "tok-new" })).statusCode, 200);
  assert.equal((await call(videosApi, { token: "tok-new", query: { id: "1" } })).statusCode, 200);
  assert.equal((await call(videosApi, { token: "tok-new", query: { id: "2" } })).body.code, "paid_part");
  const again = await call(payApi, { method: "POST", token: "tok-new", body: { item: "monthly" } });
  assert.equal(again.statusCode, 409);
});
await test("同一次通知送兩次：不會重複延長", async () => {
  const p = await ecpayPost({ MerchantTradeNo: monthlyNo, RtnCode: "1", RtnMsg: "交易成功", TradeAmt: "66" });
  await handleNotify(p, "first");
  assert.equal(order(monthlyNo).paid_until, addMonths(today, 1));
});
await test("每月續扣成功：延長一個月；同一期重送不重複", async () => {
  const p = await ecpayPost({ MerchantTradeNo: monthlyNo, RtnCode: "1", RtnMsg: "成功", Amount: "66", TotalSuccessTimes: "2" });
  assert.equal(await handleNotify(p, "period"), "1|OK");
  assert.equal(order(monthlyNo).paid_until, addMonths(addMonths(today, 1), 1));
  assert.equal(order(monthlyNo).times, 2);
  await handleNotify(p, "period");
  assert.equal(order(monthlyNo).paid_until, addMonths(addMonths(today, 1), 1));
});

let partNo;
await test("買第 2 集：單次付款表單（沒有定期定額欄位）", async () => {
  const r = await call(payApi, { method: "POST", token: "tok-new", body: { item: "part", part: 2 } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.fields.TotalAmount, "666");
  assert.equal(r.body.fields.PeriodType, undefined);
  assert.match(r.body.fields.ClientBackURL, /#\/course\?paid=1$/);
  partNo = r.body.fields.MerchantTradeNo;
  const bad = await call(payApi, { method: "POST", token: "tok-new", body: { item: "part", part: 7 } });
  assert.equal(bad.statusCode, 400);
});
await test("單集付款成功：CCC、X 的第 2 份都打開，其他集還鎖著；不能再買一次", async () => {
  assert.equal(await handleNotify(await ecpayPost({ MerchantTradeNo: partNo, RtnCode: "1", RtnMsg: "成功", TradeAmt: "666" }), "first"), "1|OK");
  assert.equal(order(partNo).status, "paid");
  const c = await call(course, { token: "tok-new" });
  const open = c.body.slots.filter((s) => s.unlocked).map((s) => `${s.host}${s.part}`).sort();
  assert.deepEqual(open, ["CCC2", "X2"]);
  assert.equal((await call(videosApi, { token: "tok-new", query: { id: "3" } })).statusCode, 200);
  assert.equal((await call(videosApi, { token: "tok-new", query: { id: "2" } })).statusCode, 403);
  assert.equal((await call(payApi, { method: "POST", token: "tok-new", body: { item: "part", part: 2 } })).statusCode, 409);
});
await test("單集付款失敗：不打開", async () => {
  const r = await call(payApi, { method: "POST", token: "tok-new", body: { item: "part", part: 3 } });
  const no = r.body.fields.MerchantTradeNo;
  await handleNotify(await ecpayPost({ MerchantTradeNo: no, RtnCode: "10100058", RtnMsg: "授權失敗", TradeAmt: "666" }), "first");
  assert.equal(order(no).status, "failed");
  assert.deepEqual((await call(payApi, { token: "tok-new" })).body.owned, [2]);
});

await test("取消續扣：通知綠界停掉，狀態 canceled，月費照用到期滿", async () => {
  ecpayCalls.length = 0;
  const r = await call(payApi, { method: "DELETE", token: "tok-new" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(ecpayCalls[0].Action, "Cancel"); assert.equal(ecpayCalls[0].MerchantTradeNo, monthlyNo);
  assert.equal(order(monthlyNo).status, "canceled");
  assert.equal((await call(me, { token: "tok-new" })).body.tier, 2);
  assert.equal((await call(payApi, { method: "DELETE", token: "tok-new" })).statusCode, 404);
});
await test("到期（排程 sweep）：結束、拿掉 Discord 身分組、回到第一級；買的集數還在", async () => {
  discordCalls.length = 0;
  const end = order(monthlyNo).paid_until;
  const r = await sweep(addDays(end, 1));
  assert.equal(r.ended, 1);
  assert.equal(order(monthlyNo).status, "ended");
  assert.ok(discordCalls.some((c) => c.startsWith("DELETE /guilds/900000000000000001/members/800000000000000001/roles/")), discordCalls.join("\n"));
  const st = await memberPaid(db.members[0], addDays(end, 1));
  assert.equal(st.tier, 1); assert.deepEqual(st.paid.parts, [2]);
});
await test("扣款失敗：past_due，到期後還有 3 天寬限；寬限過了 sweep 結束並停掉綠界續扣", async () => {
  const r = await call(payApi, { method: "POST", token: "tok-new", body: { item: "monthly" } });
  const no = r.body.fields.MerchantTradeNo;
  await handleNotify(await ecpayPost({ MerchantTradeNo: no, RtnCode: "1", RtnMsg: "成功", TradeAmt: "66" }), "first");
  const until = order(no).paid_until;
  await handleNotify(await ecpayPost({ MerchantTradeNo: no, RtnCode: "10100050", RtnMsg: "額度不足", Amount: "66", TotalSuccessTimes: "1" }), "period");
  assert.equal(order(no).status, "past_due");
  assert.equal((await memberPaid(db.members[0], addDays(until, 3))).tier, 2, "寬限內");
  assert.equal((await sweep(addDays(until, 3))).ended, 0);
  ecpayCalls.length = 0;
  assert.equal((await sweep(addDays(until, 4))).ended, 1);
  assert.equal(ecpayCalls[0]?.Action, "Cancel");
  assert.equal((await memberPaid(db.members[0], addDays(until, 4))).tier, 1);
});

await test("後台：設定（價格、日期）、不能沒填金鑰就切正式", async () => {
  let r = await call(adminPay, { route: "admin/pay" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.cfg.mode, "test"); assert.equal(r.body.liveReady, false);
  assert.ok(r.body.orders.length >= 3);
  r = await call(adminPay, { route: "admin/pay", method: "PUT", body: { mode: "live" } });
  assert.equal(r.statusCode, 400);
  r = await call(adminPay, { route: "admin/pay", method: "PUT", body: { monthly: 99, part: 700 } });
  assert.equal(r.body.cfg.monthly, 99);
  r = await call(adminPay, { route: "admin/pay", method: "PUT", body: { legacyUntil: addDays(PAID_FROM, -1) } });
  assert.equal(r.statusCode, 400, "照舊的日期不能早於開始日");
  r = await call(adminPay, { route: "admin/pay", method: "PUT", body: { monthly: 66, part: 666 } });
  assert.equal(r.body.cfg.part, 666);
  const noAuth = await call(adminPay, { route: "admin/pay", token: "tok-new" });
  assert.equal(noAuth.statusCode, 403);
});
await test("後台手動給：月費 2 個月（給身分組）、開第 5 集；收回", async () => {
  discordCalls.length = 0;
  let r = await call(adminPay, { route: "admin/pay", method: "POST", body: { email: "new@example.com", kind: "monthly", months: 2 } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal((await memberPaid(db.members[0])).tier, 2);
  assert.ok(discordCalls.some((c) => c.startsWith("PUT /guilds/")));
  r = await call(adminPay, { route: "admin/pay", method: "POST", body: { email: "new@example.com", kind: "part", part: 5 } });
  assert.deepEqual((await memberPaid(db.members[0])).paid.parts, [2, 5]);
  const g = db.pay_orders.find((o) => o.mode === "grant" && o.kind === "part");
  r = await call(adminPay, { route: "admin/pay", method: "PATCH", body: { tradeNo: g.trade_no, action: "revoke" } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual((await memberPaid(db.members[0])).paid.parts, [2]);
  r = await call(adminPay, { route: "admin/pay", method: "POST", body: { email: "nobody@example.com", kind: "part", part: 1 } });
  assert.equal(r.statusCode, 404);
});
await test("切到正式模式後：測試的訂單不算", async () => {
  const cfg = db.settings.find((s) => s.key === "pay").value;
  cfg.mode = "live";
  const st = await memberPaid(db.members[0]);
  assert.deepEqual(st.paid.parts, [], "測試買的第 2 集不算");
  assert.equal(st.tier, 2, "手動給的月費還算");
  cfg.mode = "test";
});
await test("註冊：付費制開始後不用實驗室密碼、不用交易所", async () => {
  const r = await call(register, { method: "POST", body: { email: "fresh@example.com", password: "12345678" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const m = db.members.find((x) => x.email === "fresh@example.com");
  assert.equal(m.invite_code, null);
  const cfg = db.settings.find((s) => s.key === "pay").value;
  const keep = cfg.paidFrom; cfg.paidFrom = null;
  const r2 = await call(register, { method: "POST", body: { email: "fresh2@example.com", password: "12345678" } });
  assert.equal(r2.statusCode, 400, "還沒開始付費制：一樣要實驗室密碼");
  cfg.paidFrom = keep;
});
await test("對外：/api/public-membership 給付費制開了沒和價格", async () => {
  const r = await call(publicMembership, { token: "" });
  assert.equal(r.body.pay.on, true); assert.equal(r.body.pay.monthly, 66); assert.equal(r.body.pay.part, 666); assert.equal(r.body.pay.open, true);
});

console.log(`\n${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
