// 管理員權限：伺服器和後台畫面都讀這一份
// owner：主要管理員（CCC、X），全部功能
// editor：協作管理員（例如 OC），只能管影片、直播預告、一對一、回提問、看統計、看研究員名單（不能停權、重設密碼、改等級）
// 誰是 editor 存在資料庫 settings 的 admin_roles：{ "email": "editor" }；沒列到的管理員都是 owner
export const ROLE_LABEL = { owner: "主要管理員", editor: "協作管理員" };

// 後台側欄每一頁誰看得到
export const VIEWS_FOR = {
  owner: ["videos", "lives", "invites", "discord", "members", "volumes", "oneonone", "stats", "feedback", "followup", "health", "chat", "bots"],
  editor: ["videos", "lives", "members", "oneonone", "stats", "feedback"],
};

// editor 可以用的後台 API（"*" 是全部方法）
const EDITOR_API = {
  "admin/videos": "*",
  "admin/lives": "*",
  "admin/upload-url": "*",
  "admin/attachments": "*",
  "admin/notify": "*",
  "admin/highlights": "*", // 直播精華（看、重做、套用章節）
  "admin/reviews": "*", // 交易檢討投稿（講師勾已點評）
  "admin/feedback": "*",
  "admin/stats": "*",
  "admin/members": ["GET"], // 只能看
  "admin/oneonone": "*", // 講師自己也要看名單、標記約好
};

export function canUseApi(role, route, method) {
  if (role !== "editor") return true;
  const rule = EDITOR_API[route];
  return rule === "*" || (Array.isArray(rule) && rule.includes(method));
}
export const canSeeView = (role, view) => (VIEWS_FOR[role] || VIEWS_FOR.editor).includes(view);
export const canManageMembers = (role) => role !== "editor";
