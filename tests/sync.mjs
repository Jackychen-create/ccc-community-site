// 自動同步交易量（每人一輪）：用假的 Supabase、BingX、Bybit 跑真的 server/lib 程式
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { syncBingx } from "../server/lib/bingx-sync.js";
import { syncBybit } from "../server/lib/bybit-sync.js";
import { periodOf, nextPeriod, addDays } from "../public/assets/js/shared/rules.js";
import { todayTW } from "../server/lib/dates.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readJson = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : null); } catch { r(null); } }); });

// ── 假的 Supabase（PostgREST）──
const db = { members: [], exchange_links: [], volumes: [], settings: [{ key: "volume_threshold", value: 1000000 }] };
const writes = [];
function parseFilters(sp) {
  return [...sp].filter(([k]) => !["select", "order", "limit", "on_conflict", "columns"].includes(k)).map(([col, v]) => {
    const i = v.indexOf(".");
    return { col, op: v.slice(0, i), val: v.slice(i + 1) };
  });
}
const match = (row, fs) => fs.every(({ col, op, val }) => {
  const x = row[col] == null ? null : String(row[col]);
  if (op === "eq") return x === val;
  if (op === "neq") return x !== val;
  if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(x);
  if (op === "gte") return x !== null && x >= val;
  if (op === "lte") return x !== null && x <= val;
  return true;
});
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const table = u.pathname.split("/").pop();
  const rows = db[table];
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? data[0] ?? null : data)); };
  if (!rows) return send([], 404);
  const fs = parseFilters(u.searchParams);
  if (req.method === "GET") return send(rows.filter((r) => match(r, fs)));
  const body = await readJson(req);
  if (req.method === "POST") {
    const conflict = (u.searchParams.get("on_conflict") || (table === "settings" ? "key" : "")).split(",").filter(Boolean);
    const out = [];
    for (const it of Array.isArray(body) ? body : [body]) {
      const i = conflict.length ? rows.findIndex((r) => conflict.every((c) => String(r[c]) === String(it[c]))) : -1;
      if (i >= 0) rows[i] = { ...rows[i], ...it }; else rows.push({ ...it });
      out.push(it);
      writes.push({ table, row: it });
    }
    return send(out, 201);
  }
  if (req.method === "PATCH") {
    const hit = rows.filter((r) => match(r, fs));
    for (const r of hit) Object.assign(r, body);
    writes.push({ table, patch: body, n: hit.length });
    return send(hit);
  }
  send([], 405);
});

// ── 假的 BingX：每天的明細 ──
let bingxRows = [];
const bingx = http.createServer((req, res) => {
  const sp = new URL(req.url, "http://x").searchParams;
  const s = sp.get("startTime"), e = sp.get("endTime"), uid = sp.get("uid");
  const ymd = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10).replaceAll("-", "");
  const list = bingxRows.filter((r) => ymd(r.commissionTime) >= s && ymd(r.commissionTime) <= e && (!uid || String(r.uid) === uid));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ code: 0, data: { list, total: list.length } }));
});
// ── 假的 Bybit：一段期間的加總 ──
let bybitVol = {}; // uid → (start,end) → tradeVol
const bybitQueries = [];
const bybit = http.createServer((req, res) => {
  const sp = new URL(req.url, "http://x").searchParams;
  const s = sp.get("startDate"), e = sp.get("endDate");
  bybitQueries.push(`${s}:${e}`);
  const list = Object.entries(bybitVol).map(([userId, f]) => ({ userId, tradeVol: String(f(s, e)) }));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ retCode: 0, retMsg: "OK", result: { list, nextPageCursor: "" } }));
});

const [SUPA, BX, BY] = await Promise.all([listen(supa), listen(bingx), listen(bybit)]);
setEnv({
  SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test",
  BINGX_API_KEY: "k", BINGX_SECRET_KEY: "s", BINGX_BASE_URL: BX,
  BYBIT_API_KEY: "k", BYBIT_SECRET_KEY: "s", BYBIT_BASE_URL: BY,
});
if (!globalThis.WebSocket) globalThis.WebSocket = class {};

const today = todayTW();
// 台灣某天中午的時間戳記
const at = (d) => Date.parse(d + "T04:00:00Z");
const member = (id, joined, access) => ({ user_id: id, created_at: new Date(at(joined)).toISOString(), access_until: access });
const vol = (id) => db.volumes.filter((v) => v.user_id === id);

