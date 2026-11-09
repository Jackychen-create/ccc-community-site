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
    el("p", { class: "small sub", text: "在 Discord 報名通過後的第 1～7 天，每天晚上 8 點助教私訊一則引導：註冊網站（還沒註冊的會提醒）、系統分享、直播精華、交易投票、研究員大廳、等級、有問題找誰。對方關掉私訊就略過。" }),
    el("p", { class: "small " + (r.on ? "dc-ok" : "muted"), id: "obState", text: r.on ? `✓ 已打開（${md(r.since)} 起通過的人）` : "還沒打開" }),
    el("div", { class: "actions", style: { marginTop: "8px" } }, toggle),
    el("h3", { class: "rv-week-h", style: { marginTop: "14px" }, text: "這 7 天的新人" }),
    people, prev, nudgeBox());
}

// 補發給之前掉隊的人（30 天內同一個人只發一次）
function nudgeBox() {
  const box = el("div", { class: "ob-nudge", id: "obNudge" }, el("h3", { class: "rv-week-h", text: "補發給之前的人" }), el("p", { class: "small muted", text: "載入中…" }));
  loadNudge(box);
  return box;
}
async function loadNudge(box) {
  let r;
  try { r = await api("/api/admin/onboarding?nudge=1"); } catch (e) { box.replaceChildren(el("p", { class: "form-error", text: e.message })); return; }
  const md = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const group = (kind, title, desc, list, label, btnText) => {
    const todo = list.filter((p) => !p.sentAt);
    const btn = el("button", { class: "btn sm" + (todo.length ? " primary" : ""), type: "button", text: todo.length ? `${btnText}（${todo.length} 人）` : "都補發過了", disabled: !todo.length });
    btn.dataset.nudge = kind;
    btn.addEventListener("click", async () => {
      if (!(await A.confirmDialog({ title: `${btnText}？`, message: `${desc}\n會發給 ${todo.length} 人，30 天內同一個人不會再收到。`, confirmText: "發送" }))) return;
      A.setBusy(btn, true, "發送中…");
      try {
        const x = await api("/api/admin/onboarding", { method: "POST", body: { nudge: kind } });
        A.toast(`已發給 ${x.sent} 人${x.mails ? `（${x.dms || 0} 人私訊、${x.mails} 人沒連 Discord 改寄信）` : ""}${x.failed?.length ? `，${x.failed.length} 人沒收到` : ""}`);
        await loadNudge(box);
      } catch (e) { A.toast(e.message, "error"); A.setBusy(btn, false); }
    });
    return el("div", { class: "ob-group" },
      el("div", { class: "ob-group-head" }, el("b", { class: "small", text: `${title}・${list.length} 人` }), btn),
      el("p", { class: "small muted", text: desc }),
      list.length ? el("ul", { class: "ob-people" }, ...list.map((p) => el("li", { class: "small" }, el("span", { text: label(p) }), p.sentAt ? el("span", { class: "muted", text: `・${md(p.sentAt)} 補發過` }) : null))) : null);
  };
  box.replaceChildren(
    el("h3", { class: "rv-week-h", style: { marginTop: "18px" }, text: "補發給之前的人" }),
    group("unregistered", "報名通過、還沒註冊網站", "助教私訊他自己的加入連結（實驗室密碼）。", r.unregistered, (p) => `${p.name || p.id}（${md(p.approvedAt)} 通過）`, "私訊提醒註冊"),
    group("unwatched", "註冊了、一支影片都沒看過", "助教私訊推薦從 EP1（CCC 第 1 份課程）開始看；沒連到 Discord 的人改寄信。", r.unwatched, (p) => `${p.email}（${md(p.joinedAt)} 加入・${p.discordId ? "私訊" : "寄信"}）`, "推薦 EP1"));
}
