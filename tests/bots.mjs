// 機器人（Supabase Edge Function「bots」）：用真實格式的資料（tests/fixtures/bots，從官方 API 截下來的一小段）跑一遍
// 外部網址全部換成假的回應；資料庫用記憶體；Webhook 收到什麼都記下來
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeDb, rocToDate, num, WEBHOOK_RE, postWebhook } from "../supabase/functions/bots/core.js";
import { parseFeed } from "../supabase/functions/bots/rss.js";
import { parseTwse, parseTpex, parseInstitutions, holidaysFrom, updateHistory, technicals, scoreDisclosure, pickNews, parseFlows, updateStreaks, isCommon } from "../supabase/functions/bots/tw.js";
import { isDue, BOTS } from "../supabase/functions/bots/registry.js";
import { RUNNERS } from "../supabase/functions/bots/runners.js";
import { runBot, dueBots } from "../supabase/functions/bots/engine.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + (e?.stack || e).toString().split("\n").slice(0, 3).join(" ")); }
}
const fx = (f) => fs.readFileSync(new URL(`./fixtures/bots/${f}`, import.meta.url), "utf8");
const fxj = (f) => JSON.parse(fx(f));

// ── 假的外部網站 ──
const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF";
const posts = [];
let routes = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://discord.com/api/webhooks/")) {
    const q = new URL(u).searchParams;
    posts.push({ url: u.split("?")[0], thread: q.get("thread_id"), body: JSON.parse(init.body) });
    if (u.includes("deadhook")) return new Response('{"message":"Unknown Webhook"}', { status: 404 });
    return new Response('{"id":"1"}', { status: 200 });
  }
  const hit = Object.entries(routes).find(([k]) => u.includes(k));
  if (!hit) return new Response("not found", { status: 404 });
  const v = typeof hit[1] === "function" ? hit[1](u) : hit[1];
  if (v instanceof Error) throw v;
  return new Response(typeof v === "string" ? v : JSON.stringify(v), { status: 200 });
};
const TW_ROUTES = () => ({
  "afterTrading/MI_INDEX": fxj("twse_mi_index_20261021.json"),
  "fund/BFI82U": fxj("twse_bfi82u_20261021.json"),
  "fund/T86": fxj("twse_t86_20261021.json"),
  "tpex_index": fxj("tpex_index.json"),
  "tpex_mainboard_quotes": fxj("tpex_mainboard_quotes.json"),
  "tpex_3insti_daily_trading": fxj("tpex_3insti.json"),
  "t187ap04_L": fxj("twse_disclosure.json"),
  "mopsfin_t187ap04_O": fxj("tpex_disclosure.json"),
  "holidaySchedule": fxj("twse_holidays.json"),
  "rsscna/finance": fx("cna_finance.xml"),
  "tw.stock.yahoo.com/rss": fx("yahoo_tw_market.xml"),
});

// ── 記憶體資料庫（跟 makeDb 一樣的介面）──
function memDb(settings = {}) {
  const state = new Map(), runs = [];
  return {
    state, runs, settingsValue: settings,
    async getState(k, f = {}) { return state.has(k) ? structuredClone(state.get(k)) : f; },
    async setState(k, v) { state.set(k, structuredClone(v)); },
    async settings() { return this.settingsValue; },
    async logRun(bot, r) { runs.push({ bot, ...r }); },
    async req() { return null; },
  };
}
// 台灣時間 → Date
const at = (day, hm) => new Date(`${day}T${hm}:00+08:00`);
const DAY = "2026-10-21";