// A：5 天前加入，BingX 第 3 天累計超過 100 萬 → 達標日是那天，看到下一輪結束
const aJoin = addDays(today, -5);
const aP = periodOf(aJoin, today);
db.members.push(member("u-a", aJoin, aP.end));
db.exchange_links.push({ user_id: "u-a", exchange: "BingX", exchange_uid: "88880001" });
bingxRows = [
  { uid: 88880001, commissionTime: at(addDays(aJoin, -1)), tradingVolume: "900000" }, // 加入前的不算
  { uid: 88880001, commissionTime: at(addDays(aJoin, 1)), tradingVolume: "400000" },
  { uid: 88880001, commissionTime: at(addDays(aJoin, 2)), tradingVolume: "300000" },
  { uid: 88880001, commissionTime: at(addDays(aJoin, 3)), tradingVolume: "350000" },
  { uid: 99990000, commissionTime: at(addDays(aJoin, 1)), tradingVolume: "5000000" }, // 別人的不算
];
await test("BingX：只算這一輪、這個人的交易量，累計第一次過門檻那天是達標日", async () => {
  const r = await syncBingx();
  assert.equal(r.saved, 1);
  const [v] = vol("u-a");
  assert.equal(v.period_start, aJoin);
  assert.equal(v.period_end, aP.end);
  assert.equal(v.amounts.BingX, 1050000);
  assert.equal(v.qualified_at, addDays(aJoin, 3));
});
await test("BingX：達標就延長到下一輪結束", () => assert.equal(db.members.find((m) => m.user_id === "u-a").access_until, nextPeriod(aJoin, aP).end));
await test("再同步一次，數字沒變就不重寫、不再延", async () => {
  const before = writes.length;
  const r = await syncBingx();
  assert.equal(r.saved, 0); assert.equal(r.extended, 0);
  assert.equal(writes.length, before);
});

// B：3 天前加入，Bybit 1.5M → 達標日記昨天
const bJoin = addDays(today, -3);
const bP = periodOf(bJoin, today);
db.members.push(member("u-b", bJoin, bP.end));
db.exchange_links.push({ user_id: "u-b", exchange: "Bybit", exchange_uid: "77770001" });
// C：今天才加入，Bybit 還沒有資料 → 不寫
db.members.push(member("u-c", today, periodOf(today, today).end));
db.exchange_links.push({ user_id: "u-c", exchange: "Bybit", exchange_uid: "77770002" });
// D：一個月又 1 天前加入，上一輪（剛結束）達標 → 延長到這一輪結束；這一輪還沒達標
// 找一個加入日，讓「這一輪」昨天才開始（上一輪前天結束）
const dJoinFixed = (() => { let j = addDays(today, -27); for (let i = 0; i < 10; i++, j = addDays(j, -1)) { const p = periodOf(j, today); if (p.index === 1 && p.start === addDays(today, -1)) return j; } throw new Error("找不到測試用的加入日"); })();
const dCur = periodOf(dJoinFixed, today);
db.members.push(member("u-d", dJoinFixed, addDays(today, -2)));
db.exchange_links.push({ user_id: "u-d", exchange: "Bybit", exchange_uid: "77770003" });
bybitVol = {
  "77770001": (s, e) => (s === bJoin ? 1500000 : 0),
  "77770002": () => 9999999,
  "77770003": (s, e) => (s === dJoinFixed ? 2000000 : 10),
};
await test("Bybit：查這一輪第一天到昨天，達標日記昨天、延長到下一輪結束", async () => {
  await syncBybit();
  const [v] = vol("u-b");
  assert.equal(v.amounts.Bybit, 1500000);
  assert.equal(v.qualified_at, addDays(today, -1));
  assert.equal(db.members.find((m) => m.user_id === "u-b").access_until, nextPeriod(bJoin, bP).end);
  assert.ok(bybitQueries.includes(`${bJoin}:${addDays(today, -1)}`), bybitQueries.join(","));
});
await test("Bybit：今天才加入的人，還沒有資料就不寫", () => assert.equal(vol("u-c").length, 0));
await test("上一輪剛結束：補同步上一輪，達標就延長到這一輪結束（已經過期的也會恢復）", () => {
  const prev = vol("u-d").find((v) => v.period_start === dJoinFixed);
  assert.ok(prev, "沒有寫上一輪");
  assert.equal(prev.period_end, addDays(today, -2));
  assert.equal(prev.qualified_at, prev.period_end); // Bybit 查到上一輪最後一天
  assert.equal(db.members.find((m) => m.user_id === "u-d").access_until, dCur.end);
});
await test("這一輪還沒達標：記數字、不延長", () => {
  const cur = vol("u-d").find((v) => v.period_start === dCur.start);
  // 這一輪今天才第 2 天，Bybit 給到昨天：有資料就記
  if (cur) { assert.equal(cur.qualified_at, null); }
  assert.equal(db.members.find((m) => m.user_id === "u-d").access_until, dCur.end);
});
await test("「不限」的研究員達標也不會被改成有期限", async () => {
  db.members.push(member("u-e", bJoin, null));
  db.exchange_links.push({ user_id: "u-e", exchange: "Bybit", exchange_uid: "77770004" });
  bybitVol["77770004"] = () => 5000000;
  await syncBybit({ uid: "77770004" });
  assert.equal(db.members.find((m) => m.user_id === "u-e").access_until, null);
  assert.ok(vol("u-e")[0].qualified_at);
});

supa.close(); bingx.close(); bybit.close();
console.log(`\n自動同步：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
