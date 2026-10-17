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

// 備註：列表裡的一行（有寫就顯示，沒寫就只有「＋備註」）＋鉛筆按鈕，點了跳小視窗改
// onSave(text) 回傳 Promise；成功後會呼叫 onDone 重畫列表
export function noteLine(note, { title, sub = "", max = 200, placeholder = "", onSave, onDone, editable = true }) {
  const text = el("span", { class: "note-text", text: note || "", title: note || "" });
  if (!editable) return note ? el("div", { class: "note-line small" }, text) : null;
  const btn = el("button", { class: "note-btn", type: "button", "aria-label": note ? `修改備註：${title}` : `加備註：${title}`, onclick: () => editNote() },
    el("span", { html: A.icons.edit }), note ? null : "備註");
  return el("div", { class: "note-line small" + (note ? "" : " empty") }, note ? text : null, btn);

  function editNote() {
    const input = el("textarea", { class: "input", rows: "3", maxlength: String(max), placeholder });
    input.value = note || "";
    const err = el("div", { class: "form-error", role: "alert", hidden: true });
    const save = el("button", { class: "btn primary", type: "button", text: "儲存" });
    const mm = A.modal({
      title: "備註",
      body: el("div", null,
        sub ? el("p", { class: "small sub", style: { marginTop: "14px", wordBreak: "break-all" }, text: sub }) : null,
        el("label", { class: "field" }, el("span", { class: "label", text: "備註（只有管理員看得到）" }), input),
        err),
      actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => mm.close() }), save],
    });
    setTimeout(() => input.focus(), 50);
    save.addEventListener("click", async () => {
      A.setBusy(save, true, "儲存中…");
      try {
        await onSave(input.value.trim());
        mm.close();
        A.toast(input.value.trim() ? "備註已儲存" : "備註已清除");
        onDone?.();
      } catch (e) {
        A.setBusy(save, false);
        err.textContent = e.message;
        err.hidden = false;
      }
    });
  }
}
