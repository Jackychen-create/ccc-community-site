// 新人試用週（放在「聊天統計」頁）：Discord 報名通過後 7 天，每天晚上 8 點助教私訊一則引導
// 伺服器在 server/admin/onboarding.js、server/lib/onboarding.js
import * as A from "../core/index.js";
const { el, api } = A;

export function onboardingCard() {
  const card = el("section", { class: "card chat-set", id: "onboardCard" }, el("h2", { text: "新人試用週" }), el("p", { class: "small muted", text: "載入中…" }));
  load(card);
  return card;
}

async function load(card) {
  let r;
  try { r = await api("/api/admin/onboarding"); } catch (e) {
    card.replaceChildren(el("h2", { text: "新人試用週" }), el("p", { class: "form-error", text: e.message || "載入失敗" }));
    return;
  }
  const toggle = el("button", { class: "btn " + (r.on ? "" : "primary"), type: "button", text: r.on ? "關掉" : "打開" });
  toggle.addEventListener("click", async () => {
    if (!r.on && !(await A.confirmDialog({ title: "打開新人試用週？", message: "從現在起在 Discord 報名通過的人，接下來 7 天每天晚上 8 點會收到助教的一則私訊。已經通過的人不會收到。", confirmText: "打開" }))) return;
    A.setBusy(toggle, true, "儲存中…");
    try { await api("/api/admin/onboarding", { method: "PATCH", body: { on: !r.on } }); A.toast(r.on ? "已關掉新人試用週" : "已打開新人試用週"); await load(card); }
    catch (e) { A.toast(e.message, "error"); A.setBusy(toggle, false); }
  });
  const md = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const people = r.people.length
    ? el("ul", { class: "ob-people" }, ...r.people.map((p) => el("li", { class: "small" }, el("b", { text: p.name || "（沒有名字）" }), el("span", { class: "muted", text: `・${md(p.approvedAt)} 通過・第 ${p.day} 天・${p.last ? `收到第 ${p.last} 天` : "還沒收到"}` }))))
    : el("p", { class: "small muted", text: r.on ? "這 7 天還沒有新人通過。" : "打開後，之後通過的人會列在這裡。" });
  const prev = el("details", { class: "ob-preview" }, el("summary", { class: "small", text: "看 7 天的內容" }),
    ...r.preview.map((e) => el("div", { class: "ob-msg" }, el("b", { class: "small", text: e.title }), el("p", { class: "small", text: e.description.replace(/<#\d+>/g, "#頻道").replace(/<a?:(\w+):\d+>/g, ":$1:") }))));
  card.replaceChildren(
    el("h2", { text: "新人試用週" }),
    el("p", { class: "small sub", text: "在 Discord 報名通過後的第 1～7 天，每天晚上 8 點助教私訊一則引導：註冊網站（還沒註冊的會提醒）、教學課程、直播精華、交易投票、研究員大廳、等級、有問題找誰。對方關掉私訊就略過。" }),
    el("p", { class: "small " + (r.on ? "dc-ok" : "muted"), id: "obState", text: r.on ? `✓ 已打開（${md(r.since)} 起通過的人）` : "還沒打開" }),
    el("div", { class: "actions", style: { marginTop: "8px" } }, toggle),
    el("h3", { class: "rv-week-h", style: { marginTop: "14px" }, text: "這 7 天的新人" }),
    people, prev);
}
