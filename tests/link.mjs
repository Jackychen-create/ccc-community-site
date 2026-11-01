// v1.26.21：研究員自己連結 Discord 帳號（一次性連結、過期、用過、一個 Discord 只能連一個帳號、私訊先用自己連的）
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { createLinkToken, redeemLinkToken, linkedOf, unlink, linkPanelMessage, LINK_BUTTON_ID } from "../server/lib/discord-link.js";
import { discordIds } from "../server/lib/milestone.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c).toString())); });

const db = { discord_link_tokens: [], member_discord: [], discord_applications: [{ discord_user_id: "333333333333333301", invite_code: "OLD-1", status: "approved" }], exchange_links: [] };
const cmp = (a, b) => (/^\d{4}-\d\d-\d\dT/.test(b) ? Date.parse(a) - Date.parse(b) : String(a).localeCompare(b));
const filt = (rows, sp) => {
  for (const [k, v] of sp) {
    if (["select", "order", "limit", "on_conflict", "columns"].includes(k)) continue;
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    if (op === "eq") rows = rows.filter((r) => String(r[k]) === val);
    if (op === "is") rows = rows.filter((r) => (val === "null" ? r[k] == null : true));
    if (op === "gt") rows = rows.filter((r) => r[k] != null && cmp(r[k], val) > 0);
    if (op === "lt") rows = rows.filter((r) => r[k] != null && cmp(r[k], val) < 0);
    if (op === "in") { const list = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")); rows = rows.filter((r) => list.includes(String(r[k]))); }
  }
  return rows;
};
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const t = u.pathname.split("/").pop();
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? d[0] ?? null : d)); };
  const hit = filt(db[t], u.searchParams);
  if (req.method === "GET") return send(hit);
  if (req.method === "DELETE") { db[t] = db[t].filter((r) => !hit.includes(r)); return send(hit); }
  const body = JSON.parse((await readBody(req)) || "null");
  if (req.method === "PATCH") { for (const r of hit) Object.assign(r, body); return send(hit); }
  // POST（insert / upsert）
  for (const it of Array.isArray(body) ? body : [body]) {
    if (t === "member_discord") {
      if (db[t].some((r) => r.discord_user_id === it.discord_user_id && r.user_id !== it.user_id)) { res.writeHead(409, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ code: "23505" })); }
      const i = db[t].findIndex((r) => r.user_id === it.user_id);
      if (i >= 0) db[t][i] = { ...db[t][i], ...it }; else db[t].push(it);
    } else db[t].push({ used_at: null, created_at: new Date().toISOString(), ...it });
  }
  return send(Array.isArray(body) ? body : [body], 201);
});
const SUPA = await listen(supa);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test" });

const A = "333333333333333301", B = "333333333333333302";
await test("Discord 那則有「連結網站帳號」按鈕", () => {
  const m = linkPanelMessage();
  assert.equal(m.components[0].components[0].custom_id, LINK_BUTTON_ID);
});
await test("按按鈕：開一個 15 分鐘的一次性連結", async () => {
  const { token, url } = await createLinkToken(A, "amy_dc");
  assert.match(token, /^[0-9a-f]{48}$/);
  assert.ok(url.endsWith(`#/link-discord?t=${token}`));
  const row = db.discord_link_tokens.find((r) => r.token === token);
  assert.ok(Math.abs(Date.parse(row.expires_at) - Date.now() - 15 * 60e3) < 5000);
});
await test("打開連結：連好；同一個連結不能再用", async () => {
  const { token } = await createLinkToken(A, "amy_dc");
  const r = await redeemLinkToken("user-1", token);
  assert.deepEqual(r, { ok: true, name: "amy_dc" });
  assert.equal((await linkedOf("user-1")).discord_user_id, A);
  assert.equal((await redeemLinkToken("user-1", token)).status, 410);
});
await test("過期的、亂打的連結不行", async () => {
  const { token } = await createLinkToken(B, "bob", Date.now() - 20 * 60e3);
  assert.equal((await redeemLinkToken("user-2", token)).status, 410);
  assert.equal((await redeemLinkToken("user-2", "../../etc")).status, 400);
});
await test("一個 Discord 帳號只能連一個網站帳號", async () => {
  const { token } = await createLinkToken(A, "amy_dc");
  const r = await redeemLinkToken("user-2", token);
  assert.equal(r.status, 409);
  assert.equal(await linkedOf("user-2"), null);
});
await test("換一個 Discord 帳號：蓋掉舊的", async () => {
  const { token } = await createLinkToken(B, "amy_alt");
  assert.equal((await redeemLinkToken("user-1", token)).ok, true);
  assert.equal((await linkedOf("user-1")).discord_user_id, B);
  assert.equal(db.member_discord.length, 1);
});
await test("助教私訊找人：自己連的優先，蓋過報名時的帳號", async () => {
  const memBy = new Map([["user-1", { invite_code: "OLD-1" }], ["user-3", { invite_code: "OLD-1" }]]);
  const m = await discordIds(["user-1", "user-3"], memBy);
  assert.equal(m.get("user-1"), B); // 自己連的
  assert.equal(m.get("user-3"), A); // 沒連：照舊用實驗室密碼對
});
await test("解除連結", async () => {
  await unlink("user-1");
  assert.equal(await linkedOf("user-1"), null);
});
await test("一天前的舊連結會清掉", async () => {
  db.discord_link_tokens.push({ token: "x".repeat(48), discord_user_id: A, expires_at: new Date(Date.now() - 2 * 86400e3).toISOString(), created_at: new Date(Date.now() - 2 * 86400e3).toISOString(), used_at: null });
  await createLinkToken(A, "amy_dc");
  assert.ok(!db.discord_link_tokens.some((r) => r.token === "x".repeat(48)));
});

console.log(`\n${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
