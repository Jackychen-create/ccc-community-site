// 畫面切換：整頁（載入中／登入／主畫面／沒有權限）和主畫面裡的分頁（列表、播放、課程、筆記、提問）
import { $, sb } from "../core/index.js";
import { SITE } from "./state.js";

export function show(id) {
  for (const v of ["bootView", "authView", "appView", "blockedView"]) $("#" + v).hidden = v !== id;
}

export function showBlocked(msg) {
  show("blockedView");
  $("#blockedTitle").textContent = "沒有觀看權限";
  $("#blockedRetry").hidden = true;
  $("#blockedMsg").textContent = msg || "這個帳號目前沒有觀看權限，請聯絡管理員。";
}

// 不是帳號的問題（網路斷線、網站設定、伺服器錯誤），不要讓研究員以為自己被停權
export function showUnavailable(e) {
  show("blockedView");
  $("#blockedTitle").textContent = "網站暫時無法使用";
  $("#blockedMsg").textContent = e.status === 0 ? "連線失敗，請檢查網路後再試一次。" : e.message;
  $("#blockedRetry").hidden = false;
}

// API 錯誤：沒登入就登出、沒權限就顯示沒有權限，其他交給畫面自己處理
export function handleErr(e, fallback) {
  if (e.status === 401) return sb.auth.signOut();
  if (e.status === 403) return showBlocked(e.message);
  fallback && fallback();
}

// ── 分頁 ──
const PAGES = ["listView", "watchView", "notesView", "courseView", "feedbackView"];
const leaveHooks = [];
// 離開目前分頁前要做的事（例如播放頁存進度、停止播放）
export function onLeavePage(fn) {
  leaveHooks.push(fn);
}
export function leavePage() {
  for (const fn of leaveHooks) fn();
}

// 切到某個分頁。nav：上方導覽要亮哪一個（"list"、"course" 或不亮）；search：要不要顯示搜尋框
export function showPage(id, { nav = null, search = false, title = SITE, scrollTop = true } = {}) {
  leavePage();
  for (const p of PAGES) $("#" + p).hidden = p !== id;
  $("#searchBox").hidden = !search;
  setNav(nav);
  if (title) document.title = title;
  if (scrollTop) window.scrollTo(0, 0);
}

export function setNav(which) {
  $("#navList").toggleAttribute("aria-current", which === "list");
  $("#navCourse").toggleAttribute("aria-current", which === "course");
  if (which) $(which === "list" ? "#navList" : "#navCourse").setAttribute("aria-current", "page");
}
