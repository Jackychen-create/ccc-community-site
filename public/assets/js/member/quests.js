// 每週任務（右欄）：三個任務、進度條、全部完成蓋章；連續打卡天數。規則在 shared/rules.js 的 QUESTS
import { $, el, api, toast } from "../core/index.js";
import { state } from "./state.js";
import { md } from "./format.js";

export async function loadQuests() {
  const box = $("#questPanel");
  if (!state.me || state.me.isAdmin) return (box.hidden = true);
  let q;
  try {
    q = await api("/api/quests");
  } catch {
    return (box.hidden = true);
  }
  if (!q.quests) return (box.hidden = true);
  render(q);
  if (q.justDone) setTimeout(() => toast(`🎯 這週的任務全部完成！已經累積 ${q.weeksDone} 週`), 1200);
}

function render(q) {
  const box = $("#questPanel");
  box.hidden = false;
  const done = q.quests.filter((x) => x.done).length;
  box.classList.toggle("quest-done", q.allDone);
  box.replaceChildren(
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("div", null, el("h2", { text: "每週任務" }), el("div", { class: "small muted num", text: `${md(q.week.start)}～${md(q.week.end)}・星期一重置` })),
      q.allDone ? el("span", { class: "quest-stamp", role: "img", "aria-label": "這週任務完成", text: "完成" })
        : el("span", { class: "pill" }, el("span", { class: "num", text: `${done}／${q.quests.length}` }))),
    el("ul", { class: "quest-list" }, ...q.quests.map((x) => el("li", { class: x.done ? "done" : "" },
      el("span", { class: "quest-ico", "aria-hidden": "true", text: x.done ? "✓" : x.icon }),
      el("div", { class: "quest-main" },
        el("div", { class: "quest-name", text: x.name }),
        el("div", { class: "track" }, el("i", { style: { width: Math.min(100, (x.progress / x.target) * 100) + "%" } }))),
      el("span", { class: "quest-n small num", text: x.id === "volume" ? `${Math.round(Math.min(1, x.progress) * 100)}%` : `${x.progress}／${x.target}` })))),
    el("p", { class: "small muted quest-foot", text: `三個都完成算一週・已經累積 ${q.weeksDone} 週${q.weeksDone < 4 ? `（4 週拿「🗓️ 任務老手」徽章）` : ""}${state.me.streak?.days ? `・連續打卡 ${state.me.streak.days} 天` : ""}` }),
  );
}
