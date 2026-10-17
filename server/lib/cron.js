// 排程呼叫網站時的密碼檢查：Header X-Cron-Secret 要等於 Cloudflare 的 CRON_SECRET
import { env } from "./env.js";

// 逐字比較（時間固定），避免從回應時間猜出密碼
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const cronAuthorized = (req) => !!env.CRON_SECRET && same(req.headers?.["x-cron-secret"] || "", env.CRON_SECRET);
