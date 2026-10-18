// 一對一交流：三位講師各一欄，照順序列出這個月選他的第三級研究員（前 5 位確定、其他候補），可以標記「已約好」
// 規則在 shared/rules.js 的 rankOneOnOne、ONE_ON_ONE_CAP
import * as A from "../core/index.js";
const { el, $, api } = A;
import { fail, loadingBox } from "./common.js";
import { ONE_ON_ONE_CAP } from "../shared/rules.js";

const thisMonth = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
$("#oneMonth").value = thisMonth();
$("#oneMonth").addEventListener("change", () => loadOneOnOne());

let board = null;
export async function loadOneOnOne() {
  const month = $("#oneMonth").value || thisMonth();
  $("#oneBox").replaceChildren(loadingBox());
  try {
    board = await api(`/api/admin/oneonone?month=${encodeURIComponent(month)}`);
    render();
  } catch (e) {
    fail(e);
  }
}

function render() {
  const total = board.hosts.reduce((n, h) => n + h.list.length, 0);
  $("#cOne").textContent = board.month === thisMonth() ? board.hosts.reduce((n, h) => n + h.list.filter((e) => e.confirmed && !e.booked).length, 0) || "" : $("#cOne").textContent;
  if (!total) {
    $("#oneBox").replaceChildren(el("div", { class: "empty" }, el("h2", { text: "這個月還沒有人選" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "第三級的研究員會在網站右邊選一位講師。" })));
    return;
  }
  $("#oneBox").replaceChildren(el("div", { class: "one-cols" }, ...board.hosts.map((h) => {
    const conf = h.list.filter((e) => e.confirmed).length;
    return el("section", { class: "panel one-col" },
      el("div", { class: "panel-head", style: { padding: "14px 18px" } }, el("h2", { text: h.host }),
        el("span", { class: "pill" + (conf >= ONE_ON_ONE_CAP ? " brass" : "") }, el("span", { class: "num", text: `${conf}／${ONE_ON_ONE_CAP}` }), h.list.length > conf ? `・候補 ${h.list.length - conf}` : "")),
      h.list.length ? el("ol", { class: "one-list" }, ...h.list.map((e) => el("li", { class: e.confirmed ? "" : "wait" },
        el("span", { class: "one-rank num", text: e.rank }),
        el("div", { class: "one-who" },
          el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: e.email }),
          el("div", { class: "small muted num", text: `這一輪 ${e.volume}・${e.booked ? "已約好" : e.confirmed ? "確定" : "候補"}` })),
        el("div", { class: "actions" },
          el("button", { class: "btn sm", type: "button", text: e.booked ? "取消約好" : "已約好", disabled: !e.confirmed && !e.booked, title: e.confirmed || e.booked ? "" : "候補的要等前面有人取消", onclick: () => setBooked(e, !e.booked) }),
          el("button", { class: "btn sm ghost danger", type: "button", text: "移除", "aria-label": `把 ${e.email} 從名單移除`, onclick: () => remove(e) })))))
        : el("p", { class: "small muted", style: { padding: "0 18px 16px" }, text: "還沒有人選" }));
  })));
}

async function setBooked(e, booked) {
  try {
    board = await api("/api/admin/oneonone", { method: "PATCH", body: { userId: e.user_id, month: board.month, booked } });
    render();
    A.toast(booked ? `${e.email} 已約好` : "已取消約好");
  } catch (err) {
    fail(err);
  }
}
async function remove(e) {
  const ok = await A.confirmDialog({ title: "移除", message: `把 ${e.email} 從這個月的 ${e.host} 一對一名單移除？他之後還可以再選。`, confirmText: "移除", danger: true });
  if (!ok) return;
  try {
    board = await api(`/api/admin/oneonone?userId=${encodeURIComponent(e.user_id)}&month=${encodeURIComponent(board.month)}`, { method: "DELETE" });
    render();
  } catch (err) {
    fail(err);
  }
}
