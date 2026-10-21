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
import { nextWeek, etToTw, keyEvents, parseFomc, parseFilings, watchList } from "../supabase/functions/bots/us.js";
import { bestPool, TOKENS, checkMoves, parseOkx, parseBybit } from "../supabase/functions/bots/crypto.js";
import { questionOf, QUESTIONS } from "../supabase/functions/bots/community.js";
import { parseSpark, adrPremium, overnightField } from "../supabase/functions/bots/markets.js";
import { missedBots, checkMissed, weeklyEmbed, weeklyReport } from "../supabase/functions/bots/engine.js";

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
const fakeFetch = globalThis.fetch;
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
  assert.equal(e.title, "📋 台股盤後報告｜2026/10/21（三）");
  assert.equal(e.author.name, "CCC Market Lab｜台股盤後"); assert.ok(e.author.icon_url.endsWith("/assets/brand/ccc-bot.png"));
  assert.ok(e.description.startsWith("## 🔺 加權 46,887.77\n**+594.84（+1.28%）**　櫃買 395.42") && e.description.includes("上市 8,746") && e.description.includes("漲 **600** 🟥"), e.description);
  const f = Object.fromEntries(e.fields.map((x) => [x.name, x.value]));
  assert.equal(f["🌏 外資"], "🔴 **+22.4 億**"); assert.equal(f["🏦 投信"], "🔴 **+128.0 億**");
  assert.ok(e.fields.filter((x) => x.inline).length >= 3, "法人三欄並排");
  assert.ok(f["🔥 強勢族群"].startsWith("🔴 金融保險 **+2.55%**"), f["🔥 強勢族群"]);
  assert.ok(f["🚀 漲幅 Top 5（成交值 5000 萬以上）"].includes("🥇 **環球晶**（6488）"), "上櫃也算進來");
  assert.ok(!JSON.stringify(e).includes("元大台灣50"), "ETF 不放進排行");
  assert.ok(f["💡 CCC 盤後觀點"].startsWith("> 加權收紅"), f["💡 CCC 盤後觀點"]);
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
  assert.equal(posts.length, 1); assert.ok(posts[0].body.embeds[0].title.includes("⚠️ 台股盤後報告 出錯了"));
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
  assert.ok(f["🌏 外資買超"].startsWith("🥇 **友達** +44,548"), f["🌏 外資買超"]);
  assert.ok(f["🌏 外資賣超"].startsWith("🥇 **鴻海** -5,300"));
  assert.ok(f["🤝 外資＋投信同步買"].includes("環球晶"));
  assert.ok(f["📅 連續買賣（3 天以上）"].includes("友達 `3 天`") && f["📅 連續買賣（3 天以上）"].includes("鴻海 `5 天`"), f["📅 連續買賣（3 天以上）"]);
  assert.ok(f["⭐ 自選股籌碼（外資／投信／自營，張）"].includes("**台積電**（2330）"));
  assert.ok(posts[0].body.embeds[0].description.startsWith("外資合計"));
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

