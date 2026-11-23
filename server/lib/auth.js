// 登入驗證與權限：研究員、管理員
import { env, supabaseAdmin } from "./env.js";
import { memberTier } from "./tier.js";
import { SITE_TIER, tierName, tierRuleText } from "../../public/assets/js/shared/rules.js";
import { canUseApi } from "../../public/assets/js/shared/roles.js";
export { ROLE_LABEL, VIEWS_FOR, canUseApi } from "../../public/assets/js/shared/roles.js";

// 這位管理員是 owner、editor 還是 removed（settings 的 admin_roles；沒列到就是 owner）
// removed：已經停止合作的管理員（例如 OC，2026-11-09），就算還在 Cloudflare 的 ADMIN_EMAILS 裡也不能用後台
export async function adminRole(email) {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "admin_roles").maybeSingle();
  const r = data?.value?.[String(email || "").trim().toLowerCase()];
  return r === "editor" || r === "removed" ? r : "owner";
}

export function adminEmails() {
  return (env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return !!email && adminEmails().includes(String(email).trim().toLowerCase());
}

// 管理員：Email 在名單內、Email 已驗證，而且「不是」用實驗室密碼加入的研究員帳號。
// 研究員註冊時 Email 沒有經過收信驗證，所以研究員帳號永遠不能變成管理員，
// 就算之後把同一個 Email 加進 ADMIN_EMAILS 也一樣。
function adminEligible(user) {
  return isAdminEmail(user?.email) && !!user?.email_confirmed_at;
}

async function memberRow(userId) {
  const { data, error } = await supabaseAdmin
    .from("members")
    .select("user_id, email, banned, access_until, min_tier, min_tier_until, notify, created_at, free, theme")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getUser(req) {
  const auth = req.headers?.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// 研究員或管理員才放行；失敗時直接回應錯誤並回傳 null
// minTier：這個功能至少要第幾級（預設第二級＝網站內容；個人資料、提問、直播預告等用 0）
export async function requireMember(req, res, { minTier = SITE_TIER } = {}) {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: "請先登入" });
    return null;
  }
  const member = await memberRow(user.id);
  if (!member && adminEligible(user)) {
    if ((await adminRole(user.email)) === "removed") {
      res.status(403).json({ error: "這個帳號目前沒有觀看權限，請聯絡管理員" });
      return null;
    }
    return { user, isAdmin: true };
  }
  if (!member || member.banned) {
    res.status(403).json({ error: "這個帳號目前沒有觀看權限，請聯絡管理員" });
    return null;
  }
  // 三級制度：今天是第幾級（規則在 shared/rules.js）
  const tier = await memberTier(member);
  if (tier.tier < minTier) {
    res.status(403).json({ error: `這個內容要${tierName(minTier)}（這一輪 ${tierRuleText(minTier)}）`, code: "tier", tier: tier.tier });
    return null;
  }
  return { user, isAdmin: false, member, tier };
}

export async function requireAdmin(req, res) {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: "請先登入" });
    return null;
  }
  if (!adminEligible(user) || (await memberRow(user.id))) {
    res.status(403).json({ error: "只有管理員可以使用後台" });
    return null;
  }
  // 協作管理員只能用部分功能（規則在 shared/roles.js）
  const role = await adminRole(user.email);
  if (role === "removed") {
    res.status(403).json({ error: "只有管理員可以使用後台" });
    return null;
  }
  if (!canUseApi(role, req.route || "", req.method)) {
    res.status(403).json({ error: "這個功能只有主要管理員可以使用", code: "owner_only" });
    return null;
  }
  return { user, role };
}
