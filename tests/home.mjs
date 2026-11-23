// 2026-11-23 起介紹網站（/）和實驗室培訓房（/lab）分開：首頁永遠是介紹頁；/lab、/login 給培訓房；首頁帶參數轉到 /lab
import assert from "node:assert/strict";
import { onRequestGet as home } from "../functions/index.js";
import { onRequestGet as lab } from "../functions/lab.js";
import { onRequestGet as login } from "../functions/login.js";

let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); } }
const asked = [];
const env = { ASSETS: { fetch: async (u) => { asked.push(new URL(u).pathname); return new Response(new URL(u).pathname === "/start/" ? "LANDING" : "APP", { headers: { "content-type": "text/html" } }); } } };
const req = (url, cookie) => new Request(url, { headers: cookie ? { cookie } : {} });

await test("首頁 → 介紹頁", async () => {
  assert.equal(await (await home({ request: req("https://x.dev/"), env })).text(), "LANDING");
});
await test("登入過（舊的 ccc_in 旗標）也是介紹頁", async () => {
  assert.equal(await (await home({ request: req("https://x.dev/", "ccc_in=1"), env })).text(), "LANDING");
});
await test("首頁帶參數（邀請碼、後台登入回來）→ 轉到 /lab，參數帶著", async () => {
  const r = await home({ request: req("https://x.dev/?invite=ABC"), env });
  assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "https://x.dev/lab?invite=ABC");
  assert.equal((await home({ request: req("https://x.dev/?next=admin"), env })).headers.get("location"), "https://x.dev/lab?next=admin");
});
await test("/lab、/login → 培訓房的 index.html", async () => {
  asked.length = 0;
  assert.equal(await (await lab({ request: req("https://x.dev/lab"), env })).text(), "APP");
  assert.equal(await (await login({ request: req("https://x.dev/login"), env })).text(), "APP");
  assert.deepEqual(asked, ["/", "/"]);
});
console.log(`\n${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
