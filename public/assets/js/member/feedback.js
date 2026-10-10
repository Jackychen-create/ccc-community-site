// 提問／回報：播放頁的「提問」按鈕、#/feedback「我的提問」分頁
import { $, el, api, icon, modal, setBusy, toast, fmtDur, fmtRel } from "../core/index.js";
import { state, video, SITE } from "./state.js";
import { showPage, handleErr } from "./views.js";
import { emptyBox, skelRow } from "./widgets.js";
import { renderMenu } from "./menu.js";

export function askQuestion(kindInit = "question") {
  const current = state.current;
  const at = current && video.duration ? Math.floor(video.currentTime) : null;
  let kind = kindInit;
  let withTime = at !== null;
  const kinds = [["question", "問內容"], ["problem", "回報問題（播放、網站）"]].map(([k, label]) => {
    const b = el("button", { class: "chip", type: "button", "aria-pressed": String(kind === k), text: label });
    b.addEventListener("click", () => { kind = k; kinds.forEach((x, i) => x.setAttribute("aria-pressed", String(["question", "problem"][i] === kind))); paint(); });
    return b;
  });
  const timeChip = at !== null ? el("button", { class: "chip", type: "button", "aria-pressed": "true" }, icon("clock"), ` 在 ${fmtDur(at)} 這裡`) : null;
  if (timeChip) timeChip.addEventListener("click", () => { withTime = !withTime; timeChip.setAttribute("aria-pressed", String(withTime)); });
  const ta = el("textarea", { class: "textarea", rows: "5", maxlength: "2000" });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const send = el("button", { class: "btn primary", type: "button", text: "送出" });
  const paint = () => (ta.placeholder = kind === "question"
    ? "哪裡聽不懂、想再多講一點、或對這段有疑問，都可以問。例如：這裡停損為什麼放在前低下面？"
    : "遇到什麼問題？例如：影片卡住、聲音不同步、教材打不開。寫下用手機還是電腦會更好查。");
  paint();
  const m = modal({
    title: current ? `提問：${current.title}` : "提問／回報",
    body: el("div", null,
      el("div", { class: "chips", style: { marginTop: "14px" } }, ...kinds, timeChip),
      el("label", { class: "field" }, el("span", { class: "sr-only", text: "內容" }), ta),
      el("p", { class: "hint", text: "管理員回覆後會寄信給你，也可以在右上角「我的提問」看到。" }),
      err),
    actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), send],
  });
  if (current) video.pause();
  setTimeout(() => ta.focus(), 30);
  send.addEventListener("click", async () => {
    if (!ta.value.trim()) { err.textContent = "請寫下你的問題"; err.hidden = false; return; }
    setBusy(send, true, "送出中…");
    try {
      await api("/api/feedback", { method: "POST", body: { kind, body: ta.value, videoId: current?.id ?? null, t: current && withTime ? at : null } });
      m.close();
      toast("已送出，回覆會寄到你的 Email");
    } catch (e) {
      setBusy(send, false);
      err.textContent = e.message; err.hidden = false;
    }
  });
}
$("#askBtn").addEventListener("click", () => askQuestion("question"));

export async function openFeedback() {
  showPage("feedbackView", { title: `我的提問｜${SITE}` });
  const box = $("#feedbackList");
  box.replaceChildren(skelRow());
  let list = [];
  try {
    list = (await api("/api/feedback")).feedback || [];
  } catch (e) {
    return handleErr(e, () => box.replaceChildren(emptyBox("讀不到提問", e.message, openFeedback)));
  }
  if (state.me) { state.me.feedbackUnread = 0; renderMenu(); }
  $("#feedbackCount").textContent = list.length ? `共 ${list.length} 則` : "";
  if (!list.length) return box.replaceChildren(emptyBox("還沒有提問", "看影片時按「提問」，就能針對那個時間點發問。"));
  box.replaceChildren(...list.map((f) =>
    el("article", { class: "fb" + (f.is_new ? " is-new" : "") },
      el("div", { class: "fb-head" },
        el("span", { class: "pill" + (f.kind === "problem" ? " warn" : ""), text: f.kind === "problem" ? "回報問題" : "提問" }),
        f.video_id ? el("a", { class: "small", href: `#/v/${f.video_id}${f.t != null ? `?t=${f.t}` : ""}` }, f.video_title || "影片", f.t != null ? el("span", { class: "num", text: ` ${fmtDur(f.t)}` }) : null) : null,
        el("span", { class: "spacer" }),
        el("span", { class: "small muted", text: fmtRel(f.created_at) })),
      el("p", { class: "fb-body", text: f.body }),
      f.reply
        ? el("div", { class: "fb-reply" }, el("div", { class: "small muted" }, "管理員回覆・", fmtRel(f.replied_at), f.is_new ? el("span", { class: "pill brass", style: { marginLeft: "8px" }, text: "新回覆" }) : null), el("p", { text: f.reply }))
        : el("p", { class: "small muted", text: f.status === "done" ? "已處理" : "等待回覆中" }))));
}