// ── 美股 ──
globalThis.fetch = fakeFetch;
const US_ROUTES = () => ({
  "cnbc.com/id/": fx("us_cnbc.xml"),
  "dowjones.io": new Error("timeout"),
  "federalreserve.gov/feeds": fx("fed_press.xml"),
  "sec.gov/news/pressreleases": fx("fed_press.xml").replace(/Federal Reserve Board announces[^\]]+/, "SEC Charges Adviser With Fraud").replace(/monetary20261021a/g, "sec-1"),
  "calendar/economicevents": (u) => { const d = new URL(u).searchParams.get("date"); return d === "2026-10-28" ? fxj("nasdaq_econ_20261028.json") : d === "2026-10-30" ? fxj("nasdaq_econ_20261030.json") : fxj("nasdaq_econ_empty.json"); },
  "calendar/earnings": (u) => (new URL(u).searchParams.get("date") === "2026-10-28" ? fxj("nasdaq_earn_20261028.json") : { data: { rows: null } }),
  "fomccalendars.htm": fx("fed_fomc.html"),
  "CIK0000320193": fxj("sec_aapl.json"),
  "data.sec.gov/submissions": fxj("sec_empty.json"),
});
const SUN = "2026-10-25";
await test("美股時間：下週一到週日；美東換台灣（夏令 +12、冬令 +13，跨日）", () => {
  assert.deepEqual(nextWeek(at(SUN, "20:00")), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.equal(nextWeek(at("2026-10-21", "10:00"))[0], "2026-10-26");
  assert.equal(etToTw("2026-10-28", "08:30"), "10/28（三）20:30");
  assert.equal(etToTw("2026-10-28", "14:00"), "10/29（四）02:00");
  assert.equal(etToTw("2026-11-06", "08:30"), "11/6（五）21:30", "11 月第一個週日後是冬令");
  assert.equal(etToTw("2026-10-28", "24H"), null);
});
await test("Fed 官方 FOMC 日程：最後一天是決議日；跨月、跨年", () => {
  const d = parseFomc(fx("fed_fomc.html"));
  assert.deepEqual(d, ["2026-01-28", "2026-03-18", "2026-04-29", "2026-10-28", "2026-12-09", "2027-02-01"]);
});
await test("重點事件：只留美國重點、同類合併；FOMC 以 Fed 日程為準（週五那筆拿掉）", async () => {
  assert.deepEqual(keyEvents("2026-10-28", fxj("nasdaq_econ_20261028.json").data.rows).map((e) => e.label), ["FOMC 利率決議"]);
  const pce = keyEvents("2026-10-30", fxj("nasdaq_econ_20261030.json").data.rows).find((e) => e.label === "PCE 物價");
  assert.equal(pce.parts.length, 2);
  routes = US_ROUTES();
  const db = memDb({ outlets: [{ id: "s", url: HOOK }], bots: { us_week: { enabled: true, outlet: "s", thread: "888888888888888888" } } });
  posts.length = 0;
  const r = await runBot("us_week", { db, now: at(SUN, "20:00") });
  assert.equal(r.posted, 1, r.note);
  const e = posts[0].body.embeds[0];
  assert.equal(e.title, "📅 美股下週重點事件｜10/26–11/1");
  assert.ok(e.description.includes("### 📆 10/28（三）") && e.description.includes("FOMC 利率決議") && e.description.includes("台灣 02:00（隔天）"), e.description);
  assert.ok(e.description.includes("### 📆 10/30（五）\n🔥 **[PCE 物價]"), "週五只剩 PCE，FOMC 那筆是錯的日期");
  assert.ok(!e.description.includes("Jobless") && !e.description.includes("Car Registration"));
  assert.equal((await runBot("us_week", { db, now: at(SUN, "20:05") })).skipped, true, "同一週只發一次");
  assert.ok(nextWeek(at("2026-11-01", "20:00"))[0] === "2026-11-02");
});
await test("美股新聞：英文規則篩選（拿掉食譜）、一個來源壞掉照樣發、同一天一次", async () => {
  routes = US_ROUTES();
  const db = memDb({ outlets: [{ id: "s", url: HOOK }], bots: { us_news: { enabled: true, outlet: "s" } } });
  posts.length = 0;
  const r = await runBot("us_news", { db, now: at("2026-10-22", "01:30") });
  assert.equal(r.posted, 1, r.note);
  const e = posts[0].body.embeds[0];
  assert.ok(e.description.includes("Nvidia announces") && e.description.includes("Federal Reserve Board") && !e.description.includes("recipes"), e.description);
  assert.ok(e.footer.text.includes("MarketWatch暫時抓不到"));
});
await test("財報雷達：下週自選股財報；SEC 第一次只記基準，之後只發新的 10-K／8-K（財報）", async () => {
  routes = US_ROUTES();
  assert.deepEqual(watchList("nvda, aapl，tsm、bad$"), ["NVDA", "AAPL", "TSM"]);
  const db = memDb({ outlets: [{ id: "s", url: HOOK }], bots: { earn_week: { enabled: true, outlet: "s" }, earn_filings: { enabled: true, outlet: "s", opts: { watch: "AAPL,NVDA" } } } });
  posts.length = 0;
  await runBot("earn_week", { db, now: at(SUN, "19:30") });
  const d = posts[0].body.embeds[0].description;
  assert.ok(d.includes("🌙 **10/28（三）盤後**　**[MSFT]") && d.includes("[META]") && !d.includes("UNP") && d.includes("EPS 預估 `$3.65`"), d);
  const f = parseFilings("AAPL", fxj("sec_aapl.json"), { since: "2026-10-27" });
  assert.deepEqual(f.map((x) => x.form), ["10-K", "8-K"], "Form 4 和太舊的不算");
  assert.equal(f[1].items[0], "財報結果"); assert.ok(f[1].earnings);
  assert.equal(f[0].url, "https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/aapl-20260926.htm");
  // 第一次：基準
  routes = { ...US_ROUTES(), "CIK0000320193": { ...fxj("sec_aapl.json"), filings: { recent: { ...fxj("sec_aapl.json").filings.recent, accessionNumber: ["0000320193-26-000090"], filingDate: ["2026-10-30"], form: ["10-Q"], items: [""], primaryDocument: ["a.htm"] } } } };
  const first = await runBot("earn_filings", { db, now: at("2026-10-31", "08:00") });
  assert.ok(first.note.includes("基準"), first.note); assert.equal(posts.length, 1);
  routes = US_ROUTES();
  const r = await runBot("earn_filings", { db, now: at("2026-10-31", "08:30") });
  assert.equal(r.posted, 1, r.note);
  assert.ok(posts[1].body.embeds[0].description.includes("AAPL　年報 10-K") && posts[1].body.embeds[0].description.includes("財報結果"));
  assert.equal((await runBot("earn_filings", { db, now: at("2026-10-31", "09:00") })).skipped, true);
});

// ── 加密 ──
const CRYPTO_ROUTES = () => ({
  "ethereum/0x2260": fxj("dex_wbtc.json"),
  "ethereum/0xC02a": fxj("dex_weth.json"),
  "solana/So111": fxj("dex_sol.json"),
  "alternative.me": fxj("fng.json"),
  "okx.com/api/v5/support/announcements": fxj("okx_ann.json"),
  "bybit.com/v5/announcements": fxj("bybit_ann.json"),
});
await test("鏈上池：只留同一條鏈、配 USDC／USDT、流動性 10 萬以上，取流動性最高", () => {
  const p = bestPool(TOKENS[0], fxj("dex_wbtc.json"));
  assert.equal(p.dex, "uniswap WBTC/USDT"); assert.equal(p.price, 84333.17);
  assert.equal(bestPool(TOKENS[2], fxj("dex_sol.json")).dex, "orca SOL/USDC");
  assert.equal(bestPool(TOKENS[1], []), null);
});
await test("鏈上行情總覽：三個幣、恐慌貪婪、DEX 報價說明；同一天一次", async () => {
  routes = CRYPTO_ROUTES();
  const db = memDb({ outlets: [{ id: "c", url: HOOK }], bots: { crypto_digest: { enabled: true, outlet: "c", thread: "999999999999999999" } } });
  posts.length = 0;
  const r = await runBot("crypto_digest", { db, now: at(DAY, "21:00") });
  assert.equal(r.posted, 1, r.note);
  const e = posts[0].body.embeds[0];
  assert.deepEqual(e.fields.map((f) => f.name), ["🟠 BTC", "🔷 ETH", "🟣 SOL"]);
  assert.ok(e.fields[0].value.startsWith("## $84,333\n1h 🟢 **+0.67%**"), e.fields[0].value);
  assert.ok(e.description.includes("恐慌貪婪指數 **63**（貪婪）") && e.footer.text.includes("不是交易所報價"));
  assert.equal((await runBot("crypto_digest", { db, now: at(DAY, "21:05") })).skipped, true);
});
await test("異動提醒：第一次跨過門檻才發，同方向不重發，回到一半以內才重新計算", async () => {
  const pools = [{ sym: "ETH", h1: -3.4, h24: -5.1 }, { sym: "SOL", h1: 1.2, h24: 9.4 }];
  const a = checkMoves(pools, {});
  assert.deepEqual(a.hits.map((h) => `${h.sym}_${h.k}`), ["ETH_h1", "SOL_h24"]);
  assert.equal(checkMoves(pools, a.next).hits.length, 0);
  const calm = checkMoves([{ sym: "ETH", h1: -1, h24: 0 }], a.next);
  assert.equal(calm.next.ETH_h1, 0);
  assert.equal(checkMoves([{ sym: "ETH", h1: -2, h24: 0 }], a.next).next.ETH_h1, -1, "還沒回到一半以內");
  routes = CRYPTO_ROUTES();
  const db = memDb({ outlets: [{ id: "c", url: HOOK }], bots: { crypto_alert: { enabled: true, outlet: "c" } } });
  posts.length = 0;
  assert.equal((await runBot("crypto_alert", { db, now: at(DAY, "21:10") })).posted, 1);
  assert.ok(posts[0].body.embeds[0].description.startsWith("## 🔴 🔷 **ETH** 1 小時急跌 **-3.40%**"));
  assert.equal((await runBot("crypto_alert", { db, now: at(DAY, "21:20") })).skipped, true);
});
await test("OKX／Bybit 公告：只收上新、下架、維護、規則；不收活動、太舊的；發過不重發", async () => {
  const now = new Date(1792590000000);
  assert.deepEqual(parseOkx(fxj("okx_ann.json"), { now }).map((x) => x.tag), ["上新", "交易規則"]);
  assert.deepEqual(parseBybit(fxj("bybit_ann.json"), { now }).map((x) => x.tag), ["下架", "上新", "維護與規則"], "迎新獎勵、折扣費率是活動");
  routes = CRYPTO_ROUTES();
  const db = memDb({ outlets: [{ id: "c", url: HOOK }], bots: { okx_news: { enabled: true, outlet: "c" }, bybit_news: { enabled: true, outlet: "c" } } });
  posts.length = 0;
  assert.equal((await runBot("okx_news", { db, now })).posted, 1);
  assert.equal((await runBot("bybit_news", { db, now })).posted, 1);
  assert.ok(posts[1].body.embeds[0].title.startsWith("📢 Bybit 官方公告（3）"));
  assert.equal((await runBot("okx_news", { db, now })).skipped, true);
});
await test("皮老闆每日一題：同一天同一題、隔天換題、只發一次", async () => {
  assert.equal(questionOf("2026-10-21"), questionOf("2026-10-21"));
  assert.notEqual(questionOf("2026-10-21"), questionOf("2026-10-22"));
  assert.equal(new Set(QUESTIONS).size, QUESTIONS.length, "題目不重複");
  const db = memDb({ outlets: [{ id: "q", url: HOOK }], bots: { daily_question: { enabled: true, outlet: "q" } } });
  posts.length = 0;
  assert.equal((await runBot("daily_question", { db, now: at(DAY, "12:00") })).posted, 1);
  assert.ok(posts[0].body.embeds[0].description.includes(questionOf(DAY)));
  assert.equal((await runBot("daily_question", { db, now: at(DAY, "12:05") })).skipped, true);
});
await test("每支機器人都有程式、分類正確；排程（週日、每 15、30 分鐘）", () => {
  for (const b of BOTS) assert.ok(RUNNERS[b.key], b.key);
  assert.ok(isDue(BOTS.find((b) => b.key === "us_week").schedule, "20:00", 0) && !isDue(BOTS.find((b) => b.key === "us_week").schedule, "20:00", 1));
  const okx = BOTS.find((b) => b.key === "okx_news").schedule;
  assert.ok(isDue(okx, "10:15", 3) && !isDue(okx, "10:20", 3));
  const sec = BOTS.find((b) => b.key === "earn_filings").schedule;
  assert.ok(isDue(sec, "00:00", 3) && isDue(sec, "23:30", 3) && !isDue(sec, "23:35", 3));
  assert.deepEqual([...new Set(BOTS.map((b) => b.group))], ["台股", "美股", "加密", "社群"]);
});

// ── 昨晚美股、漏發檢查、週報 ──
await test("昨晚美股：指數、費半、台積電 ADR 溢價（ADR×匯率÷5 對台股收盤）、休市要寫哪天的收盤", () => {
  const q = parseSpark(fxj("yahoo_spark.json"));
  assert.equal(q["^SOX"].pct, 1.941);
  assert.equal(Math.round(adrPremium(428.46, 30.415, 2500) * 100) / 100, 4.25);
  const f = overnightField(q, { close2330: 2500, now: new Date(1792627200000 + 10 * 3600e3) });
  assert.equal(f.name, "🌙 昨晚美股");
  assert.ok(f.value.includes("🔺 費城半導體 11,502.86（+1.94%）") && f.value.includes("台積電 ADR 溢價 +4.25%") && f.value.includes("美 10 年債殖利率 4.12%"), f.value);
  assert.ok(!f.value.includes("之後休市"));
  assert.ok(overnightField(q, { now: new Date(1792627200000 + 50 * 3600e3) }).value.includes("之後休市"), "週末寫清楚");
  assert.equal(overnightField({}), null);
});
await test("台股頭條：附上昨晚美股；可以關掉；美股抓不到照發新聞", async () => {
  routes = { ...TW_ROUTES(), "finance/spark": fxj("yahoo_spark.json") };
  const db = memDb({ outlets: [{ id: "s", url: HOOK }], bots: { tw_news: { enabled: true, outlet: "s" } } });
  db.state.set("tw_hist", { days: ["2026-10-21"], c: { 2330: [2500] }, v: {} });
  posts.length = 0;
  await runBot("tw_news", { db, now: at(DAY, "08:00") });
  const e = posts[0].body.embeds[0];
  assert.ok(e.fields?.[0]?.value.includes("台積電 ADR 溢價"), JSON.stringify(e.fields));
  routes = { ...TW_ROUTES(), "finance/spark": new Error("down") };
  const r = await runBot("tw_news", { db: memDb({ outlets: [{ id: "s", url: HOOK }], bots: { tw_news: { enabled: true, outlet: "s" } } }), now: at(DAY, "08:00") });
  assert.equal(r.posted, 1); assert.ok(!posts[1].body.embeds[0].fields);
  const off = await runBot("tw_news", { db: memDb({ outlets: [{ id: "s", url: HOOK }], bots: { tw_news: { enabled: true, outlet: "s", opts: { overnight: "off" } } } }), now: at(DAY, "08:00"), force: true });
  assert.equal(off.posted, 1);
});
await test("漏發檢查：盤後報告到 17:30 還沒發 → 通知；休市、已發過不通知", async () => {
  const settings = { outlets: [{ id: "a", url: HOOK }], alertOutlet: "a", bots: { tw_close: { enabled: true, outlet: "a" }, tw_flow: { enabled: true, outlet: "a" } } };
  assert.deepEqual(missedBots(settings, {}, at(DAY, "17:30")), ["tw_close"]);
  assert.deepEqual(missedBots(settings, { tw_close: DAY }, at(DAY, "17:30")), []);
  assert.deepEqual(missedBots(settings, {}, at(DAY, "17:35")), [], "只在那一輪檢查一次");
  assert.deepEqual(missedBots(settings, {}, at("2026-10-24", "17:30")), [], "週末不檢查");
  assert.deepEqual(missedBots(settings, {}, at(DAY, "19:00")), ["tw_flow"]);
  // 休市日：盤後報告回「今天休市」也算處理完
  routes = { ...TW_ROUTES(), holidaySchedule: [{ Name: "測試休市", Date: "1151021" }] };
  const db = memDb(settings);
  await runBot("tw_close", { db, now: at(DAY, "15:15") });
  assert.equal((await db.getState("bot_day")).tw_close, DAY);
  posts.length = 0;
  const db2 = memDb(settings);
  const missed = await checkMissed(db2, settings, { now: at(DAY, "17:30") });
  assert.deepEqual(missed, ["tw_close"]);
  assert.ok(posts[0].body.embeds[0].title.includes("台股盤後報告") && posts[0].body.embeds[0].description.includes("到 17:30 還沒發出去"));
  assert.equal(db2.runs[0].ok, false);
});
await test("週報：週日 21:30 發到管理員 Webhook，寫每支發了幾則、出錯幾次；一週一次", async () => {
  const settings = { outlets: [{ id: "a", url: HOOK }], alertOutlet: "a", bots: { tw_close: { enabled: true, outlet: "a" }, okx_news: { enabled: true, outlet: "a" } } };
  const runs = [{ bot: "tw_close", ok: true, posted: 1 }, { bot: "tw_close", ok: true, posted: 1 }, { bot: "okx_news", ok: false, posted: 0, note: "www.okx.com 回應 503" }];
  const e = weeklyEmbed(settings, runs, at(SUN, "21:30"));
  assert.ok(e.description.includes("✅ 台股盤後報告：發了 2 則") && e.description.includes("⚠️ OKX 官方公告：發了 0 則，出錯 1 次（最近：www.okx.com 回應 503）") && e.description.includes("另外 11 支沒打開"), e.description);
  const db = memDb(settings);
  db.req = async () => runs;
  posts.length = 0;
  assert.equal(await weeklyReport(db, settings, { now: at(SUN, "21:30") }), true);
  assert.equal(await weeklyReport(db, settings, { now: at(SUN, "21:32") }), false, "同一天只發一次");
  assert.equal(await weeklyReport(db, settings, { now: at("2026-10-26", "21:30") }), false, "只有週日");
  assert.equal(posts.length, 1);
});

await test("立即發一次：半夜按盤後報告 → 發最近一個交易日的；不會讓當天排程以為發過了", async () => {
  routes = TW_ROUTES();
  const db = memDb({ outlets: [{ id: "s", url: HOOK }], bots: { tw_close: { enabled: true, outlet: "s" }, tw_news: { enabled: true, outlet: "s" } } });
  posts.length = 0;
  const r = await runBot("tw_close", { db, now: at("2026-10-22", "00:35"), force: true });
  assert.equal(r.posted, 1, r.note);
  assert.equal(posts[0].body.embeds[0].title, "📋 台股盤後報告｜2026/10/21（三）");
  assert.equal((await db.getState("tw_close_done")).day, undefined, "手動的不記成「今天發過了」");
  assert.equal((await db.getState("bot_day")).tw_close, undefined);
  // 頭條：半夜手動發了，早上 08:00 照樣發（舊的「已發過」紀錄沒有 auto 也不算）
  routes = { ...TW_ROUTES(), "finance/spark": new Error("x") };
  await runBot("tw_news", { db, now: at("2026-10-22", "00:36"), force: true });
  db.state.set("tw_news_done", { day: "2026-10-22" });
  const morning = await runBot("tw_news", { db, now: at("2026-10-22", "08:00") });
  assert.notEqual(morning.note, "今天已經發過", JSON.stringify(morning));
  assert.equal((await db.getState("tw_news_done")).auto, true);
});

console.log(`\n機器人：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
