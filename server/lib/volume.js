// 每月交易量：門檻、金額整理（規則在 shared/rules.js）
import { supabaseAdmin } from "./env.js";
import { EXCHANGES, DEFAULT_THRESHOLD } from "../../public/assets/js/shared/rules.js";
export { EXCHANGES, DEFAULT_THRESHOLD, isQualified } from "../../public/assets/js/shared/rules.js";

export async function getThreshold() {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "volume_threshold").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD;
}
// 只收三間交易所、0 以上的數字，四捨五入到小數 2 位
export function cleanAmounts(v) {
  const out = {};
  for (const ex of EXCHANGES) {
    const n = Number(v?.[ex]);
    if (Number.isFinite(n) && n >= 0 && n <= 1e13) out[ex] = Math.round(n * 100) / 100;
  }
  return out;
}
