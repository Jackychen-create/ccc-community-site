// 右欄最上面：下一場直播（後台「直播預告」排的，Discord 研究員專屬公告頻道也會公告）
import * as A from "../core/index.js";
const { el, $, icon } = A;
import { state } from "./state.js";

const WEEK = "日一二三四五六";
const pad = (n) => String(n).padStart(2, "0");
function when(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// 還有多久：直播中／再 25 分鐘／今天／明天／再 3 天
function until(iso, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "直播中";
  const min = Math.round(ms / 60e3);
  if (min < 60) return `再 ${min} 分鐘`;
  const d = new Date(iso), t = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400e3);
  return days === 0 ? "今天" : days === 1 ? "明天" : `再 ${days} 天`;
}

export function renderLivePanel() {
  const box = $("#livePanel");
  const l = state.me?.nextLive;
  if (!box) return;
  if (!l) return (box.hidden = true);
  box.hidden = false;
  const soon = until(l.startsAt);
  box.replaceChildren(
    el("div", { class: "live-card" },
      el("div", { class: "live-top" },
        el("span", { class: "label", text: "下一場直播" }),
        el("span", { class: "pill" + (soon === "直播中" ? " live-on" : "") }, el("span", { class: "dot" }), soon)),
      el("div", { class: "live-when num", text: when(l.startsAt) }),
      el("div", { class: "vtitle", text: l.title }),
      l.note ? el("p", { class: "small muted live-note", text: l.note }) : null,
      l.link ? el("a", { class: "btn primary block", href: l.link, target: "_blank", rel: "noopener", style: { marginTop: "12px" } }, icon("ext"), "前往直播") : null));
}
