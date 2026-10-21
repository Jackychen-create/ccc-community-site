// 台股機器人：盤後報告、每日頭條、重大訊息雷達、法人籌碼雷達
// 資料來源都是官方公開資料（TWSE、TPEx）和公開 RSS，不需要金鑰；不是投資建議
import { getJson, getText, num, fmt, pct, yi, arrow, clip, md, addDays, twDate, twHM, twWeekday, rocToDate, normKeys, safeEmbed, footer, seenFilter, COLOR } from "./core.js";
import { parseFeed } from "./rss.js";
import { readOvernight, overnightField } from "./markets.js";

const TWSE = "https://www.twse.com.tw";
const TWSE_OPEN = "https://openapi.twse.com.tw/v1";
const TPEX_OPEN = "https://www.tpex.org.tw/openapi/v1";
const ymd = (day) => day.replaceAll("-", "");
// 一般股票：4 碼、不是 0 開頭（排除 ETF、權證、債券、存託憑證）
export const isCommon = (code, name = "") => /^[1-9]\d{3}$/.test(String(code || "").trim()) && !/-DR$/i.test(String(name).trim());
const DISCLAIMER = "資訊整理，不是投資建議；請以證交所、櫃買中心公告為準";

// ── 開休市：證交所的休市日表（每年抓一次，抓不到就只看週末）──
export function holidaysFrom(rows) {
  const off = new Set();
  for (const r of rows || []) {
    const d = rocToDate(r.Date);
    if (!d) continue;
    if (/開始交易|最後交易/.test(r.Name || "")) continue; // 這兩種是有交易的日子
    off.add(d);
  }
  return off;
}
export async function isTradingDay(db, day) {
  const wd = new Date(day + "T00:00:00Z").getUTCDay();
  if (wd === 0 || wd === 6) return false;
  const year = day.slice(0, 4);
  let st = await db.getState("tw_holidays", {});
  if (st.year !== year || !Array.isArray(st.days)) {
    try {
      const rows = await getJson(`${TWSE_OPEN}/holidaySchedule/holidaySchedule`);
      st = { year, days: [...holidaysFrom(rows)].filter((d) => d.startsWith(year)) };
      await db.setState("tw_holidays", st);
    } catch {
      return true; // 抓不到休市表：平日照跑，沒資料時本來就會略過
    }
  }
  return !st.days.includes(day);
}

// ── 盤後報告 ──
const sign = (html) => (/-/.test(String(html).replace(/<[^>]*>/g, "")) ? -1 : 1);
const tableOf = (j, re) => (j.tables || []).find((t) => re.test(t.title || ""));
const COMPOSITE = /^(水泥窯製|塑膠化工|機電|化學生技醫療|電子工業)類指數$/;

