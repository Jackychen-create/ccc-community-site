// 昨晚美股：台股早上 08:00 的頭條一起附上（Yahoo Finance 公開報價，美股收盤後的價格）
// 台積電 ADR 溢價：ADR 1 股＝台股 5 股，用新台幣匯率換算後跟台股前一天收盤比
import { getJson, fmt, pct, arrow } from "./core.js";

const UA_BROWSER = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36" };
export const OVERNIGHT = [
  { sym: "^GSPC", name: "S&P 500" },
  { sym: "^IXIC", name: "那斯達克" },
  { sym: "^DJI", name: "道瓊" },
  { sym: "^SOX", name: "費城半導體" },
  { sym: "TSM", name: "台積電 ADR" },
  { sym: "NVDA", name: "輝達" },
  { sym: "^VIX", name: "VIX 恐慌指數" },
  { sym: "^TNX", name: "美 10 年債殖利率" },
  { sym: "TWD=X", name: "美元兌新台幣" },
];

export function parseSpark(j) {
  const out = {};
  for (const r of j?.spark?.result || []) {
    const m = r?.response?.[0]?.meta;
    if (!m || m.regularMarketPrice == null) continue;
    out[r.symbol] = { price: Number(m.regularMarketPrice), pct: m.regularMarketChangePercent != null ? Number(m.regularMarketChangePercent) : null, at: Number(m.regularMarketTime) * 1000 || null };
  }
  return out;
}
export async function readOvernight() {
  const syms = OVERNIGHT.map((x) => encodeURIComponent(x.sym)).join(",");
  return parseSpark(await getJson(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${syms}&range=5d&interval=1d`, { headers: UA_BROWSER }));
}
// ADR 溢價（%）：(ADR × 匯率 ÷ 5) ÷ 台股收盤 − 1
export function adrPremium(adr, twd, close2330) {
  if (!adr || !twd || !close2330) return null;
  return ((adr * twd) / 5 / close2330 - 1) * 100;
}
export function overnightField(q, { close2330, now = new Date() } = {}) {
  if (!q || !Object.keys(q).length) return null;
  const lines = [];
  for (const x of OVERNIGHT) {
    const v = q[x.sym];
    if (!v) continue;
    if (x.sym === "TWD=X") { lines.push(`${x.name} ${fmt(v.price, 3)}`); continue; }
    if (x.sym === "^TNX") { lines.push(`${x.name} ${fmt(v.price, 2)}%`); continue; }
    lines.push(`${arrow(v.pct)} ${x.name} ${fmt(v.price, x.sym.startsWith("^") ? 2 : 2)}（${pct(v.pct)}）`);
  }
  const prem = adrPremium(q.TSM?.price, q["TWD=X"]?.price, close2330);
  if (prem != null) lines.push(`台積電 ADR 溢價 ${pct(prem)}（對台股前一天收盤 ${fmt(close2330, 0)}）`);
  // 美股週末、假日沒開：寫清楚是哪一天的收盤
  const at = q["^GSPC"]?.at;
  const old = at && now.getTime() - at > 30 * 3600e3;
  if (old) lines.push(`（美股 ${new Date(at - 4 * 3600e3).toISOString().slice(5, 10).replace("-", "/")} 的收盤，之後休市）`);
  return lines.length ? { name: "🌙 昨晚美股", value: lines.join("\n") } : null;
}
