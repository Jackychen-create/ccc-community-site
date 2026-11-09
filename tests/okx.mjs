// v1.26.30：OKX 推薦人 API（簽名、確認是不是 CCC 邀請的、一輪交易量怎麼算）
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { okxSign, checkOkxClient, okxInviteCode, okxGet } from "../server/lib/okx.js";
import { okxPeriodVolume } from "../server/lib/okx-sync.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const seen = [];
const okx = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  seen.push({ path: u.pathname + u.search, h: req.headers });
  const send = (d) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
  // 簽名要對：base64(HMAC-SHA256(secret, 時間 + GET + 路徑含查詢))
  const want = await okxSign("sec", `${req.headers["ok-access-timestamp"]}GET${u.pathname}${u.search}`);
  if (req.headers["ok-access-sign"] !== want || req.headers["ok-access-passphrase"] !== "pp") return send({ code: "50113", msg: "Invalid Sign", data: [] });
  const uid = u.searchParams.get("uid");
  if (uid === "1001") return send({ code: "0", msg: "", data: [{ affiliateCode: "99357363", totalVol: "12345.6", joinTime: "1789268404000", volMonth: "0" }] });
  if (uid === "1002") return send({ code: "0", msg: "", data: [{ affiliateCode: "OTHER", totalVol: "1", joinTime: "1789268404000" }] });
  if (uid === "1003") return send({ code: "50011", msg: "Too Many Requests", data: [] });
  return send({ code: "51621", msg: "The user isn't your invitee", data: [] });
});
const OKX = await listen(okx);
setEnv({ SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "x", OKX_API_KEY: "key", OKX_SECRET_KEY: "sec", OKX_PASSPHRASE: "pp", OKX_BASE_URL: OKX });

await test("簽名、標頭正確（時間是 ISO 格式）", async () => {
  const d = await okxGet("/api/v5/affiliate/invitee/detail", { uid: "1001" });
  assert.equal(d[0].totalVol, "12345.6");
  const h = seen.at(-1).h;
  assert.equal(h["ok-access-key"], "key");
  assert.match(h["ok-access-timestamp"], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});
await test("CCC 的邀請碼從邀請連結拿", () => {
  assert.equal(okxInviteCode("https://okx.com/join/99357363"), "99357363");
  assert.equal(okxInviteCode(""), "");
});
await test("確認 UID：CCC 邀請的 → 是；別的邀請碼 → 不是；不是推薦的人 → 不是", async () => {
  const a = await checkOkxClient("1001", { code: "99357363" });
  assert.equal(a.invited, true); assert.equal(a.totalVol, 12345.6);
  assert.equal((await checkOkxClient("1002", { code: "99357363" })).invited, false);
  assert.equal((await checkOkxClient("1099", { code: "99357363" })).invited, false);
});
await test("限流、Key 錯誤這類 50xxx 不當成「不是」，丟出去讓管理員確認", async () => {
  await assert.rejects(checkOkxClient("1003"));
});
await test("一輪交易量：今天累計－這一輪開始那天的累計", () => {
  const list = [{ day: "2026-11-01", total_vol: 1000 }, { day: "2026-11-05", total_vol: 1500 }, { day: "2026-11-10", total_vol: 4000 }];
  assert.equal(okxPeriodVolume({ list, totalVol: 4000, from: "2026-11-05", end: "2026-12-04", today: "2026-11-10" }), 2500);
  assert.equal(okxPeriodVolume({ list, totalVol: 4000, from: "2026-11-03", end: "2026-12-02", today: "2026-11-10" }), 3000); // 開始那天沒記到：用之前最近一天
});
await test("這一輪開始之後才註冊 OKX：起點是 0；對不到起點：不動（null）", () => {
  assert.equal(okxPeriodVolume({ list: [], totalVol: 800, joinDay: "2026-11-06", from: "2026-11-05", end: "2026-12-04", today: "2026-11-10" }), 800);
  assert.equal(okxPeriodVolume({ list: [{ day: "2026-11-10", total_vol: 800 }], totalVol: 800, joinDay: "2026-01-01", from: "2026-11-05", end: "2026-12-04", today: "2026-11-10" }), null);
});
await test("第一筆交易在這一輪開始之後、或累計是 0：不用等快照，起點是 0", () => {
  assert.equal(okxPeriodVolume({ list: [], totalVol: 207688.48, joinDay: "2026-10-16", firstTradeDay: "2026-10-20", from: "2026-10-17", end: "2026-11-16", today: "2026-11-10" }), 207688.48);
  assert.equal(okxPeriodVolume({ list: [], totalVol: 0, joinDay: "2026-09-12", from: "2026-10-17", end: "2026-11-16", today: "2026-11-10" }), 0);
  assert.equal(okxPeriodVolume({ list: [], totalVol: 10, joinDay: "2026-09-12", firstTradeDay: "2026-10-01", from: "2026-10-17", end: "2026-11-16", today: "2026-11-10" }), null);
});
await test("上一輪（已經結束）：終點用結束那天之後最近一天的累計", () => {
  const list = [{ day: "2026-10-05", total_vol: 100 }, { day: "2026-11-04", total_vol: 900 }, { day: "2026-11-10", total_vol: 2000 }];
  assert.equal(okxPeriodVolume({ list, totalVol: 2000, from: "2026-10-05", end: "2026-11-04", today: "2026-11-10" }), 800);
});

okx.close();
console.log(`\nOKX：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
