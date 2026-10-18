// 本週小目標（右欄，選做）：三個小目標、進度條、全部完成蓋章；連續打卡天數。規則在 shared/rules.js 的 QUESTS
// 文字要輕鬆，不要讓人覺得被要求
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
  if (q.justDone) setTimeout(() => toast(`🎯 這週的小目標都完成了，已經累積 ${q.weeksDone} 週`), 1200);
}

function render(q) {
  const box = $("#questPanel");
  box.hidden = false;
  const done = q.quests.filter((x) => x.done).length;
  box.classList.toggle("quest-done", q.allDone);
  box.replaceChildren(
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("div", null, el("h2", { text: "本週小目標" }), el("div", { class: "small muted num", text: `${md(q.week.start)}～${md(q.week.end)}・選做` })),
      q.allDone ? el("span", { class: "quest-stamp", role: "img", "aria-label": "這週任務完成", text: "完成" })
        : el("span", { class: "pill" }, el("span", { class: "num", text: `${done}／${q.quests.length}` }))),
    el("ul", { class: "quest-list" }, ...q.quests.map((x) => el("li", { class: x.done ? "done" : "" },
      el("span", { class: "quest-ico", "aria-hidden": "true", text: x.done ? "✓" : x.icon }),
      el("div", { class: "quest-main" },
        el("div", { class: "quest-name", text: x.name }),
        el("div", { class: "track" }, el("i", { style: { width: Math.min(100, (x.progress / x.target) * 100) + "%" } }))),
      el("span", { class: "quest-n small num", text: `${x.progress}／${x.target}` })))),
    el("p", { class: "small muted quest-foot", text: q.allDone ? `這週都完成了，已經累積 ${q.weeksDone} 週。` : "有空再做就好，做到的會自己打勾。" }),
  );
}
