// 右上角帳號選單：課程、筆記、提問、寄信通知、使用教學、更新紀錄、修改密碼、登出
import { openThemePicker } from "./badges.js";
import { $, el, api, sb, icon, modal, setBusy, toast, tutorial, whatsNew } from "../core/index.js";
import { state } from "./state.js";

const menuBtn = $("#menuBtn");
const menuPanel = $("#menuPanel");

export function renderMenu() {
  const me = state.me;
  $("#avatar").textContent = (me?.email || "?").charAt(0).toUpperCase();
  menuBtn.classList.toggle("has-dot", !!me?.feedbackUnread);
  menuPanel.replaceChildren(...[
    el("div", { class: "who" }, el("div", { text: "登入身分" }), el("div", { style: { color: "var(--ink)" }, text: me?.email || "" })),
    me?.isAdmin ? el("a", { href: "/admin", role: "menuitem" }, icon("settings"), "後台管理") : null,
    el("a", { href: "#/course", role: "menuitem", onclick: () => toggleMenu(false) }, icon("book"), "教學課程"),
    el("a", { href: "#/notes", role: "menuitem", onclick: () => toggleMenu(false) }, icon("note"), "我的筆記"),
    el("a", { href: "#/feedback", role: "menuitem", onclick: () => toggleMenu(false) }, icon("chat"), "我的提問", me?.feedbackUnread ? el("span", { class: "menu-dot", "aria-label": "有新回覆" }) : null),
    me && me.notify !== null && !me.isAdmin
      ? el("button", { type: "button", role: "menuitemcheckbox", "aria-checked": String(!!me.notify), onclick: toggleNotify },
          icon("mail"), el("span", { style: { flex: "1" }, text: "新影片寄信通知" }), el("span", { class: "menu-state" + (me.notify ? " on" : ""), text: me.notify ? "開" : "關" }))
      : null,
    el("button", { type: "button", role: "menuitem", onclick: () => { toggleMenu(false); openThemePicker(); } }, icon("image"), "外觀主題"),
    el("button", { type: "button", role: "menuitem", onclick: () => { toggleMenu(false); tutorial(); } }, icon("play"), "使用教學"),
    me?.isAdmin ? el("button", { type: "button", role: "menuitem", onclick: () => { toggleMenu(false); tutorial("admin"); } }, icon("play"), "管理員使用教學") : null,
    el("button", { type: "button", role: "menuitem", onclick: () => { toggleMenu(false); whatsNew({ all: true }); } }, icon("news"), "更新紀錄"),
    el("button", { type: "button", role: "menuitem", onclick: changePassword }, icon("key"), "修改密碼"),
    el("button", { type: "button", role: "menuitem", onclick: () => sb.auth.signOut() }, icon("logout"), "登出"),
  ].filter(Boolean));
}

async function toggleNotify() {
  const next = !state.me.notify;
  try {
    await api("/api/me", { method: "PATCH", body: { notify: next } });
    state.me.notify = next;
    renderMenu();
    toast(next ? "新影片上架時會寄信通知你" : "已關閉新影片寄信通知");
  } catch (e) {
    toast(e.message, "err");
  }
}

function toggleMenu(open) {
  const willOpen = open ?? menuPanel.hidden;
  menuPanel.hidden = !willOpen;
  menuBtn.setAttribute("aria-expanded", String(willOpen));
}
menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu();
});
document.addEventListener("click", (e) => {
  if (!menuPanel.hidden && !menuPanel.contains(e.target)) toggleMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !menuPanel.hidden) {
    toggleMenu(false);
    menuBtn.focus();
  }
});

function changePassword() {
  toggleMenu(false);
  const p1 = el("input", { class: "input", type: "password", autocomplete: "new-password", minlength: "8" });
  const p2 = el("input", { class: "input", type: "password", autocomplete: "new-password", minlength: "8" });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: "儲存新密碼" });
  const m = modal({
    title: "修改密碼",
    body: el("div", null,
      el("label", { class: "field" }, el("span", { class: "label", text: "新密碼（至少 8 個字元）" }), p1),
      el("label", { class: "field" }, el("span", { class: "label", text: "再輸入一次" }), p2),
      err),
    actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), save],
  });
  const fail = (t) => {
    err.textContent = t;
    err.hidden = false;
  };
  save.addEventListener("click", async () => {
    if (p1.value.length < 8) return fail("密碼至少需要 8 個字元");
    if (p1.value !== p2.value) return fail("兩次輸入的密碼不一樣");
    setBusy(save, true, "儲存中…");
    const { error } = await sb.auth.updateUser({ password: p1.value });
    setBusy(save, false);
    if (error) {
      return fail(/different/i.test(error.message) ? "新密碼不能跟舊密碼一樣" : "修改失敗，請重新登入後再試");
    }
    m.close();
    toast("密碼已更新");
  });
}
