// 管理員權限：伺服器和後台畫面都讀這一份
// owner：主要管理員（CCC、X），全部功能
// editor：協作管理員（例如 OC），只能管影片、回提問、看統計、看研究員名單（不能停權、重設密碼、改資格）
// 誰是 editor 存在資料庫 settings 的 admin_roles：{ "email": "editor" }；沒列到的管理員都是 owner
export const ROLE_LABEL = { owner: "主要管理員", editor: "協作管理員" };

// 後台側欄每一頁誰看得到
export const VIEWS_FOR = {
  owner: ["videos", "invites", "discord", "members", "volumes", "stats", "feedback", "followup", "health"],
  editor: ["videos", "members", "stats", "feedback"],
};

// editor 可以用的後台 API（"*" 是全部方法）
const EDITOR_API = {
  "admin/videos": "*",
  "admin/upload-url": "*",
  "admin/attachments": "*",
  "admin/notify": "*",
  "admin/feedback": "*",
  "admin/stats": "*",
  "admin/members": ["GET"], // 只能看
};

export function canUseApi(role, route, method) {
  if (role !== "editor") return true;
  const rule = EDITOR_API[route];
  return rule === "*" || (Array.isArray(rule) && rule.includes(method));
}
export const canSeeView = (role, view) => (VIEWS_FOR[role] || VIEWS_FOR.editor).includes(view);
export const canManageMembers = (role) => role !== "editor";