export function parseTwse(j) {
  const idx = tableOf(j, /價格指數\(臺灣證券交易所\)/);
  const rowOf = (name) => idx?.data?.find((r) => r[0] === name);
  const taiex = rowOf("發行量加權股價指數");
  const indexRow = (r) => (r ? { close: num(r[1]), change: sign(r[2]) * num(r[3]), pct: num(r[4]) } : null); // 漲跌百分比本身就有正負號，漲跌點數沒有
  const sectors = (idx?.data || []).filter((r) => /類指數$/.test(r[0]) && !COMPOSITE.test(r[0]) && !/兩倍|反向/.test(r[0]))
    .map((r) => ({ name: r[0].replace(/類指數$/, ""), pct: num(r[4]) })).filter((s) => s.pct != null);
  const stat = tableOf(j, /大盤統計資訊/);
  const total = stat?.data?.find((r) => /^總計/.test(r[0]));
  const breadth = tableOf(j, /漲跌證券數合計/);
  const bRow = (re) => { const r = breadth?.data?.find((x) => re.test(x[0])); const m = String(r?.[2] || "").match(/([\d,]+)(?:\((\d+)\))?/); return m ? { n: num(m[1]), limit: Number(m[2] || 0) } : null; };
  const quotes = tableOf(j, /每日收盤行情/);
  const stocks = (quotes?.data || []).filter((r) => isCommon(r[0], r[1])).map((r) => {
    const close = num(r[8]), ch = sign(r[9]) * (num(r[10]) || 0);
    const prev = close != null ? close - ch : null;
    return { code: r[0].trim(), name: String(r[1]).trim(), vol: num(r[2]), value: num(r[4]), high: num(r[6]), low: num(r[7]), close, pct: prev ? (ch / prev) * 100 : null, market: "上市" };
  }).filter((s) => s.close);
  const m = String(idx?.title || stat?.title || "").match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
  const day = m ? `${Number(m[1]) + 1911}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
  return { day, taiex: indexRow(taiex), value: total ? num(total[1]) : null, up: bRow(/^上漲/), down: bRow(/^下跌/), flat: bRow(/^持平/), sectors, stocks };
}

export function parseTpex(indexRows, quoteRows) {
  const last = (indexRows || []).at(-1);
  const prevClose = last ? num(last.Close) - num(last.Change) : null;
  const otc = last ? { day: `${last.Date.slice(0, 4)}-${last.Date.slice(4, 6)}-${last.Date.slice(6, 8)}`, close: num(last.Close), change: num(last.Change), pct: prevClose ? (num(last.Change) / prevClose) * 100 : null } : null;
  const rows = (quoteRows || []).map(normKeys);
  const day = rocToDate(rows[0]?.date);
  let value = 0;
  const stocks = [];
  for (const r of rows) {
    value += num(r.transactionamount) || 0;
    const code = String(r.securitiescompanycode || "").trim();
    if (!isCommon(code, r.companyname)) continue;
    const close = num(r.close), ch = num(r.change) || 0;
    if (!close) continue;
    stocks.push({ code, name: String(r.companyname || "").trim(), vol: num(r.tradingshares), value: num(r.transactionamount), high: num(r.high), low: num(r.low), close, pct: close - ch ? (ch / (close - ch)) * 100 : null, market: "上櫃" });
  }
  return { otc, day, value, stocks };
}

export function parseInstitutions(j) {
  const v = (re) => (j?.data || []).filter((r) => re.test(r[0])).reduce((a, r) => a + (num(r[3]) || 0), 0);
  if (!j?.data?.length) return null;
  return { foreign: v(/^外資/), trust: v(/^投信/), dealer: v(/^自營商/), total: v(/^合計/) };
}

// 技術面：存最近 25 個交易日的收盤和成交量
export function updateHistory(hist, day, stocks) {
  const h = hist?.days ? { days: [...hist.days], c: { ...hist.c }, v: { ...hist.v } } : { days: [], c: {}, v: {} };
  if (h.days.at(-1) === day) return h;
  h.days.push(day);
  const keep = 25;
  for (const s of stocks) {
    h.c[s.code] = [...(h.c[s.code] || []), s.close].slice(-keep);
    h.v[s.code] = [...(h.v[s.code] || []), s.vol].slice(-keep);
  }
  if (h.days.length > keep) h.days = h.days.slice(-keep);
  return h;
}
export function technicals(hist, stocks, n = 30) {
  const top = [...stocks].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, n);
  const ready = (hist?.days?.length || 0) >= 21;
  const out = [];
  for (const s of top) {
    const tags = [];
    const c = hist?.c?.[s.code] || [], v = hist?.v?.[s.code] || [];
    if (ready && c.length >= 21) {
      const prev = c.slice(-21, -1);
      const ma20 = c.slice(-20).reduce((a, x) => a + x, 0) / 20;
      if (s.close > ma20 && c.at(-2) <= prev.slice(-20).reduce((a, x) => a + x, 0) / prev.slice(-20).length) tags.push("站上 MA20");
      if (s.close > Math.max(...prev)) tags.push("突破 20 日高");
      const avgV = v.slice(-21, -1).reduce((a, x) => a + x, 0) / 20;
      if (avgV && s.vol >= avgV * 1.5) tags.push(`量增 ${(s.vol / avgV).toFixed(1)} 倍`);
    }
    if (s.high && s.low && s.close && (s.high - s.low) / s.close >= 0.07) tags.push("高波動");
    if (s.pct != null && s.pct >= 9.5) tags.push("接近漲停");
    if (s.pct != null && s.pct <= -9.5) tags.push("接近跌停");
    if (tags.length) out.push({ ...s, tags });
  }
  return { ready, days: hist?.days?.length || 0, list: out.slice(0, 8) };
}

// 規則式的「CCC 盤後觀點」（不用 AI）
export function viewpoint({ taiex, otc, inst, up, down, sectors }) {
  const lines = [];
  if (taiex?.pct != null) {
    const p = taiex.pct;
    lines.push(p >= 1.5 ? "加權大漲，多方力道明顯" : p >= 0.5 ? "加權收紅，偏多整理" : p > -0.5 ? "加權小幅震盪，方向不明" : p > -1.5 ? "加權收黑，短線轉弱" : "加權重挫，留意風險控管");
  }
  if (otc?.pct != null && taiex?.pct != null && Math.sign(otc.pct) !== Math.sign(taiex.pct)) lines.push(`櫃買和加權走勢分歧（櫃買 ${pct(otc.pct)}）`);
  if (up?.n && down?.n) lines.push(up.n > down.n * 1.5 ? "上漲家數明顯多於下跌，漲勢普及" : down.n > up.n * 1.5 ? "下跌家數明顯偏多，賣壓擴散" : "漲跌家數接近，個股表現分化");
  if (inst) {
    const f = inst.foreign / 1e8, t = inst.trust / 1e8;
    if (Math.abs(f) >= 100) lines.push(`外資${f > 0 ? "大買" : "大賣"} ${Math.abs(f).toFixed(0)} 億`);
    if (t >= 30) lines.push(`投信買超 ${t.toFixed(0)} 億，內資積極`);
  }
  const strong = sectors?.length ? [...sectors].sort((a, b) => b.pct - a.pct)[0] : null;
  if (strong && strong.pct >= 2) lines.push(`${strong.name}類領漲（${pct(strong.pct)}）`);
  return lines.length ? lines.join("；") + "。" : "";
}

export function closeEmbed({ day, twse, tpex, inst, tech }) {
  const all = [...twse.stocks, ...tpex.stocks];
  const liquid = all.filter((s) => (s.value || 0) >= 5e7);
  const byVol = [...all].sort((a, b) => (b.vol || 0) - (a.vol || 0)).slice(0, 5);
  const byGain = [...liquid].sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99)).slice(0, 5);
  const sorted = [...twse.sectors].sort((a, b) => b.pct - a.pct);
  const total = (twse.value || 0) + (tpex.value || 0);
  const t = twse.taiex, o = tpex.otc;
  const line = (s) => `${s.name}（${s.code}）${fmt(s.close)}　${pct(s.pct)}`;
  const fields = [
    { name: "📈 大盤", value: [
      t ? `加權 ${fmt(t.close)}　${arrow(t.change)} ${fmt(Math.abs(t.change))}（${pct(t.pct)}）` : "加權：資料還沒出來",
      o ? `櫃買 ${fmt(o.close)}　${arrow(o.change)} ${fmt(Math.abs(o.change))}（${pct(o.pct)}）` : "",
      `成交值　上市 ${fmt((twse.value || 0) / 1e8, 0)} 億＋上櫃 ${fmt((tpex.value || 0) / 1e8, 0)} 億＝${fmt(total / 1e8, 0)} 億`,
      twse.up && twse.down ? `上市股票　漲 ${twse.up.n}（漲停 ${twse.up.limit}）・跌 ${twse.down.n}（跌停 ${twse.down.limit}）・平 ${twse.flat?.n ?? "—"}` : "",
    ].filter(Boolean).join("\n") },
    inst ? { name: "🏦 上市三大法人", value: `外資 ${yi(inst.foreign)}\n投信 ${yi(inst.trust)}\n自營商 ${yi(inst.dealer)}\n合計 ${yi(inst.total)}` } : { name: "🏦 上市三大法人", value: "資料還沒公布" },
    sorted.length ? { name: "🔥 強弱族群（上市類股）", value: `強：${sorted.slice(0, 3).map((s) => `${s.name} ${pct(s.pct)}`).join("、")}\n弱：${sorted.slice(-3).reverse().map((s) => `${s.name} ${pct(s.pct)}`).join("、")}` } : null,
    byVol.length ? { name: "📊 成交量前五（上市＋上櫃）", value: byVol.map((s) => `${line(s)}　${fmt((s.vol || 0) / 1000, 0)} 張`).join("\n") } : null,
    byGain.length ? { name: "🚀 漲幅前五（成交值 5000 萬以上）", value: byGain.map(line).join("\n") } : null,
    { name: "🧭 技術面觀察（成交值前 30 檔）", value: tech.list.length ? tech.list.map((s) => `${s.name}（${s.code}）：${s.tags.join("、")}`).join("\n") + (tech.ready ? "" : `\n（均線條件要累積 21 個交易日，目前 ${tech.days} 天）`) : tech.ready ? "沒有特別符合條件的個股" : `均線條件要累積 21 個交易日，目前 ${tech.days} 天` },
  ];
  const view = viewpoint({ taiex: t, otc: o, inst, up: twse.up, down: twse.down, sectors: twse.sectors });
  if (view) fields.push({ name: "💡 CCC 盤後觀點", value: view });
  return safeEmbed({
    title: `📋 台股盤後報告｜${day.replaceAll("-", "/")}`,
    color: t?.change >= 0 ? COLOR.up : COLOR.down, // 台股紅漲綠跌
    fields,
    footer: footer(DISCLAIMER),
    timestamp: new Date().toISOString(),
  });
}

export async function twClose(ctx) {
  let day = twDate(ctx.now);
  if (!ctx.force && !(await isTradingDay(ctx.db, day))) return { skipped: "今天休市" };
  const done = await ctx.db.getState("tw_close_done", {});
  if (!ctx.force && done.day === day && done.auto) return { skipped: "今天已經發過" };
  const today = day;
  const miOf = async (d) => parseTwse(await getJson(`${TWSE}/rwd/zh/afterTrading/MI_INDEX?date=${ymd(d)}&type=ALLBUT0999&response=json`));
  let twse = await miOf(day);
  // 「立即發一次」：今天的還沒出來（例如半夜按）就發最近一個交易日的
  if (ctx.force && (twse.day !== day || !twse.stocks.length)) {
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, -i), wd = new Date(d + "T00:00:00Z").getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const t = await miOf(d);
      if (t.day === d && t.stocks.length) { twse = t; day = d; break; }
    }
  }
  if (twse.day !== day || !twse.stocks.length) return { retry: true, skipped: "證交所今天的收盤資料還沒出來" };
  const [bfi, tpi, tpq] = await Promise.all([
    getJson(`${TWSE}/rwd/zh/fund/BFI82U?type=day&dayDate=${ymd(day)}&response=json`).catch(() => null),
    getJson(`${TPEX_OPEN}/tpex_index`).catch(() => []),
    getJson(`${TPEX_OPEN}/tpex_mainboard_quotes`).catch(() => []),
  ]);
  const tp = parseTpex(tpi, tpq);
  const tpex = tp.day === day ? tp : { otc: tp.otc?.day === day ? tp.otc : null, value: 0, stocks: [] };
  const inst = bfi?.date === ymd(day) ? parseInstitutions(bfi) : null;
  // 技術面只看成交值前段，所以只記成交值前 300 檔，資料不會越存越大
  const prevHist = await ctx.db.getState("tw_hist", {});
  const hist = (prevHist?.days?.at(-1) || "") > day ? prevHist : updateHistory(prevHist, day, [...twse.stocks, ...tpex.stocks].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 300));
  const tech = technicals(hist, [...twse.stocks, ...tpex.stocks]);
  const embed = closeEmbed({ day, twse, tpex, inst, tech });
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await ctx.db.setState("tw_hist", hist);
  if (!ctx.force) await ctx.db.setState("tw_close_done", { day, auto: true }); // 「立即發一次」不算，排程照常發
  return { posted: 1, note: `加權 ${pct(twse.taiex?.pct)}${tpex.stocks.length ? "" : "（上櫃資料還沒出來）"}${inst ? "" : "（法人資料還沒出來）"}` };
}

// ── 每日頭條（台股）──
const NEWS_FEEDS = [
  { url: "https://feeds.feedburner.com/rsscna/finance", source: "中央社" },
  { url: "https://tw.stock.yahoo.com/rss?category=tw-market", source: "Yahoo股市" },
];
const NEWS_RULES = [
  { re: /台股|加權|大盤|櫃買|上市櫃/, why: "大盤動向", w: 3 },
  { re: /外資|投信|法人|籌碼|融資/, why: "資金籌碼", w: 3 },
  { re: /央行|升息|降息|利率|Fed|聯準會|通膨|CPI/i, why: "利率與貨幣政策", w: 4 },
  { re: /台積電|聯發科|鴻海|輝達|NVIDIA|半導體|晶片|AI伺服器|先進製程|CoWoS/i, why: "權值與半導體", w: 3 },
  { re: /關稅|貿易|出口|外銷訂單|景氣|GDP|經濟成長/, why: "總經與貿易", w: 3 },
  { re: /營收|財報|法說|EPS|獲利|股利|除息|配息/, why: "企業基本面", w: 2 },
  { re: /匯率|新台幣|美元/, why: "匯率", w: 2 },
  { re: /地緣|戰爭|制裁|地震|颱風|停電/, why: "突發風險", w: 3 },
];
export function scoreNews(item, rules = NEWS_RULES) {
  const text = `${item.title} ${item.summary || ""}`;
  const hits = rules.filter((r) => r.re.test(text));
  return { score: hits.reduce((a, r) => a + r.w, 0) + (hits.some((r) => r.re.test(item.title)) ? 1 : 0), why: [...new Set(hits.map((r) => r.why))].slice(0, 2).join("、") };
}
export function pickNews(items, { now, lookbackHours = 18, max = 8, minScore = 3, rules = NEWS_RULES, perTopic = 3 } = {}) {
  const since = now.getTime() - lookbackHours * 3600e3;
  const seenTitle = new Set(), topics = new Map();
  return items.filter((x) => !x.ms || x.ms >= since).map((x) => ({ ...x, ...scoreNews(x, rules) })).filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || (b.ms || 0) - (a.ms || 0))
    // 同一件事不同來源：標題拿掉標點後前 8 個字一樣就當同一則
    .filter((x) => { const k = x.title.replace(/[\s\p{P}\p{S}]/gu, "").slice(0, 8); if (seenTitle.has(k)) return false; seenTitle.add(k); return true; })
    // 同一類（例如都是「外資買賣」）最多 3 則，讓頭條有變化
    .filter((x) => { const t = x.why.split("、")[0] || "其他"; const n = topics.get(t) || 0; if (n >= perTopic) return false; topics.set(t, n + 1); return true; })
    .slice(0, max);
}
export function newsEmbed(title, items, { color = COLOR.gold, note = DISCLAIMER, fields } = {}) {
  return safeEmbed({
    title,
    color,
    fields,
    description: items.length ? items.map((x, i) => `**${i + 1}. [${clip(x.title, 90)}](${x.link})**\n${x.source}${x.ms ? `・${new Date(x.ms + 8 * 3600e3).toISOString().slice(5, 16).replace("-", "/").replace("T", " ")}` : ""}${x.why ? `・${x.why}` : ""}`).join("\n\n") : "今天沒有特別重要的新聞。",
    footer: footer(note),
    timestamp: new Date().toISOString(),
  });
}
export async function readFeeds(feeds) {
  const res = await Promise.allSettled(feeds.map(async (f) => parseFeed(await getText(f.url, { headers: { Accept: "application/rss+xml, application/xml, text/xml" } }), f.source)));
  const items = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = feeds.filter((_, i) => res[i].status === "rejected").map((f) => f.source);
  return { items, failed };
}
export async function twNews(ctx) {
  const day = twDate(ctx.now);
  const done = await ctx.db.getState("tw_news_done", {});
  if (!ctx.force && done.day === day && done.auto) return { skipped: "今天已經發過" };
  const { items, failed } = await readFeeds(NEWS_FEEDS);
  if (!items.length) throw new Error(`新聞來源都抓不到（${failed.join("、")}）`);
  const sent = await seenFilter(ctx.db, "tw_news_seen", items.map((x) => x.link));
  const fresh = new Set(ctx.force ? items.map((x) => x.link) : sent.fresh);
  const pick = pickNews(items.filter((x) => fresh.has(x.link)), { now: ctx.now, max: Number(ctx.opts?.max) || 8 });
  // 昨晚美股（抓不到就只發新聞）
  let night = null;
  if (String(ctx.opts?.overnight ?? "on").toLowerCase() !== "off") {
    try {
      const hist = await ctx.db.getState("tw_hist", {});
      night = overnightField(await readOvernight(), { close2330: hist?.c?.["2330"]?.at(-1), now: ctx.now });
    } catch { /* 美股報價暫時抓不到 */ }
  }
  if (!pick.length && !night) return { skipped: "沒有新的重要新聞" };
  const embed = newsEmbed(`🗞️ 台股每日頭條｜${md(day)}`, pick, { fields: night ? [night] : undefined, note: `只放標題和原文連結${night ? "；美股報價來自 Yahoo Finance" : ""}${failed.length ? `；${failed.join("、")}暫時抓不到` : ""}` });
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await sent.commit(pick.map((x) => x.link));
  if (!ctx.force) await ctx.db.setState("tw_news_done", { day, auto: true }); // 「立即發一次」不算，排程照常發
  return { posted: 1, note: `${pick.length} 則` };
}

// ── 重大訊息雷達 ──
const DISC_RULES = [
  { re: /合併|收購|併購|公開收購|股份轉換|分割/, w: 6, tag: "併購" },
  { re: /處分|取得.*(資產|股權|廠房|土地|設備|使用權)|出售/, w: 3, tag: "資產交易" },
  { re: /現金增資|私募|減資|庫藏股|買回/, w: 6, tag: "股本變動" },
  { re: /暫停交易|停止買賣|終止上市|終止上櫃|下市|恢復交易/, w: 7, tag: "交易異動" },
  { re: /重整|破產|跳票|違約|退票|債務/, w: 7, tag: "財務危機" },
  { re: /虧損|重大差異|營收.*(大幅|創新高|衰退)|減損/, w: 3, tag: "財務" },
  { re: /董事長|總經理|財務主管|會計主管|發言人|董事.*(辭任|解任)/, w: 3, tag: "經營層" },
  { re: /澄清|媒體報導|報載/, w: 3, tag: "澄清報導" },
  { re: /火災|爆炸|停工|罷工|災害|地震|資安|駭客|勒索/, w: 6, tag: "突發事件" },
  { re: /訴訟|判決|裁罰|起訴|搜索|檢調/, w: 4, tag: "法律" },
  { re: /股利|配息|除權|除息/, w: 2, tag: "股利" },
  { re: /重大合約|簽訂.*合約|訂單|得標|策略聯盟|合作/, w: 3, tag: "合約訂單" },
];
const DISC_SKIP = /公告本公司.*(名稱|面額).*變更.*公告期間|代子公司公告.*背書|股東常會|法說會.*(資料|簡報)|更正|負債比率|流動比率|速動比率|不予執行/;
// 「合併財務報告」「合併營收」是會計用語，不是併購
const ACCOUNTING = /合併(財務|報表|營收|損益|自結|綜合|資產負債|公司|後)|自結合併|列入合併/g;
export function scoreDisclosure(subject) {
  if (DISC_SKIP.test(subject)) return { score: 0, tags: [] };
  const text = subject.replace(ACCOUNTING, "");
  const hits = DISC_RULES.filter((r) => r.re.test(text));
  return { score: hits.reduce((a, r) => a + r.w, 0), tags: hits.map((r) => r.tag) };
}
export function parseDisclosures(twse, tpex) {
  const a = (twse || []).map((r) => { const n = normKeys(r); return { code: String(n["公司代號"] || "").trim(), name: String(n["公司名稱"] || "").trim(), subject: String(n["主旨"] || "").replace(/\s+/g, " ").trim(), date: rocToDate(n["發言日期"]), time: String(n["發言時間"] || "").padStart(6, "0"), market: "上市" }; });
  const b = (tpex || []).map((r) => { const n = normKeys(r); return { code: String(n.securitiescompanycode || "").trim(), name: String(n.companyname || "").trim(), subject: String(n["主旨"] || "").replace(/\s+/g, " ").trim(), date: rocToDate(n["發言日期"]), time: String(n["發言時間"] || "").padStart(6, "0"), market: "上櫃" }; });
  return [...a, ...b].filter((x) => x.code && x.subject).map((x) => ({ ...x, id: `${x.code}|${x.date}|${x.time}|${x.subject.slice(0, 40)}` }));
}
export async function twDisclosure(ctx) {
  const o = ctx.opts || {};
  const watch = new Set(String(o.watch || "2330,2317,2454,2308,2382,2303,3711,2891").split(/[\s,，、]+/).filter(Boolean));
  const minScore = Number(o.minScore ?? 6), watchMin = Number(o.watchMinScore ?? 2);
  const [a, b] = await Promise.all([getJson(`${TWSE_OPEN}/opendata/t187ap04_L`), getJson(`${TPEX_OPEN}/mopsfin_t187ap04_O`).catch(() => [])]);
  const all = parseDisclosures(a, b);
  const sent = await seenFilter(ctx.db, "tw_disc_seen", all.map((x) => x.id), { keep: 3000 });
  if (sent.first && !ctx.force) { await sent.commit(all.map((x) => x.id)); return { skipped: `第一次啟用：記下現有 ${all.length} 則當基準，之後只發新的` }; }
  const fresh = new Set(ctx.force ? all.map((x) => x.id) : sent.fresh);
  const scored = all.filter((x) => fresh.has(x.id)).map((x) => ({ ...x, ...scoreDisclosure(x.subject), watched: watch.has(x.code) }))
    .filter((x) => x.score >= (x.watched ? watchMin : minScore)).sort((p, q) => Number(q.watched) - Number(p.watched) || q.score - p.score).slice(0, 8);
  if (!scored.length) { if (!ctx.dryRun) await sent.commit(all.map((x) => x.id)); return { skipped: "沒有新的高影響公告" }; }
  const embed = safeEmbed({
    title: `📣 台股重大訊息雷達｜${scored.length} 則`,
    color: COLOR.warn,
    fields: scored.map((x) => ({ name: `${x.watched ? "⭐ " : ""}${x.name}（${x.code}・${x.market}）${x.tags.length ? `｜${x.tags.join("、")}` : ""}`, value: `${clip(x.subject, 300)}\n${x.date ? md(x.date) : ""} ${x.time.slice(0, 2)}:${x.time.slice(2, 4)}・[公開資訊觀測站](https://mops.twse.com.tw/mops/web/t05sr01_1)` })),
    footer: footer(`⭐ 是自選股；${DISCLAIMER}`),
    timestamp: new Date().toISOString(),
  });
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await sent.commit(all.map((x) => x.id));
  return { posted: 1, note: `${scored.length} 則` };
}

