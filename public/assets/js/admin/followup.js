// 待跟進：伺服器算好每位研究員要注意的地方（過期、快到期、沒達標、很久沒來、課程落後、提問沒回）
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { fail, loadingBox } from "./common.js";
import { editAccess } from "./members.js";

// 待跟進
let fuData = null;
let fuKey = "";
const FU_LABELS = { notier: "沒有等級", drop: "下一輪會降級", oneonone: "第三級一對一", inactive: "很久沒來", course: "課程落後", feedback: "提問沒回" };
export async function loadFollowup() {
  $("#fuBox").replaceChildren(loadingBox());
  try {
    fuData = await api("/api/admin/followup");
  } catch (e) {
    return fail(e);
  }
  renderFollowup();
}
function renderFollowup() {
  const { rows, counts } = fuData;
  const need = rows.filter((r) => r.reasons.length);
  $("#cFollowup").textContent = need.filter((r) => r.score >= 2).length || "";
  $("#fuSub").textContent = need.length ? `${need.length} 位研究員有需要注意的地方，最需要處理的排在最上面。` : "目前每位研究員都沒有需要特別注意的地方。";
  $("#fuFilter").replaceChildren(
    el("button", { class: "chip", type: "button", "aria-pressed": String(!fuKey), text: `全部 ${need.length}`, onclick: () => { fuKey = ""; renderFollowup(); } }),
    ...Object.keys(FU_LABELS).filter((k) => counts[k]).map((k) =>
      el("button", { class: "chip", type: "button", "aria-pressed": String(fuKey === k), text: `${FU_LABELS[k]} ${counts[k]}`, onclick: () => { fuKey = k; renderFollowup(); } })));
  const list = need.filter((r) => !fuKey || r.reasons.some((x) => x.key === fuKey));
  if (!list.length) {
    $("#fuBox").replaceChildren(el("div", { class: "empty" }, el("h2", { text: "沒有需要跟進的研究員" })));
    return;
  }
  const lvl = (l) => (l >= 3 ? " warn" : l === 2 ? " brass" : "");
  $("#fuBox").replaceChildren(el("div", { class: "table-wrap" },
    el("table", { class: "table stack fu" },
      el("thead", null, el("tr", null, el("th", { text: "研究員" }), el("th", { text: "要注意" }), el("th", { class: "hide-sm", text: "最近觀看" }), el("th", { class: "hide-sm", text: "課程" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
      el("tbody", null, list.map((r) =>
        el("tr", null,
          el("td", null, el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: r.email }),
            el("div", { class: "small muted", text: `加入 ${r.joined.slice(5).replace("-", "/")}・看過 ${r.watched} 場` })),
          el("td", null, el("div", { class: "fu-reasons" }, ...r.reasons.map((x) => el("span", { class: "pill" + lvl(x.level), text: x.label })))),
          el("td", { class: "small hide-sm", text: r.last_watched_at ? A.fmtRel(r.last_watched_at) : "還沒看過" }),
          el("td", { class: "small hide-sm num", text: r.course.unlocked ? `${r.course.unlocked - r.course.behind}／${r.course.unlocked}` : "—" }),
          el("td", null, el("div", { class: "actions" },
            el("button", { class: "btn sm", type: "button", onclick: () => editAccess({ ...r, banned: false }, loadFollowup) }, icon("clock"), "等級"),
            r.reasons.some((x) => x.key === "feedback") ? el("a", { class: "btn sm", href: "#feedback" }, icon("chat"), "回覆") : null,
            el("button", { class: "btn sm icon", type: "button", "aria-label": `複製 ${r.email}`, title: "複製 Email", onclick: () => A.copyText(r.email).then(() => A.toast("已複製 Email")) }, icon("copy"))))))))));
}
