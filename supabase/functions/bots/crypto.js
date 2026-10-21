// 加密：鏈上行情總覽、行情異動提醒、OKX／Bybit 官方公告
// 行情來自 DEX Screener 公開 API（鏈上穩定幣交易池），不是交易所報價，也不是原生 BTC/ETH 的全市場價格
import { COLOR, getJson, safeEmbed, footer, seenFilter, twDate, twStamp, md, clip, fmt, pct } from "./core.js";

const DISCLAIMER = "資訊整理，不是投資建議";
// 追蹤的代幣：以太坊 WBTC、WETH，Solana 包裝 SOL；只看 USDC／USDT 交易池
export const TOKENS = [
  { sym: "BTC", label: "WBTC（以太坊）", chain: "ethereum", addr: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  { sym: "ETH", label: "WETH（以太坊）", chain: "ethereum", addr: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
  { sym: "SOL", label: "SOL（Solana）", chain: "solana", addr: "So11111111111111111111111111111111111111112" },
];
const STABLES = {
  ethereum: ["0xa0b86991c6218b36c1d19d4a2e9eb10ce3606eb48", "0xdac17f958d2ee523a2206206994597c13d831ec7"],
  solana: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCLEJtDNYB"].map((x) => x.toLowerCase()),
};
const MIN_LIQ = 100000;
// 這個代幣在指定鏈上、配穩定幣、流動性夠的池子裡，取流動性最高的一個
export function bestPool(token, pairs) {
  const st = STABLES[token.chain] || [];
  const ok = (pairs || []).filter((p) => p.chainId === token.chain
    && String(p.baseToken?.address || "").toLowerCase() === token.addr.toLowerCase()
    && st.includes(String(p.quoteToken?.address || "").toLowerCase())
    && Number(p.liquidity?.usd) >= MIN_LIQ && Number(p.priceUsd) > 0);
  ok.sort((a, b) => Number(b.liquidity.usd) - Number(a.liquidity.usd));
  const p = ok[0];
  if (!p) return null;
  return { sym: token.sym, label: token.label, price: Number(p.priceUsd), h1: p.priceChange?.h1 ?? null, h24: p.priceChange?.h24 ?? null, vol: Number(p.volume?.h24) || 0, liq: Number(p.liquidity.usd), dex: `${p.dexId} ${p.baseToken.symbol}/${p.quoteToken.symbol}`, url: p.url };
}
async function readPools() {
  const res = await Promise.allSettled(TOKENS.map((t) => getJson(`https://api.dexscreener.com/token-pairs/v1/${t.chain}/${t.addr}`)));
  const pools = [], missing = [];
  TOKENS.forEach((t, i) => {
    const p = res[i].status === "fulfilled" ? bestPool(t, res[i].value) : null;
    if (p) pools.push(p); else missing.push(t.sym);
  });
  return { pools, missing };
}
const usd = (n) => (n >= 1e9 ? `$${fmt(n / 1e9, 2)}B` : n >= 1e6 ? `$${fmt(n / 1e6, 1)}M` : `$${fmt(n / 1e3, 0)}K`);
const price = (n) => `$${fmt(n, n >= 1000 ? 0 : 2)}`;
const FNG = { "Extreme Fear": "極度恐慌", Fear: "恐慌", Neutral: "中性", Greed: "貪婪", "Extreme Greed": "極度貪婪" };

export function digestEmbed(day, pools, { fng, missing = [] } = {}) {
  const avg = pools.length ? pools.reduce((a, p) => a + (p.h24 || 0), 0) / pools.length : 0;
  const mood = avg >= 3 ? "整體偏強" : avg <= -3 ? "整體偏弱" : "整體震盪";
  return safeEmbed({
    title: `🪙 鏈上行情總覽｜${md(day)}`,
    color: avg >= 0 ? COLOR.up : COLOR.down,
    description: `${mood}（24 小時平均 ${pct(avg)}）${fng ? `・恐慌貪婪指數 **${fng.value}**（${FNG[fng.cls] || fng.cls}）` : ""}`,
    fields: pools.map((p) => ({ name: `${p.sym}　${price(p.price)}`, value: `1 小時 ${pct(p.h1)}・24 小時 ${pct(p.h24)}\n池成交量 ${usd(p.vol)}・流動性 ${usd(p.liq)}\n[${p.dex}](${p.url})`, inline: true })),
    footer: footer(`DEX Screener 鏈上穩定幣池報價，不是交易所報價；成交量是單一池${missing.length ? `；${missing.join("、")} 暫時抓不到` : ""}・${DISCLAIMER}`),
    timestamp: new Date().toISOString(),
  });
}
export async function cryptoDigest(ctx) {
  const day = twDate(ctx.now);
  const done = await ctx.db.getState("crypto_digest_done", {});
  if (!ctx.force && done.day === day) return { skipped: "今天已經發過" };
  const [{ pools, missing }, fngRes] = await Promise.all([readPools(), getJson("https://api.alternative.me/fng/?limit=1").catch(() => null)]);
  if (!pools.length) throw new Error("DEX Screener 抓不到資料");
  const f = fngRes?.data?.[0];
  const embed = digestEmbed(day, pools, { fng: f ? { value: f.value, cls: f.value_classification } : null, missing });
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await ctx.db.setState("crypto_digest_done", { day });
  return { posted: 1, note: pools.map((p) => `${p.sym} ${pct(p.h24)}`).join("、") };
}

// 異動提醒：第一次跨過門檻才發；回到門檻的一半以內才重新計算
export function checkMoves(pools, state, { th1 = 3, th24 = 8 } = {}) {
  const next = { ...state }, hits = [];
  for (const p of pools) {
    for (const [k, th] of [["h1", th1], ["h24", th24]]) {
      const v = p[k], key = `${p.sym}_${k}`;
      if (v == null) continue;
      const dir = v >= th ? 1 : v <= -th ? -1 : 0;
      if (dir && next[key] !== dir) { hits.push({ ...p, k, v, dir }); next[key] = dir; }
      else if (!dir && Math.abs(v) < th / 2) next[key] = 0;
    }
  }
  return { hits, next };
}
export function moveEmbed(hits, now) {
  return safeEmbed({
    title: `⚡ 行情異動提醒`,
    color: hits[0].dir > 0 ? COLOR.up : COLOR.down,
    description: hits.map((h) => `**${h.sym}** ${h.k === "h1" ? "1 小時" : "24 小時"} ${h.dir > 0 ? "急漲" : "急跌"} **${pct(h.v)}**　現價 ${price(h.price)}\n　1 小時 ${pct(h.h1)}・24 小時 ${pct(h.h24)}・[${h.dex}](${h.url})`).join("\n"),
    footer: footer(`${twStamp(now.getTime())}・DEX Screener 鏈上池報價，不是交易所報價・${DISCLAIMER}`),
    timestamp: new Date().toISOString(),
  });
}
export async function cryptoAlert(ctx) {
  const { pools } = await readPools();
  if (!pools.length) throw new Error("DEX Screener 抓不到資料");
  const st = await ctx.db.getState("crypto_alert_state", {});
  const { hits, next } = checkMoves(pools, ctx.force || ctx.dryRun ? {} : st, { th1: Number(ctx.opts?.th1) || 3, th24: Number(ctx.opts?.th24) || 8 });
  if (!hits.length) {
    if (!ctx.dryRun) await ctx.db.setState("crypto_alert_state", next);
    return ctx.dryRun ? { note: `現在沒有跨過門檻：${pools.map((p) => `${p.sym} 1h ${pct(p.h1)}／24h ${pct(p.h24)}`).join("、")}` } : { skipped: "沒有異動" };
  }
  const embed = moveEmbed(hits, ctx.now);
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await ctx.db.setState("crypto_alert_state", next);
  return { posted: 1, note: hits.map((h) => `${h.sym} ${pct(h.v)}`).join("、") };
}

// ── 交易所官方公告 ──
const OKX_TYPES = { "announcements-new-listings": "上新", "announcements-delistings": "下架", "announcements-trading-updates": "交易規則", "announcements-deposit-withdrawal-suspension-resumption": "充提", "announcements-api": "API", "announcements-system-maintenance": "維護", "announcements-latest-announcements": "最新", "announcements-fees": "費率" };
export function parseOkx(j, { now, hours = 72 }) {
  const since = now.getTime() - hours * 3600e3;
  return (j?.data?.[0]?.details || []).filter((d) => OKX_TYPES[d.annType] && Number(d.pTime) >= since)
    .map((d) => ({ id: d.url, title: d.title, url: d.url, ms: Number(d.pTime), tag: OKX_TYPES[d.annType] }));
}
const BYBIT_TYPES = { new_crypto: "上新", delistings: "下架", maintenance_updates: "維護與規則", latest_bybit_news: "平台異動" };
const PROMO = /獎|抽|瓜分|空投|活動|迎新|折扣|返佣|贈|賺幣|大賽|嘉年華/;
export function parseBybit(j, { now, hours = 72 }) {
  const since = now.getTime() - hours * 3600e3;
  return (j?.result?.list || []).filter((d) => BYBIT_TYPES[d.type?.key] && !PROMO.test(d.title) && Number(d.publishTime || d.dateTimestamp) >= since)
    .map((d) => ({ id: d.url, title: String(d.title).trim(), url: d.url, ms: Number(d.publishTime || d.dateTimestamp), tag: BYBIT_TYPES[d.type.key] }));
}
export function annEmbed(name, list, color) {
  return safeEmbed({
    title: `📢 ${name} 官方公告（${list.length}）`,
    color,
    description: list.map((x) => `**[${clip(x.title, 120)}](${x.url})**\n${x.tag}・${twStamp(x.ms).slice(5)}`).join("\n\n"),
    footer: footer(`以 ${name} 官方公告為準・${DISCLAIMER}`),
    timestamp: new Date().toISOString(),
  });
}
async function announcements(ctx, { key, name, color, read }) {
  const items = (await read()).sort((a, b) => b.ms - a.ms);
  const seen = await seenFilter(ctx.db, `${key}_seen`, items.map((x) => x.id));
  const fresh = ctx.dryRun || ctx.force ? items.slice(0, 8) : items.filter((x) => seen.fresh.includes(x.id)).slice(0, 8);
  if (!fresh.length) return { skipped: "沒有新公告" };
  const embed = annEmbed(name, fresh, color);
  if (ctx.dryRun) return { preview: [embed] };
  await ctx.post({ embeds: [embed] });
  await seen.commit(fresh.map((x) => x.id));
  return { posted: 1, note: `${fresh.length} 則` };
}
export const okxNews = (ctx) => announcements(ctx, { key: "okx_news", name: "OKX", color: 0x2b2b2b, read: async () => parseOkx(await getJson("https://www.okx.com/api/v5/support/announcements"), { now: ctx.now }) });
export const bybitNews = (ctx) => announcements(ctx, { key: "bybit_news", name: "Bybit", color: 0xf7a600, read: async () => parseBybit(await getJson("https://api.bybit.com/v5/announcements/index?locale=zh-TW&limit=30"), { now: ctx.now }) });
