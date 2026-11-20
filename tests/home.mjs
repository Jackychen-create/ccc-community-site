// 合併網站（2026-11-20）：首頁「/」沒登入給介紹頁、登入了給研究員專區；/login 一律給研究員專區
import assert from "node:assert/strict";
import { onRequestGet as home } from "../functions/index.js";
import { onRequestGet as login } from "../functions/login.js";

let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); } }
const asked = [];
const env = { ASSETS: { fetch: async (u) => { asked.push(new URL(u).pathname); return new Response(new URL(u).pathname === "/start/" ? "LANDING" : "APP", { headers: { "content-type": "text/html" } }); } } };
const next = async () => new Response("APP", { headers: { "content-type": "text/html" } });
const req = (url, cookie) => new Request(url, { headers: cookie ? { cookie } : {} });

await test("沒登入（沒有旗標）→ 介紹頁，網址還是 /", async () => {
  const r = await home({ request: req("https://x.dev/"), env, next });
  assert.equal(await r.text(), "LANDING"); assert.equal(r.headers.get("vary"), "Cookie");
});
await test("有登入旗標 → 研究員專區", async () => {
  assert.equal(await (await home({ request: req("https://x.dev/", "a=1; ccc_in=1"), env, next })).text(), "APP");
});
await test("旗標是 0 或別的名字 → 還是介紹頁", async () => {
  assert.equal(await (await home({ request: req("https://x.dev/", "ccc_in=0; xccc_in=1"), env, next })).text(), "LANDING");
});
await test("網址帶參數（邀請碼、後台登入回來）→ 研究員專區", async () => {
  assert.equal(await (await home({ request: req("https://x.dev/?invite=ABC"), env, next })).text(), "APP");
  assert.equal(await (await home({ request: req("https://x.dev/?next=admin"), env, next })).text(), "APP");
});
await test("/login → 研究員專區的 index.html", async () => {
  asked.length = 0;
  assert.equal(await (await login({ request: req("https://x.dev/login"), env })).text(), "APP");
  assert.deepEqual(asked, ["/"]);
});
console.log(`\n${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
