// 提示訊息、對話框、按鈕忙碌狀態、數字動畫
import { el, icon } from "./dom.js";

let toastsBox;
export function toast(msg, kind = "ok") {
  if (!toastsBox) {
    toastsBox = el("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastsBox);
  }
  const t = el("div", { class: "toast " + kind }, icon(kind === "err" ? "alert" : "ok"), el("span", { text: msg }));
  toastsBox.append(t);
  setTimeout(() => t.remove(), kind === "err" ? 5000 : 2600);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已複製");
  } catch {
    toast("無法自動複製，請手動選取", "err");
  }
}

// ── Modal ──
export function modal({ title, body, actions = [], onClose }) {
  const prev = document.activeElement;
  const back = el("div", { class: "modal-back" });
  const box = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title });
  const close = () => {
    back.remove();
    document.removeEventListener("keydown", onKey);
    onClose && onClose();
    prev && prev.focus && prev.focus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  box.append(
    el("div", { class: "modal-head" }, el("h2", { text: title }),
      el("button", { class: "btn ghost sm icon", type: "button", "aria-label": "關閉", onclick: close }, icon("x"))),
    el("div", { class: "modal-body" }, body)
  );
  if (actions.length) box.append(el("div", { class: "modal-foot" }, actions));
  back.append(box);
  back.addEventListener("mousedown", (e) => {
    if (e.target === back) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(back);
  const first = box.querySelector("input, textarea, select, .modal-foot .btn.primary, .modal-foot .btn");
  (first || box).focus();
  return { close, box };
}

export function confirmDialog({ title, message, confirmText = "確定", cancelText = "取消", danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal({
      title,
      body: el("p", { class: "sub", style: { marginTop: "14px" }, text: message }),
      actions: [
        el("button", { class: "btn", type: "button", text: cancelText, onclick: () => finish(false) }),
        el("button", { class: danger ? "btn danger-solid" : "btn primary", type: "button", text: confirmText, onclick: () => finish(true) }),
      ],
      onClose: () => finish(false),
    });
  });
}

export function setBusy(btn, busy, label) {
  if (busy) {
    if (!btn._kids) btn._kids = [...btn.childNodes];
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.replaceChildren(el("span", { class: "spinner", "aria-hidden": "true" }), el("span", { text: label || "處理中…" }));
  } else {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    if (btn._kids) btn.replaceChildren(...btn._kids);
    btn._kids = null;
  }
}

export const reduceMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── 數字從 0 數上去（減少動態效果時直接顯示）──
export function countUp(node, to, { ms = 700 } = {}) {
  to = Math.round(Number(to) || 0);
  if (reduceMotion() || to <= 0 || navigator.webdriver) {
    node.textContent = String(to);
    return;
  }
  const start = performance.now();
  node.textContent = "0";
  const step = (t) => {
    const p = Math.min(1, (t - start) / ms);
    const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
    node.textContent = String(Math.round(to * eased));
    if (p < 1) requestAnimationFrame(step);
    else node.textContent = String(to); // 一定停在正確數字
  };
  requestAnimationFrame(step);
}
