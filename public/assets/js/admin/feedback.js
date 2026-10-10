// 提問回報收件匣：回覆（寄信給研究員）、標成已處理
import * as A from "../core/index.js";
const { el, $, api } = A;
import { fail, loadingBox } from "./common.js";

// 提問回報
let fbStatus = "open";
export async function refreshFeedbackCount() {
  try {
    const r = await api("/api/admin/feedback?status=open");
    $("#cFeedback").textContent = r.open || "";
    return r;
  } catch {
    return null;
  }
}
export async function loadFeedback() {
  const box = $("#fbBox");
  $("#fbFilter").replaceChildren(...[["open", "待回覆"], ["done", "已處理"], ["all", "全部"]].map(([k, label]) =>
    el("button", { class: "chip", type: "button", "aria-pressed": String(fbStatus === k), text: label, onclick: () => { fbStatus = k; loadFeedback(); } })));
  box.replaceChildren(loadingBox());
  let r;
  try {
    r = await api(`/api/admin/feedback${fbStatus === "all" ? "" : `?status=${fbStatus}`}`);
  } catch (e) {
    return fail(e);
  }
  $("#cFeedback").textContent = r.open || "";
  const list = r.feedback || [];
  if (!list.length) {
    box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: fbStatus === "open" ? "沒有待回覆的提問" : "這裡還沒有東西" }),
      el("p", { class: "small", style: { marginTop: "6px" }, text: "研究員在播放頁按「提問」送來的問題會出現在這裡，也會寄信通知你們。" })));
    return;
  }
  box.replaceChildren(el("div", { class: "fb-admin" }, ...list.map(fbCard)));
}
function fbCard(f) {
  const ta = el("textarea", { class: "textarea", rows: "3", maxlength: "2000", placeholder: "寫下回覆，送出後會寄信給研究員" });
  const send = el("button", { class: "btn primary sm", type: "button", text: "回覆並寄信" });
  const toggle = el("button", { class: "btn sm", type: "button", text: f.status === "open" ? "標成已處理" : "重新打開" });
  const card = el("article", { class: "card fb-card" + (f.status === "open" ? " open" : "") },
    el("div", { class: "fb-head" },
      el("span", { class: "pill" + (f.kind === "problem" ? " warn" : " brass"), text: f.kind === "problem" ? "網站問題" : "內容提問" }),
      el("b", { style: { wordBreak: "break-all" }, text: f.email }),
      f.video_id ? el("a", { class: "small", href: `/#/v/${f.video_id}${f.t != null ? `?t=${f.t}` : ""}`, target: "_blank", rel: "noopener" }, f.video_title || "影片", f.t != null ? el("span", { class: "num", text: ` ${A.fmtDur(f.t)}` }) : null) : null,
      el("span", { class: "spacer" }),
      el("span", { class: "small muted", text: A.fmtRel(f.created_at) })),
    el("p", { class: "fb-body", text: f.body }),
    f.reply
      ? el("div", { class: "fb-reply" }, el("div", { class: "small muted", text: `${(f.replied_by || "").split("@")[0]} 回覆・${A.fmtRel(f.replied_at)}` }), el("p", { text: f.reply }))
      : null,
    el("div", { class: "fb-actions" }, f.reply ? null : ta, el("div", { class: "fb-btns" }, toggle, f.reply ? null : send)));
  send.addEventListener("click", async () => {
    if (!ta.value.trim()) return ta.focus();
    A.setBusy(send, true, "寄送中…");
    try {
      const r = await api("/api/admin/feedback", { method: "PATCH", body: { id: f.id, reply: ta.value } });
      A.toast(r.mailed ? "已回覆，也寄信通知他了" : "已回覆（寄信服務沒設定，他會在「我的提問」看到）");
      loadFeedback();
    } catch (e) {
      A.setBusy(send, false);
      fail(e);
    }
  });
  toggle.addEventListener("click", async () => {
    try {
      await api("/api/admin/feedback", { method: "PATCH", body: { id: f.id, status: f.status === "open" ? "done" : "open" } });
      loadFeedback();
    } catch (e) {
      fail(e);
    }
  });
  return card;
}