await test("民國日期、數字（逗號、HTML、正負號）", () => {
  assert.equal(rocToDate("1151021"), "2026-10-21");
  assert.equal(num("46,887.77"), 46887.77);
  assert.equal(num("<p style ='color:red'>+</p>"), null);
  assert.equal(num("-6,187,470,065"), -6187470065);
  assert.ok(WEBHOOK_RE.test(HOOK) && WEBHOOK_RE.test("https://discordapp.com/api/webhooks/1549977755360305183/OE2vap-TOdO9egNjyoKq") && !WEBHOOK_RE.test("https://evil.com/api/webhooks/1/2"));
});
await test("排程：週一到五 15:15 起每 5 分鐘試到 17:30；每 10 分鐘的雷達只在時段內", () => {
  const close = BOTS.find((b) => b.key === "tw_close").schedule;
  assert.equal(isDue(close, "15:15", 3), true); assert.equal(isDue(close, "16:40", 3), true);
  assert.equal(isDue(close, "15:10", 3), false); assert.equal(isDue(close, "17:30", 3), false); assert.equal(isDue(close, "15:15", 6), false);
  const disc = BOTS.find((b) => b.key === "tw_disclosure").schedule;
  assert.equal(isDue(disc, "09:10", 0), true); assert.equal(isDue(disc, "09:15", 0), false); assert.equal(isDue(disc, "23:30", 0), false);
  assert.equal(isDue({ days: "daily", at: "08:00" }, "08:00", 2), true); assert.equal(isDue({ days: "daily", at: "08:00" }, "08:05", 2), false);
  assert.ok(BOTS.every((b) => RUNNERS[b.key]), "每支都有程式");
});
await test("休市表：開始交易日、最後交易日不算休市", () => {
  const off = holidaysFrom(fxj("twse_holidays.json"));
  assert.ok(off.has("2026-01-01") && off.has("2026-10-09") && !off.has("2026-01-02"));
});
await test("證交所盤後：加權、類股（拿掉組合和反向指數）、成交值、漲跌家數、只留一般股票", () => {
  const t = parseTwse(fxj("twse_mi_index_20261021.json"));
  assert.equal(t.day, DAY);
  assert.deepEqual(t.taiex, { close: 46887.77, change: 594.84, pct: 1.28 });
  assert.deepEqual(t.sectors.map((s) => s.name).sort(), ["半導體", "生技醫療", "航運", "認", "金融保險", "鋼鐵"].filter((x) => x !== "認").sort());
  assert.equal(t.sectors.find((s) => s.name === "航運").pct, -0.24);
  assert.equal(t.value, 874614166736);
  assert.deepEqual([t.up.n, t.up.limit, t.down.n, t.down.limit, t.flat.n], [600, 24, 380, 1, 101]);
  assert.ok(!t.stocks.some((s) => s.code === "0050" || s.code === "00631L"));
  const tsmc = t.stocks.find((s) => s.code === "2330");
  assert.equal(tsmc.close, 2420); assert.ok(Math.abs(tsmc.pct - (15 / 2405) * 100) < 1e-9);
  assert.equal(t.stocks.find((s) => s.code === "2454").pct < 0, true);
  assert.equal(t.stocks.find((s) => s.code === "2002").pct, 0);
});
await test("櫃買：指數抓最新一天、漲跌幅、只留一般股票、成交值全部加總", () => {
  const p = parseTpex(fxj("tpex_index.json"), fxj("tpex_mainboard_quotes.json"));
  assert.equal(p.otc.day, DAY); assert.equal(p.otc.close, 395.42); assert.ok(Math.abs(p.otc.pct - (7.54 / 387.88) * 100) < 1e-9);
  assert.equal(p.day, DAY);
  assert.deepEqual(p.stocks.map((s) => s.code), ["6488", "5274", "8299"]);
  assert.equal(p.value, 632000 + 3050000000 + 1830000000 + 1800000000);
});
await test("三大法人：外資（含外資自營商）、投信、自營商（自行＋避險）", () => {
  const i = parseInstitutions(fxj("twse_bfi82u_20261021.json"));
  assert.deepEqual(i, { foreign: 2238909816, trust: 12798537238, dealer: -6187470065 - 7384233802, total: 1465743187 });
});
await test("技術面：不到 21 天只看高波動／漲停；滿 21 天加 MA20、20 日高、量增", () => {
  const s = { code: "1234", name: "測試", close: 100, high: 101, low: 99, vol: 3000, value: 9e9, pct: 1 };
  let h = {};
  for (let i = 0; i < 20; i++) h = updateHistory(h, `2026-09-${String(i + 1).padStart(2, "0")}`, [{ ...s, close: i === 19 ? 89 : 90 + (i % 3), vol: 1000 }]);
  let t = technicals(h, [s]);
  assert.equal(t.ready, false); assert.equal(t.list.length, 0);
  h = updateHistory(h, DAY, [s]);
  assert.equal(updateHistory(h, DAY, [s]).days.length, 21, "同一天不重複記");
  t = technicals(h, [s]);
  assert.equal(t.ready, true);
  assert.deepEqual(t.list[0].tags, ["站上 MA20", "突破 20 日高", "量增 3.0 倍"]);
  t = technicals({}, [{ ...s, high: 110, low: 100, close: 110, pct: 9.9 }]);
  assert.deepEqual(t.list[0].tags, ["高波動", "接近漲停"]);
});
await test("盤後報告：週三 15:15 發一則，內容有加權、櫃買、法人、強弱族群、熱門股、觀點；同一天不重發", async () => {
  routes = TW_ROUTES();
  const db = memDb({ outlets: [{ id: "stock", name: "股市整合", url: HOOK }], bots: { tw_close: { enabled: true, outlet: "stock", thread: "777777777777777777" } } });
  posts.length = 0;
  const r = await runBot("tw_close", { db, now: at(DAY, "15:15") });
  assert.equal(r.ok, true, r.note); assert.equal(r.posted, 1);
  assert.equal(posts.length, 1); assert.equal(posts[0].thread, "777777777777777777");
  const e = posts[0].body.embeds[0];
  assert.equal(e.title, "📋 台股盤後報告｜2026/10/21");
  const f = Object.fromEntries(e.fields.map((x) => [x.name, x.value]));
  assert.ok(f["📈 大盤"].includes("加權 46,887.77　🔺 594.84（+1.28%）") && f["📈 大盤"].includes("櫃買 395.42") && f["📈 大盤"].includes("上市 8,746 億"), f["📈 大盤"]);
  assert.ok(f["🏦 上市三大法人"].includes("外資 22.4 億") && f["🏦 上市三大法人"].includes("投信 128.0 億"), f["🏦 上市三大法人"]);
  assert.ok(f["🔥 強弱族群（上市類股）"].startsWith("強：金融保險 +2.55%"), f["🔥 強弱族群（上市類股）"]);
  assert.ok(f["🚀 漲幅前五（成交值 5000 萬以上）"].includes("環球晶（6488）"), "上櫃也算進來");
  assert.ok(!JSON.stringify(e).includes("元大台灣50"), "ETF 不放進排行");
  assert.ok(f["💡 CCC 盤後觀點"].includes("加權收紅"), f["💡 CCC 盤後觀點"]);
  assert.equal(e.color, 0xc9665d, "台股紅漲");
  const again = await runBot("tw_close", { db, now: at(DAY, "15:20") });
  assert.equal(again.skipped, true); assert.equal(posts.length, 1);
  assert.equal(db.runs.length, 1, "略過的不記");
});
await test("盤後報告：證交所還是昨天的資料 → 等一下再試（記下來）；休市日不跑", async () => {
  routes = { ...TW_ROUTES(), "afterTrading/MI_INDEX": { ...fxj("twse_mi_index_20261021.json"), tables: fxj("twse_mi_index_20261021.json").tables.map((t) => ({ ...t, title: t.title.replace("10月21日", "10月20日") })) } };
  const db = memDb({ outlets: [{ id: "s", url: HOOK }], bots: { tw_close: { enabled: true, outlet: "s" } } });
  const r = await runBot("tw_close", { db, now: at(DAY, "15:15") });
  assert.equal(r.retry, true); assert.ok(r.note.includes("還沒出來")); assert.equal(db.runs.length, 1);
  routes = TW_ROUTES();
  const h = await runBot("tw_close", { db, now: at("2026-10-09", "15:15") });
  assert.equal(h.note, "今天休市");
});
await test("預覽（dryRun）：不用設 Webhook、不貼、不改狀態", async () => {
  routes = TW_ROUTES();
  const db = memDb({});
  posts.length = 0;
  const r = await runBot("tw_close", { db, now: at(DAY, "15:15"), dryRun: true, force: true });
  assert.equal(r.ok, true, r.note); assert.equal(r.preview.length, 1); assert.equal(posts.length, 0);
  assert.equal(db.state.has("tw_close_done"), false);
});
await test("沒設 Webhook：寫清楚", async () => {
  const r = await runBot("tw_close", { db: memDb({ bots: { tw_close: { enabled: true } } }), now: at(DAY, "15:15") });
  assert.equal(r.ok, false); assert.ok(r.note.includes("Webhook"));
});
await test("出錯：記下原因、通知管理員出口（6 小時內只通知一次）", async () => {
  routes = { ...TW_ROUTES(), "afterTrading/MI_INDEX": new Error("connect timeout") };
  const db = memDb({ outlets: [{ id: "s", url: HOOK }, { id: "admin", url: HOOK.replace("abcdef", "zzzzzz") }], alertOutlet: "admin", bots: { tw_close: { enabled: true, outlet: "s" } } });
  posts.length = 0;
  const r = await runBot("tw_close", { db, now: at(DAY, "15:15") });
  assert.equal(r.ok, false); assert.ok(r.note.includes("connect timeout"));
  assert.equal(posts.length, 1); assert.ok(posts[0].body.embeds[0].title.includes("機器人出錯：台股盤後報告"));
  await runBot("tw_close", { db, now: at(DAY, "15:20") });
  assert.equal(posts.length, 1, "不重複通知");
});
await test("每日頭條：挑有關台股的、去重、拿掉不相關的；同一天只發一次", async () => {
  routes = TW_ROUTES();
  const db = memDb({ outlets: [{ id: "s", url: HOOK }], bots: { tw_news: { enabled: true, outlet: "s" } } });
  posts.length = 0;
  const r = await runBot("tw_news", { db, now: at(DAY, "21:00") });
  assert.equal(r.ok, true, r.note);
  const d = posts[0].body.embeds[0].description;
  assert.ok(d.includes("台股大漲594點") && d.includes("央行理監事會") && d.includes("關稅"), d);
  assert.ok(!d.includes("藝人婚禮") && !d.includes("公益彩券"), "不相關的不放");
  assert.equal((d.match(/台股大漲594點/g) || []).length, 1, "同一件事不同來源只放一則");
  assert.ok(d.includes("利率與貨幣政策"));
  assert.equal((await runBot("tw_news", { db, now: at(DAY, "21:05") })).skipped, true);
});
await test("頭條：同一類最多 3 則（真實資料一次來了 8 則都是外資買賣）", () => {
  const mk = (i) => ({ title: `外資買超第${i}名不同標題${i}`, link: `https://x/${i}`, ms: Date.parse("2026-10-21T10:00:00Z"), source: "Y", summary: "外資 投信 台股" });
  const pick = pickNews([...Array.from({ length: 8 }, (_, i) => mk(i)), { title: "央行宣布降息半碼", link: "https://x/c", ms: Date.parse("2026-10-21T10:00:00Z"), source: "C" }], { now: new Date("2026-10-21T12:00:00Z") });
  assert.equal(pick.filter((x) => x.title.startsWith("外資")).length, 3);
  assert.ok(pick.some((x) => x.title.includes("降息")));
});
await test("RSS：CDATA、時間、HTML 實體", () => {
  const items = parseFeed(fx("yahoo_tw_market.xml"), "Yahoo");
  assert.equal(items[0].title, "台股大漲594點！郭哲榮預告「最後買點」：第四季不做空");
  assert.equal(items[0].ms, Date.parse("Wed, 21 Oct 2026 14:29:00 GMT"));
  assert.equal(parseFeed("<rss><item><title>A &amp; B&#39;s</title><link>https://x.y/1</link></item></rss>")[0].title, "A & B's");
});
await test("重大訊息評分：更名、面額變更公告不發；合併、資安事件高分", () => {
  assert.equal(scoreDisclosure("公告本公司名稱由「世紀離岸風電設備股份有限公司」更名 為「世紀能源設備股份有限公司」，公告期間：115年8月26日至 115年11月25日。").score, 0);
  assert.ok(scoreDisclosure("本公司董事會決議與某公司進行合併").score >= 6);
  assert.ok(scoreDisclosure("本公司因資安事件遭駭客攻擊說明").score >= 6);
  // 真實資料抓到的誤判：合併財務報告不是併購、每月的負債比率公告不發
  assert.equal(scoreDisclosure("公告本公司115年9月份自結合併財務報告之相關資訊").score, 0);
  assert.equal(scoreDisclosure("公告本公司列入合併財務報告之各子公司115年09月底之 負債比率、流動比率、速動比率").score, 0);
  assert.equal(scoreDisclosure("公告本公司2026年第三季合併自結損益").score, 0);
  assert.ok(scoreDisclosure("公告本公司董事長兼總經理配合檢調單位調查事宜").score >= 6);
});
await test("重大訊息雷達：第一次只記基準不發；之後只發新的高影響公告，自選股門檻較低", async () => {
  routes = TW_ROUTES();
  const db = memDb({ outlets: [{ id: "s", url: HOOK }], bots: { tw_disclosure: { enabled: true, outlet: "s", opts: { watch: "2330" } } } });
  posts.length = 0;
  const first = await runBot("tw_disclosure", { db, now: at(DAY, "18:10") });
  assert.ok(first.note.includes("第一次啟用"), first.note); assert.equal(posts.length, 0);
  // 新公告進來
  routes = { ...TW_ROUTES(), "t187ap04_L": [...fxj("twse_disclosure.json"), { "發言日期": "1151021", "發言時間": "190000", "公司代號": "9999", "公司名稱": "新公司", "主旨 ": "本公司董事會決議辦理現金增資發行新股", "符合條款": "", "說明": "" }, { "發言日期": "1151021", "發言時間": "190100", "公司代號": "2330", "公司名稱": "台積電", "主旨 ": "本公司代子公司公告取得機器設備", "說明": "" }] };
  const r = await runBot("tw_disclosure", { db, now: at(DAY, "19:10") });
  assert.equal(r.posted, 1, r.note);
  const names = posts[0].body.embeds[0].fields.map((x) => x.name);
  assert.ok(names[0].startsWith("⭐ 台積電"), names.join("|"));
  assert.ok(names.some((n) => n.includes("新公司（9999・上市）｜股本變動")));
  assert.equal((await runBot("tw_disclosure", { db, now: at(DAY, "19:20") })).skipped, true, "發過的不再發");
});
await test("法人籌碼：上市櫃合併、排除 ETF、張數、同步買、連買天數", async () => {
  const flows = parseFlows(fxj("twse_t86_20261021.json"), fxj("tpex_3insti.json"));
  assert.ok(!flows.some((x) => x.code === "00985B" || x.code === "020041"));
  assert.deepEqual(flows.find((x) => x.code === "2409"), { code: "2409", name: "友達", market: "上市", foreign: 44547572, trust: 3300000, dealer: -120000 });
  assert.equal(flows.find((x) => x.code === "6488").market, "上櫃");
  let st = {};
  for (const d of ["2026-10-19", "2026-10-20", DAY]) st = updateStreaks(st, d, flows);
  assert.equal(st.f["2409"], 3); assert.equal(st.f["2317"], -3);
  assert.equal(updateStreaks(st, DAY, flows), st, "同一天不重算");
  routes = TW_ROUTES();
  const db = memDb({ outlets: [{ id: "s", url: HOOK }], bots: { tw_flow: { enabled: true, outlet: "s", opts: { watch: "2330" } } } });
  posts.length = 0;
  await db.setState("tw_flow_streaks", { day: "2026-10-20", f: { "2409": 2, "2317": -4 }, t: {} });
  const r = await runBot("tw_flow", { db, now: at(DAY, "16:30") });
  assert.equal(r.ok, true, r.note);
  const f = Object.fromEntries(posts[0].body.embeds[0].fields.map((x) => [x.name, x.value]));
  assert.ok(f["🌏 外資買超前五"].startsWith("友達（2409）+44,548 張"), f["🌏 外資買超前五"]);
  assert.ok(f["🌏 外資賣超前五"].startsWith("鴻海（2317）-5,300 張"));
  assert.ok(f["🤝 外資＋投信同步買"].includes("環球晶"));
  assert.ok(f["📅 連續買賣（3 天以上）"].includes("友達 3 天") && f["📅 連續買賣（3 天以上）"].includes("鴻海 5 天"), f["📅 連續買賣（3 天以上）"]);
  assert.ok(f["⭐ 自選股"].includes("台積電（2330）"));
});
await test("一般股票判斷：4 碼、不是 0 開頭", () => {
  assert.ok(isCommon("2330") && isCommon(" 6488 ") && !isCommon("0050") && !isCommon("00631L") && !isCommon("020041") && !isCommon("910861"));
  assert.ok(!isCommon("9105", "泰金寶-DR"), "存託憑證也排除（真實資料抓到的）");
});
await test("每 5 分鐘一輪：只跑有開、時間到的", () => {
  const s = { bots: { tw_close: { enabled: true }, tw_news: { enabled: false }, tw_disclosure: { enabled: true } } };
  assert.deepEqual(dueBots(s, at(DAY, "15:25")), ["tw_close"]);
  assert.deepEqual(dueBots(s, at(DAY, "15:30")).sort(), ["tw_close", "tw_disclosure"]);
  assert.deepEqual(dueBots(s, at("2026-10-24", "15:25")), [], "週六盤後不跑");
});
await test("Webhook 被刪掉：寫清楚", async () => {
  await assert.rejects(postWebhook("https://discord.com/api/webhooks/123456789012345678/deadhook-xxxxxxxxxxxxxxxxxxxx", { content: "x" }), /被刪掉/);
});
await test("資料庫（PostgREST）：讀寫狀態、記錄、驗證排程密碼", async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, body: init.body, prefer: init.headers?.Prefer });
    if (String(url).includes("/rpc/bots_auth")) return new Response(JSON.parse(init.body).secret === "right-secret-123456" ? "true" : "false");
    if (init.method === "GET") return new Response('[{"value":{"a":1}}]');
    return new Response("");
  };
  const db = makeDb("https://x.supabase.co/", "svc");
  assert.deepEqual(await db.getState("k"), { a: 1 });
  await db.setState("k", { b: 2 });
  assert.equal(calls[1].prefer, "resolution=merge-duplicates");
  assert.ok(calls[0].url.startsWith("https://x.supabase.co/rest/v1/bot_state?key=eq.k"));
  assert.equal(await db.auth("right-secret-123456"), true);
  assert.equal(await db.auth("wrong"), false);
  globalThis.fetch = realFetch;
});

console.log(`\n機器人：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
