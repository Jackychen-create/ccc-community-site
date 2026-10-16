// 自動同步交易量的交易所（BingX、Bybit）：綁定時怎麼確認、怎麼同步一個月，都登記在這裡
// 觸發：每天排程（/api/cron/sync，由 Supabase 在東京發出）、後台「立即同步」、研究員剛綁定時（只同步他一個人）
import { supabaseAdmin } from "./env.js";
import { bingxConfigured, checkInvite } from "./bingx.js";
import { syncBingx } from "./bingx-sync.js";
import { bybitConfigured, checkBybitClient } from "./bybit.js";
import { syncBybit } from "./bybit-sync.js";
import { AUTO_EXCHANGES } from "../../public/assets/js/shared/rules.js";

export const PROVIDERS = {
  BingX: { configured: bingxConfigured, check: checkInvite, sync: syncBingx, keys: "BINGX_API_KEY、BINGX_SECRET_KEY" },
  Bybit: { configured: bybitConfigured, check: checkBybitClient, sync: syncBybit, keys: "BYBIT_API_KEY、BYBIT_SECRET_KEY" },
};

async function readStatus() {
  const { data } = await supabaseAdmin.from("settings").select("key, value").in("key", ["auto_sync", "bingx_sync"]);
  const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return { ...(by.bingx_sync ? { BingX: by.bingx_sync } : {}), ...(by.auto_sync || {}) };
}

// 同步一間交易所（沒設定 Key 的跳過），結果記在 settings.auto_sync
export async function syncExchange(exchange) {
  const p = PROVIDERS[exchange];
  const status = { at: new Date().toISOString(), ok: true };
  try {
    Object.assign(status, await p.sync()); // { users, saved, extended }；每人的這一輪（上一輪剛結束 3 天內也補一次）
  } catch (e) {
    status.ok = false;
    status.error = String(e?.message || e).slice(0, 300);
  }
  const all = await readStatus();
  all[exchange] = status;
  await supabaseAdmin.from("settings").upsert({ key: "auto_sync", value: all });
  return status;
}

// 同步所有設定好的交易所
export async function syncAll() {
  const out = {};
  for (const ex of AUTO_EXCHANGES) if (PROVIDERS[ex]?.configured()) out[ex] = await syncExchange(ex);
  return out;
}

// 後台用：每間的設定狀態、綁定人數、上次同步結果
export async function syncOverview() {
  const [last, { data: links }] = await Promise.all([
    readStatus(),
    supabaseAdmin.from("exchange_links").select("exchange"),
  ]);
  const count = {};
  for (const l of links || []) count[l.exchange] = (count[l.exchange] || 0) + 1;
  return Object.fromEntries(AUTO_EXCHANGES.map((ex) => [ex, { configured: PROVIDERS[ex].configured(), linked: count[ex] || 0, last: last[ex] || null }]));
}
