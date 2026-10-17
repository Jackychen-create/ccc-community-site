// 後台共用：整頁切換、錯誤處理、載入中
import * as A from "../core/index.js";
const { el, $, sb } = A;

export function show(id) {
  for (const v of ["boot", "noAccess", "shell"]) $("#" + v).hidden = v !== id;
}

// API 錯誤：沒登入就回登入頁、沒權限就顯示沒有權限，其他跳提示
export function fail(e) {
  if (e.status === 401) {
    sb.auth.signOut().then(() => location.replace("/?next=admin"));
    return;
  }
  if (e.status === 403 && e.code === "owner_only") return A.toast(e.message, "err"); // 協作管理員用到主要管理員的功能
  if (e.status === 403) return show("noAccess");
  A.toast(e.message || "發生錯誤", "err");
}

export function loadingBox() {
  return el("div", { class: "skel", style: { height: "220px" }, "aria-hidden": "true" });
}

// 列表上方的分組切換（例如 正常／已停權）：tabs = [{ key, label, count }]
export function segTabs(tabs, current, onPick, label) {
  return el("div", { class: "vol-seg list-seg", role: "tablist", "aria-label": label },
    ...tabs.map((t) => el("button", {
      type: "button", class: "vol-seg-btn", "data-tab": t.key, "aria-pressed": String(t.key === current),
      onclick: () => onPick(t.key),
    }, t.label, el("span", { class: "num seg-n", text: ` ${t.count}` }))));
}
