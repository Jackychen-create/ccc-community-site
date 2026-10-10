// 登入驗證與權限：研究員、管理員
import { env, supabaseAdmin } from "./env.js";
import { todayTW } from "./dates.js";

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
    .select("user_id, banned, access_until, notify, created_at")
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
export async function requireMember(req, res) {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: "請先登入" });
    return null;
  }
  const member = await memberRow(user.id);
  if (!member && adminEligible(user)) return { user, isAdmin: true };
  if (!member || member.banned) {
    res.status(403).json({ error: "這個帳號目前沒有觀看權限，請聯絡管理員" });
    return null;
  }
  // 每月資格：過了到期日就不能看（到期日當天還可以）
  if (member.access_until && member.access_until < todayTW()) {
    res.status(403).json({ error: `你的觀看資格到 ${member.access_until} 為止，請聯絡管理員更新`, code: "expired" });
    return null;
  }
  return { user, isAdmin: false, member };
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
  return { user };
}
