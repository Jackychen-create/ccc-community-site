// 會員制度設定（settings 表的 membership）：{ unitFrom: "YYYY-MM-DD" }
// unitFrom 那天起改用單位制（累計每 20 萬解鎖一份系統分享，規則在 shared/rules.js），空白＝還是三級制度
import { supabaseAdmin } from "./env.js";
import { todayTW } from "./dates.js";
import { isUnitOn } from "../../public/assets/js/shared/rules.js";

export async function getMembership() {
  const { data, error } = await supabaseAdmin.from("settings").select("value").eq("key", "membership").maybeSingle();
  if (error) throw error;
  return data?.value || {};
}
export async function saveMembership(v) {
  const { error } = await supabaseAdmin.from("settings").upsert({ key: "membership", value: v });
  if (error) throw error;
}
// 今天是不是單位制；讀不到設定就當三級制度
export async function unitOn(today = todayTW()) {
  const m = await getMembership().catch(() => ({}));
  return isUnitOn(m.unitFrom, today);
}