// ── 法人籌碼雷達 ──
export function parseFlows(t86, tpexRows) {
  const out = new Map();
  if (t86?.data?.length) {
    const f = t86.fields || [];
    const at = (re) => f.findIndex((x) => re.test(x));
    const iF = at(/^外陸資買賣超股數\(不含外資自營商\)/), iT = at(/^投信買賣超股數/), iD = at(/^自營商買賣超股數$/);
    for (const r of t86.data) {
      const code = String(r[0]).trim();
      if (!isCommon(code, r[1])) continue;
      out.set(code, { code, name: String(r[1]).trim(), market: "上市", foreign: num(r[iF]) || 0, trust: num(r[iT]) || 0, dealer: num(r[iD]) || 0 });
    }
  }
  for (const raw of tpexRows || []) {
    const r = normKeys(raw);
    const code = String(r.securitiescompanycode || "").trim();
    if (!isCommon(code, r.companyname)) continue;
    out.set(code, { code, name: String(r.companyname || "").trim(), market: "上櫃", foreign: num(r["foreigninvestorsincludemainlandareainvestors(foreigndealersexcluded)-difference"]) || 0, trust: num(r["securitiesinvestmenttrustcompanies-difference"]) || 0, dealer: num(r["dealers-difference"]) || 0 });
  }
  return [...out.values()];
}
// 連買連賣：記每天外資、投信的買賣方向（+1／-1／0），最多 20 天
export function updateStreaks(st, day, flows) {
  if (st?.day === day) return st; // 同一天重跑不要重算
  const next = { day, f: {}, t: {} };
  const step = (prev, x) => { const d = Math.sign(x); return d === 0 ? 0 : Math.sign(prev || 0) === d ? prev + d : d; };
  for (const x of flows) {
    next.f[x.code] = step(st?.f?.[x.code], x.foreign);
    next.t[x.code] = step(st?.t?.[x.code], x.trust);
  }
  return next;
}
const lots = (shares) => Math.round(shares / 1000);
export function flowEmbed(day, flows, streaks, watch) {
  const row = (x, k) => `${x.name}（${x.code}）${lots(x[k]) > 0 ? "+" : ""}${lots(x[k]).toLocaleString("en-US")} 張`;
  const top = (k, dir) => [...flows].filter((x) => dir * x[k] > 0).sort((a, b) => dir * (b[k] - a[k])).slice(0, 5);
  const both = flows.filter((x) => x.foreign > 0 && x.trust > 0).sort((a, b) => b.foreign + b.trust - (a.foreign + a.trust)).slice(0, 5);
  const streak = (k, dir) => flows.map((x) => ({ ...x, n: streaks?.[k]?.[x.code] || 0 })).filter((x) => dir * x.n >= 3).sort((a, b) => dir * (b.n - a.n) || Math.abs(b.foreign) - Math.abs(a.foreign)).slice(0, 5);
  const mine = flows.filter((x) => watch.has(x.code));
  const fields = [
    { name: "🌏 外資買超前五", value: top("foreign", 1).map((x) => row(x, "foreign")).join("\n") },
    { name: "🌏 外資賣超前五", value: top("foreign", -1).map((x) => row(x, "foreign")).join("\n") },
    { name: "🏦 投信買超前五", value: top("trust", 1).map((x) => row(x, "trust")).join("\n") },
    { name: "🤝 外資＋投信同步買", value: both.map((x) => `${x.name}（${x.code}）外資 ${lots(x.foreign).toLocaleString("en-US")}・投信 ${lots(x.trust).toLocaleString("en-US")} 張`).join("\n") || "今天沒有" },
  ];
  const sb = streak("f", 1), ss = streak("f", -1), tb = streak("t", 1);
  if (sb.length || ss.length || tb.length) fields.push({ name: "📅 連續買賣（3 天以上）", value: [
    sb.length ? `外資連買：${sb.map((x) => `${x.name} ${x.n} 天`).join("、")}` : "",
    ss.length ? `外資連賣：${ss.map((x) => `${x.name} ${-x.n} 天`).join("、")}` : "",
    tb.length ? `投信連買：${tb.map((x) => `${x.name} ${x.n} 天`).join("、")}` : "",
  ].filter(Boolean).join("\n") });
  if (mine.length) fields.push({ name: "⭐ 自選股", value: mine.map((x) => `${x.name}（${x.code}）外資 ${lots(x.foreign).toLocaleString("en-US")}・投信 ${lots(x.trust).toLocaleString("en-US")}・自營 ${lots(x.dealer).toLocaleString("en-US")} 張`).join("\n") });
  return safeEmbed({ title: `🧾 法人籌碼雷達｜${day.replaceAll("-", "/")}`, description: "上市＋上櫃一般股票，張數＝官方股數 ÷ 1,000；排除 ETF、權證。", color: COLOR.gold, fields, footer: footer(DISCLAIMER), timestamp: new Date().toISOString() });
}
export async function twFlow(ctx) {
  let day = twDate(ctx.now);
  if (!ctx.force && !(await isTradingDay(ctx.db, day))) return { skipped: "今天休市" };
  const done = await ctx.db.getState("tw_flow_done", {});
  if (!ctx.force && done.day === day && done.auto) return { skipped: "今天已經發過" };
  const t86Of = (d) => getJson(`${TWSE}/rwd/zh/fund/T86?date=${ymd(d)}&selectType=ALLBUT0999&response=json`);
  let t86 = await t86Of(day);
  // 「立即發一次」：今天的還沒出來就發最近一個交易日的
  if (ctx.force && (t86?.date !== ymd(day) || !t86?.data?.length)) {
    const today = day;
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, -i), wd = new Date(d + "T00:00:00Z").getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const t = await t86Of(d);
      if (t?.date === ymd(d) && t?.data?.length) { t86 = t; day = d; break; }
    }
  }
  const tp = await getJson(`${TPEX_OPEN}/tpex_3insti_daily_trading`).catch(() => []);
  if (t86?.date !== ymd(day) || !t86?.data?.length) return { retry: true, skipped: "證交所今天的法人資料還沒出來" };
  const tpToday = (tp || []).filter((r) => rocToDate(r.Date) === day);
  const flows = parseFlows(t86, tpToday);
  const prevStreaks = await ctx.db.getState("tw_flow_streaks", {});
  const streaks = (prevStreaks?.day || "") > day ? prevStreaks : updateStreaks(prevStreaks, day, flows);
  const watch = new Set(String(ctx.opts?.watch || "2330,2317,2454,2308,2382,2303,3711,2891").split(/[\s,，、]+/).filter(Boolean));
  const embed = flowEmbed(day, flows, streaks, watch);
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await ctx.db.setState("tw_flow_streaks", streaks);
  if (!ctx.force) await ctx.db.setState("tw_flow_done", { day, auto: true }); // 「立即發一次」不算，排程照常發
  return { posted: 1, note: `${flows.length} 檔${tpToday.length ? "" : "（上櫃資料還沒出來）"}` };
}

export { twHM, twWeekday };
