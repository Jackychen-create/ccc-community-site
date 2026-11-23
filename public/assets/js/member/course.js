// 交易分享（v1.37.0，取代系統分享）：右欄小卡、#/course 分頁
// 後台標成「交易分享」的影片，加入就能看，沒有解鎖排程；伺服器在 /api/course 整理好
import { $, el, api, icons, fmtDur } from "../core/index.js";
import { state, SITE } from "./state.js";
import { showPage } from "./views.js";
import { md } from "./format.js";
import { statusOf, coverThumb, emptyBox, skelRow } from "./widgets.js";

export async function loadCourse() {
  try {
    state.course = await api("/api/course");
  } catch {
    state.course = null;
  }
  renderCoursePanel();
  if (state.course?.items && !$("#courseView").hidden) renderCourse();
  return state.course;
}

// 右欄：最新一部交易分享（還沒有就不顯示）
function renderCoursePanel() {
  const items = state.course?.items || [];
  const box = $("#coursePanel");
  if (!items.length) return (box.hidden = true);
  const latest = items[0];
  box.hidden = false;
  box.replaceChildren(
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("h2", { text: "交易分享" }),
      el("span", { class: "small muted num", text: `${items.length} 部` })),
    el("div", { class: "course-mini" },
      el("a", { class: "course-latest", href: latest.locked ? "#/course" : `#/v/${latest.id}` },
        el("span", { class: "grow" },
          el("div", { class: "small muted", text: `最新・${md(latest.published_at)}` }),
          el("div", { class: "vtitle", text: latest.title })),
        latest.locked ? null : el("span", { class: "dl", html: icons.play })),
      el("a", { class: "btn block", href: "#/course" }, "看全部交易分享"))
  );
}

export async function openCourse() {
  showPage("courseView", { nav: "course", title: `交易分享｜${SITE}` });
  if (state.course?.items) renderCourse();
  else $("#courseList").replaceChildren(skelRow());
  await loadCourse();
  if (!state.course) $("#courseList").replaceChildren(emptyBox("讀不到交易分享", "請稍後再試。", openCourse));
}

function renderCourse() {
  const items = state.course?.items;
  if (!items) return;
  $("#courseCount").textContent = items.length ? String(items.length) : "";
  if (!items.length) return $("#courseList").replaceChildren(el("div", { class: "empty-share" },
    el("p", { class: "empty-share-t", text: "還沒有交易分享" }),
    el("p", { class: "small muted", text: "上架之後會出現在這裡，加入的研究員都看得到。" })));
  $("#courseList").replaceChildren(...items.map((v) => {
    const body = el("span", { class: "vmain" }, coverThumb(v, { locked: !!v.locked }), el("span", { class: "vtext" },
      el("div", { class: "vtitle" }, (v.hosts || []).length ? el("span", { class: "host", text: v.hosts.join("・") }) : null, " ", el("span", { class: "course-title", text: v.title })),
      v.description && !v.locked ? el("div", { class: "vdesc", text: v.description }) : null,
      !v.locked && v.duration_sec ? el("div", { class: "vm" }, el("span", { text: fmtDur(v.duration_sec) })) : null));
    const kids = [
      el("span", { class: "vdate" }, md(v.published_at)),
      body,
      el("span", { class: "vfig r" + (v.duration_sec && !v.locked ? "" : " dim"), text: v.duration_sec && !v.locked ? fmtDur(v.duration_sec) : "—" }),
      el("span", { class: "vfig r" + (v.attachment_count ? "" : " dim"), text: v.attachment_count ? String(v.attachment_count) : "—" }),
      el("span", { class: "r" }, v.locked ? el("a", { class: "btn sm", href: "#/plans", text: "訂閱月費" }) : statusOf(v)),
    ];
    const cls = "vrow course-row" + (v.locked ? " locked static" : "");
    return v.locked ? el("div", { class: cls }, ...kids) : el("a", { class: cls, href: `#/v/${v.id}` }, ...kids);
  }));
}
