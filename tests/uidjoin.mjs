// v1.34.0：在網站用交易所 UID 直接加入（不用實驗室密碼）
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import register from "../server/register.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readJson = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "null")); } catch { r(null); } }); });

const db = { members: [], exchange_links: [], uid_join_attempts: [], okx_snapshots: [], volumes: [], invite_codes: [], settings: [{ key: "discord", value: { invites: { OKX: "https://okx.com/join/99357363" } } }] };
const users = [];
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (d, s = 200, extra = {}) => { res.writeHead(s, { "Content-Type": "application/json", ...extra }); res.end(JSON.stringify(d)); };
  if (u.pathname === "/auth/v1/admin/users" && req.method === "POST") {
    const b = await readJson(req);
    if (users.some((x) => x.email === b.email)) return send({ msg: "User already registered" }, 422);
    const user = { id: `00000000-0000-4000-8000-${String(users.length + 1).padStart(12, "0")}`, email: b.email };
    users.push(user);
    return send(user);
  }
  if (u.pathname.startsWith("/auth/v1/admin/users/")) return send({});
  if (u.pathname.startsWith("/rest/v1/rpc/")) return send(null);
  const table = u.pathname.split("/").pop();
  const rows = db[table];
  if (!rows) return send([], 404);
  const filt = [...u.searchParams].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
  const match = (r) => filt.every(([k, v]) => {
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    if (op === "eq") return String(r[k]) === val;
    if (op === "gte") return String(r[k]) >= val;
    return true;
  });
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  if (req.method === "HEAD") { const n = rows.filter(match).length; res.writeHead(200, { "Content-Range": `0-${Math.max(0, n - 1)}/${n}` }); return res.end(); }
  if (req.method === "GET") { const out = rows.filter(match); return send(one ? out[0] ?? null : out); }
  if (req.method === "POST") { const b = await readJson(req); for (const it of [].concat(b)) rows.push({ at: new Date().toISOString(), ...it }); return send(b, 201); }
  return send([]);
});
// 假的 OKX：1001 是 CCC 邀請的，1002 是別人邀請的，其他不是推薦的人
const okx = http.createServer((req, res) => {
  const uid = new URL(req.url, "http://x").searchParams.get("uid");
  const data = uid === "817018337355330001" ? [{ affiliateCode: "99357363", totalVol: "500", joinTime: String(Date.now()) }] : uid === "817018337355330002" ? [{ affiliateCode: "OTHER", totalVol: "1" }] : [];
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data.length ? { code: "0", data } : { code: "51621", msg: "not invitee", data: [] }));
});
const SUPA = await listen(supa), OKX = await listen(okx);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "x", OKX_API_KEY: "k", OKX_SECRET_KEY: "s", OKX_PASSPHRASE: "p", OKX_BASE_URL: OKX, ADMIN_EMAILS: "boss@example.com" });

const call = async (body, ip = "1.2.3.4") => {
  const out = { headers: {} };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status: (c) => ((out.statusCode = c), res), json: (b) => ((out.body = b), res), end: () => res };
  await register({ method: "POST", headers: { "cf-connecting-ip": ip }, body, query: {} }, res);
  return out;
};

await test("沒有實驗室密碼：OKX UID 是 CCC 邀請的 → 直接加入、記下 UID", async () => {
  const r = await call({ email: "a@example.com", password: "12345678", exchange: "OKX", uid: "817018337355330001" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const m = db.members.find((x) => x.email === "a@example.com");
  assert.equal(m.invite_code, null);
  assert.ok(db.exchange_links.some((l) => l.exchange === "OKX" && l.exchange_uid === "817018337355330001"));
});
await test("別人邀請的、不是推薦的 UID：不能加入", async () => {
  assert.equal((await call({ email: "b@example.com", password: "12345678", exchange: "OKX", uid: "817018337355330002" })).statusCode, 400);
  const r = await call({ email: "c@example.com", password: "12345678", exchange: "OKX", uid: "817018337355339999" });
  assert.equal(r.body.code, "not_invited");
});
await test("同一個 UID 不能用兩次", async () => {
  assert.equal((await call({ email: "d@example.com", password: "12345678", exchange: "OKX", uid: "817018337355330001" })).statusCode, 409);
});
await test("沒填交易所：要選交易所", async () => {
  const r = await call({ email: "e@example.com", password: "12345678" });
  assert.equal(r.statusCode, 400); assert.match(r.body.error, /交易所/);
});
await test("API 沒設定的交易所（BingX）：不能直接加入，請他到 Discord", async () => {
  const r = await call({ email: "f@example.com", password: "12345678", exchange: "BingX", uid: "123456" });
  assert.equal(r.statusCode, 400); assert.match(r.body.error, /Discord/);
});
await test("同一個 IP 一小時最多試 10 次", async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await call({ email: `t${i}@example.com`, password: "12345678", exchange: "OKX", uid: String(817018337355340000 + i * 7) }, "9.9.9.9");
  assert.equal(last.statusCode, 429);
  assert.ok(db.uid_join_attempts.every((x) => !String(x.ip_hash).includes("9.9.9.9")), "不存原始 IP");
});

supa.close(); okx.close();
console.log(`\nUID 直接加入：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
