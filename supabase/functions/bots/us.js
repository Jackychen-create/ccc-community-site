// 美股：每日新聞、下週重點事件、財報行事曆、SEC 正式申報
// 來源：CNBC／MarketWatch／Fed／SEC 的公開 RSS、Nasdaq 公開行事曆（經濟事件、財報）、Fed 官方 FOMC 日程、SEC EDGAR
import { COLOR, getText, getJson, safeEmbed, footer, seenFilter, twDate, addDays, md, clip, UA } from "./core.js";
import { readFeeds, pickNews, newsEmbed } from "./tw.js";

const DISCLAIMER = "資訊整理，不是投資建議；以官方公告為準";

// ── 每日美股新聞 ──
const US_FEEDS = [
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", source: "CNBC" },
  { url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", source: "CNBC 經濟" },
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", source: "MarketWatch" },
  { url: "https://www.federalreserve.gov/feeds/press_all.xml", source: "Fed" },
  { url: "https://www.sec.gov/news/pressreleases.rss", source: "SEC" },
];
export const US_RULES = [
  { re: /\bFed\b|FOMC|Powell|rate (cut|hike)|interest rate|monetary policy|Treasury yield|bond yield/i, why: "利率與 Fed", w: 4 },
  { re: /inflation|\bCPI\b|\bPPI\b|\bPCE\b|price index/i, why: "通膨", w: 4 },
  { re: /jobs report|payrolls|unemployment|jobless|labor market/i, why: "就業", w: 3 },
  { re: /\bGDP\b|recession|economy|consumer spending|retail sales/i, why: "景氣", w: 3 },
  { re: /S&P 500|Nasdaq|Dow|stock market|stocks? (rally|fall|drop|rise|slide)|Wall Street|futures/i, why: "大盤", w: 3 },
  { re: /Nvidia|Apple|Microsoft|Alphabet|Google|Meta|Amazon|Tesla|AMD|TSMC|Broadcom|semiconductor|chip/i, why: "大型科技與半導體", w: 3 },
  { re: /earnings|revenue|guidance|quarter|profit|outlook/i, why: "財報", w: 2 },
  { re: /tariff|trade war|sanction|export control|China/i, why: "貿易與地緣", w: 3 },
  { re: /\bSEC\b|charges|enforcement|fraud|settle/i, why: "監管", w: 2 },
  { re: /oil|crude|OPEC|dollar|gold|bitcoin/i, why: "原物料與匯率", w: 2 },
];
export async function usNews(ctx) {
  const day = twDate(ctx.now);
  const done = await ctx.db.getState("us_news_done", {});
  if (!ctx.force && done.day === day) return { skipped: "今天已經發過" };
  const { items, failed } = await readFeeds(US_FEEDS);
  if (!items.length) throw new Error(`美股新聞來源都抓不到（${failed.join("、")}）`);
  const sent = await seenFilter(ctx.db, "us_news_seen", items.map((x) => x.link));
  const fresh = new Set(ctx.force ? items.map((x) => x.link) : sent.fresh);
  const pick = pickNews(items.filter((x) => fresh.has(x.link)), { now: ctx.now, lookbackHours: 24, rules: US_RULES, max: Number(ctx.opts?.max) || 8, minScore: 3 });
  if (!pick.length) return { skipped: "沒有新的重要新聞" };
  const embed = newsEmbed(`🇺🇸 美股重點新聞｜${md(day)}`, pick, { color: COLOR.info, note: `英文標題保留原文，分類是規則整理${failed.length ? `；${failed.join("、")}暫時抓不到` : ""}・${DISCLAIMER}` });
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await sent.commit(pick.map((x) => x.link));
  await ctx.db.setState("us_news_done", { day });
  return { posted: 1, note: `${pick.length} 則` };
}

// ── Nasdaq 公開行事曆（要像瀏覽器一樣帶 Origin／Referer）──
const NASDAQ = "https://api.nasdaq.com/api/calendar";
const NASDAQ_HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", Accept: "application/json, text/plain, */*", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" };
const nasdaq = (path, day) => getJson(`${NASDAQ}/${path}?date=${day}`, { headers: NASDAQ_HEADERS }).then((j) => j?.data?.rows || []);

// 下一週（週一到週日）；在週日跑就是明天開始那一週
export function nextWeek(now) {
  const day = twDate(now);
  const wd = new Date(day + "T00:00:00Z").getUTCDay();
  const mon = addDays(day, ((8 - wd) % 7) || 7);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}
// 美東夏令時間：3 月第二個週日到 11 月第一個週日
function etOffset(day) {
  const y = Number(day.slice(0, 4));
  const nthSunday = (m, n) => { const d = new Date(Date.UTC(y, m, 1)); const first = (7 - d.getUTCDay()) % 7 + 1; return `${y}-${String(m + 1).padStart(2, "0")}-${String(first + (n - 1) * 7).padStart(2, "0")}`; };
  return day >= nthSunday(2, 2) && day < nthSunday(10, 1) ? -4 : -5;
}
// 美東時間 → 台灣時間（「週四 20:30」；跨日會寫隔天）
const WD = ["日", "一", "二", "三", "四", "五", "六"];
export function etToTw(day, hm) {
  const m = String(hm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), Number(m[1]), Number(m[2])) - etOffset(day) * 3600e3 + 8 * 3600e3;
  const d = new Date(t);
  return `${md(d.toISOString().slice(0, 10))}（${WD[d.getUTCDay()]}）${d.toISOString().slice(11, 16)}`;
}

const EVENTS = [
  { re: /^(Core )?CPI|Consumer Price Index/i, label: "CPI 消費者物價", src: "https://www.bls.gov/cpi/" },
  { re: /^(Core )?PPI|Producer Price Index/i, label: "PPI 生產者物價", src: "https://www.bls.gov/ppi/" },
  { re: /Nonfarm Payrolls/i, label: "非農就業", src: "https://www.bls.gov/ces/" },
  { re: /^Unemployment Rate/i, label: "失業率", src: "https://www.bls.gov/cps/" },
  { re: /JOLTs?/i, label: "JOLTS 職缺", src: "https://www.bls.gov/jlt/" },
  { re: /^GDP|Gross Domestic Product/i, label: "GDP", src: "https://www.bea.gov/data/gdp/gross-domestic-product" },
  { re: /\bPCE\b|Personal Consumption/i, label: "PCE 物價", src: "https://www.bea.gov/data/personal-consumption-expenditures-price-index" },
  { re: /^(Core )?Retail Sales/i, label: "零售銷售", src: "https://www.census.gov/retail/" },
  { re: /ISM (Manufacturing|Non-Manufacturing|Services) PMI/i, label: "ISM PMI", src: "https://www.ismworld.org/" },
  { re: /Michigan Consumer Sentiment/i, label: "密大消費者信心", src: "" },
  { re: /Fed Interest Rate Decision|FOMC Statement/i, label: "FOMC 利率決議", src: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { re: /FOMC (Meeting )?Minutes/i, label: "FOMC 會議紀要", src: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { re: /Fed Chair .*Speaks|Powell Speaks/i, label: "Fed 主席談話", src: "" },
];
const clean = (s) => String(s ?? "").replace(/&nbsp;/g, "").trim();
// 一天的事件：只留美國、重點項目；同一項（例如 CPI 月增、年增）合成一行
export function keyEvents(day, rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (r.country !== "United States") continue;
    const ev = EVENTS.find((e) => e.re.test(clean(r.eventName)));
    if (!ev) continue;
    const k = ev.label;
    const cur = out.get(k) || { day, label: ev.label, src: ev.src, time: clean(r.gmt), parts: [] };
    const c = clean(r.consensus), p = clean(r.previous);
    // 同名的（Nasdaq 常把月增、年增寫成同一個名字）只留第一筆，最多 3 筆
    if (!cur.names?.has(clean(r.eventName)) && cur.parts.length < 3) cur.parts.push(`${clean(r.eventName)}${c ? ` 預估 ${c}` : ""}${p ? `（前值 ${p}）` : ""}`);
    (cur.names ||= new Set()).add(clean(r.eventName));
    out.set(k, cur);
  }
  return [...out.values()].map(({ names, ...e }) => e);
}
// Fed 官方 FOMC 日程（網頁上每年一段「2026 FOMC Meetings」，月份＋日期 27-28）
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export function parseFomc(html) {
  const out = [];
  const parts = String(html || "").split(/(\d{4}) FOMC Meetings/);
  for (let i = 1; i < parts.length; i += 2) {
    const y = Number(parts[i]);
    const re = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g;
    let m;
    while ((m = re.exec(parts[i + 1]))) {
      const months = m[1].toLowerCase().split("/").map((x) => MONTHS.findIndex((n) => n.startsWith(x.trim().slice(0, 3))));
      const days = m[2].replace(/[^\d-]/g, "").split("-").map(Number).filter(Boolean);
      if (!days.length || months[0] < 0) continue;
      const last = days[days.length - 1];
      const mon = months.length > 1 && last < days[0] ? months[months.length - 1] : months[0];
      const yy = mon < months[0] ? y + 1 : y;
      out.push(`${yy}-${String(mon + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`);
    }
  }
  return [...new Set(out)];
}
export function weekEmbed(days, events, { missing = [] } = {}) {
  const lines = days.map((d) => {
    const list = events.filter((e) => e.day === d);
    if (!list.length) return null;
    return `**${md(d)}（${WD[new Date(d + "T00:00:00Z").getUTCDay()]}）**\n` + list.map((e) => {
      const tw = etToTw(d, e.time);
      return `・${e.src ? `[${e.label}](${e.src})` : e.label}${tw ? `　台灣 ${tw.split("）")[1]}${tw.startsWith(md(d)) ? "" : "（隔天）"}` : ""}\n　${clip(e.parts.join("；"), 180)}`;
    }).join("\n");
  }).filter(Boolean);
  return safeEmbed({
    title: `📅 美股下週重點事件｜${md(days[0])}–${md(days[6])}`,
    color: COLOR.info,
    description: lines.length ? lines.join("\n\n") : "下週沒有排定的重點經濟數據。",
    footer: footer(`時間換算成台灣時間；日期以 BLS、BEA、Fed 官方為準${missing.length ? `；${missing.join("、")}暫時抓不到` : ""}・${DISCLAIMER}`),
    timestamp: new Date().toISOString(),
  });
}
export async function usWeek(ctx) {
  const days = nextWeek(ctx.now);
  const done = await ctx.db.getState("us_week_done", {});
  if (!ctx.force && done.week === days[0]) return { skipped: "這週已經發過" };
  const res = await Promise.allSettled(days.map((d) => nasdaq("economicevents", d)));
  const missing = days.filter((_, i) => res[i].status === "rejected").map(md);
  if (missing.length === days.length) throw new Error(`Nasdaq 經濟行事曆抓不到：${res[0].reason?.message || ""}`);
  let events = days.flatMap((d, i) => (res[i].status === "fulfilled" ? keyEvents(d, res[i].value) : []));
  // FOMC：以 Fed 官方日程為準（第三方行事曆偶爾把週三的決議放到別天）
  try {
    const fomc = parseFomc(await getText("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"));
    events = events.filter((e) => e.label !== "FOMC 利率決議" || fomc.includes(e.day));
    for (const d of days.filter((x) => fomc.includes(x))) {
      if (!events.some((e) => e.day === d && e.label === "FOMC 利率決議")) events.push({ day: d, label: "FOMC 利率決議", src: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", time: "14:00", parts: ["Fed 官方日程：會議最後一天公布利率決議，之後主席記者會"] });
    }
  } catch { missing.push("Fed 日程"); }
  const embed = weekEmbed(days, events, { missing });
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await ctx.db.setState("us_week_done", { week: days[0] });
  return { posted: 1, note: `${events.length} 項事件` };
}

// ── 財報雷達 ──
const DEFAULT_WATCH = "NVDA,AAPL,MSFT,GOOGL,META,AMZN,TSLA,AMD,TSM";
export const watchList = (s) => [...new Set(String(s || DEFAULT_WATCH).toUpperCase().split(/[\s,，、]+/).filter((x) => /^[A-Z.]{1,6}$/.test(x)))];
const TIME = { "time-pre-market": "盤前", "time-after-hours": "盤後", "time-not-supplied": "時間未定" };
export function pickEarnings(day, rows, watch) {
  const set = new Set(watch);
  return (rows || []).filter((r) => set.has(String(r.symbol || "").toUpperCase())).map((r) => ({ day, symbol: r.symbol, name: r.name, time: TIME[r.time] || "時間未定", eps: clean(r.epsForecast), lastEps: clean(r.lastYearEPS), quarter: clean(r.fiscalQuarterEnding) }));
}
export function earnEmbed(days, list, { missing = [], watch } = {}) {
  const lines = list.map((e) => `**${md(e.day)}（${WD[new Date(e.day + "T00:00:00Z").getUTCDay()]}）${e.time}　[${e.symbol}](https://www.nasdaq.com/market-activity/stocks/${e.symbol.toLowerCase()}/earnings)**　${clip(e.name, 40)}\n　${e.quarter ? `${e.quarter} 季` : ""}${e.eps ? `・EPS 預估 ${e.eps}` : ""}${e.lastEps ? `（去年同期 ${e.lastEps}）` : ""}`);
  return safeEmbed({
    title: `📊 財報雷達：下週財報｜${md(days[0])}–${md(days[6])}`,
    color: COLOR.gold,
    description: lines.length ? lines.join("\n") : `下週自選股（${watch.join("、")}）沒有預定財報。`,
    footer: footer(`日期是 Nasdaq 預告，可能變動；正式申報以 SEC 為準${missing.length ? `；${missing.join("、")}暫時抓不到` : ""}・${DISCLAIMER}`),
    timestamp: new Date().toISOString(),
  });
}
export async function earnWeek(ctx) {
  const days = nextWeek(ctx.now);
  const done = await ctx.db.getState("earn_week_done", {});
  if (!ctx.force && done.week === days[0]) return { skipped: "這週已經發過" };
  const watch = watchList(ctx.opts?.watch);
  const work = days.slice(0, 5);
  const res = await Promise.allSettled(work.map((d) => nasdaq("earnings", d)));
  const missing = work.filter((_, i) => res[i].status === "rejected").map(md);
  if (missing.length === work.length) throw new Error(`Nasdaq 財報行事曆抓不到：${res[0].reason?.message || ""}`);
  const list = work.flatMap((d, i) => (res[i].status === "fulfilled" ? pickEarnings(d, res[i].value, watch) : []));
  const embed = earnEmbed(days, list, { missing, watch });
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await ctx.db.setState("earn_week_done", { week: days[0] });
  return { posted: 1, note: `${list.length} 家` };
}

// SEC EDGAR 正式申報（10-Q、10-K、8-K、20-F、40-F、6-K）
const SEC_UA = `${UA.replace("Mozilla/5.0 ", "")}`;
const CIK = { NVDA: 1045810, AAPL: 320193, MSFT: 789019, GOOGL: 1652044, GOOG: 1652044, META: 1326801, AMZN: 1018724, TSLA: 1318605, AMD: 2488, TSM: 1046179, AVGO: 1730168, INTC: 50863, NFLX: 1065280, QCOM: 804328, MU: 723125, ASML: 937966, ORCL: 1341439, PLTR: 1321655, SMCI: 1375365, ARM: 1973239, COIN: 1679788, MSTR: 1050446 };
const FORMS = { "10-Q": "季報 10-Q", "10-K": "年報 10-K", "8-K": "重大事件 8-K", "20-F": "年報 20-F", "40-F": "年報 40-F", "6-K": "外國公司報告 6-K", "10-Q/A": "季報更正", "10-K/A": "年報更正" };
const ITEMS = { "1.01": "重大協議", "1.02": "終止重大協議", "2.01": "完成收購或處分", "2.02": "財報結果", "2.03": "新增債務", "2.05": "重組", "2.06": "資產減損", "3.01": "上市資格", "5.02": "董事或高層異動", "5.07": "股東會表決", "7.01": "對外說明", "8.01": "其他重大事件" };
async function cikOf(db, sym) {
  if (CIK[sym]) return CIK[sym];
  const st = await db.getState("sec_cik", {});
  if (st[sym]) return st[sym];
  const all = await getJson("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": SEC_UA } });
  const map = {};
  for (const v of Object.values(all || {})) map[String(v.ticker).toUpperCase()] = v.cik_str;
  await db.setState("sec_cik", { ...st, ...Object.fromEntries([[sym, map[sym] || 0]]) });
  return map[sym] || 0;
}
export function parseFilings(sym, j, { since }) {
  const r = j?.filings?.recent || {};
  const cik = Number(j?.cik || 0);
  const out = [];
  for (let i = 0; i < (r.form || []).length; i++) {
    const form = r.form[i];
    if (!FORMS[form] || (r.filingDate[i] || "") < since) continue;
    const acc = r.accessionNumber[i];
    const items = String(r.items?.[i] || "").split(",").map((x) => x.trim()).filter(Boolean);
    out.push({
      id: acc, sym, form, label: FORMS[form], day: r.filingDate[i], at: r.acceptanceDateTime?.[i] || "",
      items: items.map((x) => ITEMS[x]).filter(Boolean),
      earnings: items.includes("2.02") || /^10-[QK]|^20-F|^40-F/.test(form),
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${r.primaryDocument[i] || ""}`,
    });
  }
  return out;
}
export function filingsEmbed(list) {
  return safeEmbed({
    title: `📑 財報雷達：SEC 新申報（${list.length}）`,
    color: list.some((x) => x.earnings) ? COLOR.up : COLOR.info,
    description: list.map((x) => `**[${x.sym}　${x.label}](${x.url})**${x.earnings ? "　📈 財報" : ""}\n　${x.day}${x.items.length ? `・${x.items.join("、")}` : ""}`).join("\n"),
    footer: footer(`來源 SEC EDGAR 官方申報・${DISCLAIMER}`),
    timestamp: new Date().toISOString(),
  });
}
export async function earnFilings(ctx) {
  const watch = watchList(ctx.opts?.watch);
  const since = addDays(twDate(ctx.now), -3);
  const res = await Promise.allSettled(watch.map(async (s) => {
    const cik = await cikOf(ctx.db, s);
    if (!cik) return [];
    const j = await getJson(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } });
    return parseFilings(s, j, { since });
  }));
  const failed = watch.filter((_, i) => res[i].status === "rejected");
  if (failed.length === watch.length) throw new Error(`SEC EDGAR 抓不到：${res[0].reason?.message || ""}`);
  const all = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const seen = await seenFilter(ctx.db, "earn_filings_seen", all.map((x) => x.id), { keep: 800 });
  // 第一次只記下現有的申報，不補發舊的
  if (seen.first && !ctx.dryRun && !ctx.force) { await seen.commit(all.map((x) => x.id)); return { skipped: `第一次執行：記下 ${all.length} 筆近期申報當基準`, retry: false }; }
  const fresh = ctx.dryRun || ctx.force ? all.slice(0, 10) : all.filter((x) => seen.fresh.includes(x.id));
  if (!fresh.length) return { skipped: "沒有新申報" };
  const embed = filingsEmbed(fresh.slice(0, 15));
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await seen.commit(fresh.map((x) => x.id));
  return { posted: 1, note: `${fresh.length} 筆${failed.length ? `（${failed.join("、")} 抓不到）` : ""}` };
}
