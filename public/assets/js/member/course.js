// 教學課程：右欄小卡、#/course 分頁。解鎖規則在 shared/rules.js，伺服器算好才給
import { $, el, api, icons, fmtDur } from "../core/index.js";
import { COURSE_HOSTS } from "../shared/rules.js";
import { state, SITE } from "./state.js";
import { showPage } from "./views.js";
import { md, weekday } from "./format.js";
import { statusOf, coverThumb, emptyBox, skelRow } from "./widgets.js";

export async function loadCourse() {
  try {
    state.course = await api("/api/course");
  } catch {
    state.course = null;
  }
  renderCoursePanel();
  if (!$("#courseView").hidden) renderCourse();
  return state.course;
}
const slotName = (s) => `${s.host} 第 ${s.part} 份`;
const isDone = (v) => v?.duration_sec && v.position_sec >= v.duration_sec * 0.95;

// 右欄：最新解鎖的一份＋下一份什麼時候解鎖
function renderCoursePanel() {
  const course = state.course;
  const box = $("#coursePanel");
  if (!course?.slots?.length) return (box.hidden = true);
  const open = course.slots.filter((s) => s.unlocked);
  const latest = open[open.length - 1];
  const next = course.slots.find((s) => !s.unlocked && !s.tier_locked);
  const done = open.filter((s) => s.video && isDone(s.video)).length;
  box.hidden = false;
  box.replaceChildren(
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("h2", { text: "教學課程" }),
      el("span", { class: "small muted num", text: `${open.length}／${course.slots.length} 已解鎖` })),
    el("div", { class: "course-mini" },
      latest
        ? el("a", { class: "course-latest", href: latest.video?.id ? `#/v/${latest.video.id}` : "#/course" },
            el("span", { class: "host", text: latest.host }),
            el("span", { class: "grow" },
              el("div", { class: "small muted", text: `第 ${latest.week} 週・${slotName(latest)}` }),
              el("div", { class: "vtitle", text: latest.video?.title || "準備中，上架後就能看" })),
            latest.video?.id ? el("span", { class: "dl", html: icons.play }) : null)
        : null,
      el("span", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: (done / course.slots.length) * 100 + "%" } }))),
      el("p", { class: "small muted", text: next ? `下一份：${slotName(next)}，${md(next.unlock_on)} 解鎖` : "全部都解鎖了" }),
      el("a", { class: "btn block", href: "#/course" }, "看全部課程"))
  );
}

export async function openCourse() {
  showPage("courseView", { nav: "course", title: `教學課程｜${SITE}` });
  if (state.course) renderCourse();
  else $("#courseList").replaceChildren(skelRow());
  await loadCourse();
  if (!state.course) $("#courseList").replaceChildren(emptyBox("讀不到課程", "請稍後再試。", openCourse));
}

function renderCourse() {
  const slots = state.course.slots;
  const open = slots.filter((s) => s.unlocked).length;
  $("#courseCount").textContent = `已解鎖 ${open}／${slots.length}`;
  // 進度條：每一格是一份，休息週留空隙
  $("#courseTrack").replaceChildren(...slots.map((s, i) => {
    const gap = i > 0 && i % COURSE_HOSTS.length === 0;
    return el("i", { class: [s.unlocked ? "on" : "", isDone(s.video) ? "done" : "", gap ? "gap" : ""].join(" ").trim() });
  }));
  $("#courseList").replaceChildren(...slots.map((s) => {
    const v = s.video;
    const status = s.tier_locked
      ? el("span", { class: "st todo" }, el("span", { html: icons.lock }), "第二級解鎖")
      : !s.unlocked
      ? el("span", { class: "st todo" }, el("span", { html: icons.lock }), `${md(s.unlock_on)} 解鎖`)
      : !v ? el("span", { class: "st todo", text: "準備中" })
      : statusOf(v);
    const body = el("span", { class: "vmain" }, coverThumb(v, { locked: !s.unlocked }), el("span", { class: "vtext" },
      el("div", { class: "vtitle" }, el("span", { class: "host", text: s.host }), " ", el("span", { class: "cpart", text: `第 ${s.part} 份` }), v?.title ? el("span", { class: "course-title", text: `　${v.title}` }) : null),
      v?.description && s.unlocked ? el("div", { class: "vdesc", text: v.description }) : null,
      s.unlocked && v?.duration_sec ? el("div", { class: "vm" }, el("span", { text: fmtDur(v.duration_sec) })) : null));
    const cls = "vrow course-row" + (s.unlocked ? "" : " locked") + (s.unlocked && v?.id ? "" : " static");
    const kids = [
      // 照每個人加入的日期：這一份哪天解鎖（第三級提前解鎖的寫「已解鎖」）
      el("span", { class: "vdate", title: `第 ${s.week} 週` }, md(s.unlock_on), el("small", { text: s.unlocked && s.unlock_on > (state.course.today || "") ? `第 ${s.week} 週・已解鎖` : `第 ${s.week} 週・${weekday(s.unlock_on)}` })),
      body,
      el("span", { class: "vfig r" + (v?.duration_sec && s.unlocked ? "" : " dim"), text: v?.duration_sec && s.unlocked ? fmtDur(v.duration_sec) : "—" }),
      el("span", { class: "vfig r" + (v?.attachment_count ? "" : " dim"), text: v?.attachment_count ? String(v.attachment_count) : "—" }),
      el("span", { class: "r" }, status),
    ];
    return s.unlocked && v?.id ? el("a", { class: cls, href: `#/v/${v.id}` }, ...kids) : el("div", { class: cls }, ...kids);
  }));
}
