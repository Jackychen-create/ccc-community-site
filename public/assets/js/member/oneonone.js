// 一對一交流（第三級）：右欄選這個月的主講，看自己排第幾、確定還是候補
// 規則在 shared/rules.js：每位主講一個月最多 5 位，超過照這一輪的交易量排
import { $, el, api, toast, setBusy, confirmDialog } from "../core/index.js";
import { state } from "./state.js";
import { MAX_TIER } from "../shared/rules.js";

let data = null;
export async function loadOneOnOne() {
  const box = $("#onePanel");
  if (!state.me || state.me.isAdmin || (state.me.tier ?? 0) < MAX_TIER) return (box.hidden = true);
  try {
    data = await api("/api/oneonone");
  } catch {
    return (box.hidden = true);
  }
  render();
}

function render() {
  const box = $("#onePanel");
  box.hidden = false;
  const [y, m] = data.month.split("-").map(Number);
  const mine = data.mine;
  const status = !mine ? `選一位主講，${m} 月約一次一對一交流。`
    : mine.booked ? `已經跟 ${mine.host} 約好了 🎉`
      : mine.confirmed ? `你選了 ${mine.host}，排第 ${mine.rank} 位（確定）。管理員會跟你約時間。`
        : `你選了 ${mine.host}，目前候補第 ${mine.waiting} 位：${mine.host} 已經有 ${data.cap} 位交易量比較高的人。可以改選名額還沒滿的主講，或衝高這一輪的交易量。`;
  box.replaceChildren(
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("div", null, el("h2", { text: "一對一交流" }), el("div", { class: "small muted num", text: `${y} 年 ${m} 月・第三級` })),
      mine ? el("span", { class: "pill" + (mine.confirmed ? " good" : " brass") }, mine.confirmed ? el("span", { class: "dot" }) : null, mine.booked ? "已約好" : mine.confirmed ? "確定" : "候補") : null),
    el("p", { class: "small tier-status", text: status }),
    el("div", { class: "one-pick", role: "group", "aria-label": "選主講" },
      ...data.hosts.map((h) => {
        const me = mine?.host === h.host;
        const btn = el("button", { class: "one-host" + (me ? " me" : ""), type: "button", "aria-pressed": String(me), disabled: !!mine?.booked && !me },
          el("b", { text: h.host }),
          el("span", { class: "small muted num", text: `${Math.min(h.confirmed, data.cap)}／${data.cap}${h.total > h.confirmed ? `・候補 ${h.total - h.confirmed}` : ""}` }));
        btn.addEventListener("click", () => !me && pick(h.host, btn));
        return btn;
      })),
    mine && !mine.booked ? el("p", { class: "small", style: { padding: "0 18px 14px", margin: 0 } }, el("button", { class: "linkish small", type: "button", text: "取消這個月的一對一", onclick: cancel })) : el("div", { style: { height: "14px" } }),
  );
}

async function pick(host, btn) {
  setBusy(btn, true, "…");
  try {
    data = await api("/api/oneonone", { method: "POST", body: { host } });
    render();
    toast(data.mine?.confirmed ? `已選 ${host}，排第 ${data.mine.rank} 位` : `已選 ${host}，目前候補`);
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, "err");
  }
}
async function cancel() {
  if (!(await confirmDialog({ title: "取消一對一", message: "取消這個月的一對一？名額會讓給其他人，之後還可以再選。", confirmText: "取消一對一" }))) return;
  try {
    data = await api("/api/oneonone", { method: "DELETE" });
    render();
    toast("已取消");
  } catch (e) {
    toast(e.message, "err");
  }
}
