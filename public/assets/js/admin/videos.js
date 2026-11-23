// 影片列表（後台首頁）：系統分享進度格、每一場的發布開關、刪除
// 跟 editor.js 互相引用（列表按「編輯」開編輯器、編輯器存檔後重畫列表），都是點了才呼叫，不影響載入
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { COURSE_HOSTS, COURSE_PARTS } from "../shared/rules.js";
import { state } from "./state.js";
import { fail, loadingBox } from "./common.js";
import { openEditor } from "./editor.js";

const PARTS = Array.from({ length: COURSE_PARTS }, (_, i) => i + 1);

// 影片列表
let videosLoaded = false;
export async function loadVideos() {
  if (!videosLoaded) $("#videoTableBox").replaceChildren(loadingBox());
  try {
    const r = await api("/api/admin/videos");
    state.videos = r.videos || [];
    videosLoaded = true;
    renderVideos();
  } catch (e) {
    fail(e);
  }
}

export function renderVideos() {
  $("#cVideos").textContent = state.videos.length || "";
  const box = $("#videoTableBox");
  if (!state.videos.length) {
    box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有影片" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "上傳第一場直播紀錄吧，上傳完成後會先存成草稿。" })));
    return;
  }
  const rows = state.videos.map((v) => {
    const sw = el("input", { type: "checkbox", "aria-label": "發布" });
    sw.checked = v.is_published;
    sw.addEventListener("change", () => togglePublish(v, sw));
    const thumb = el("div", { class: "mini-thumb" });
    thumb.append(v.thumb_url ? A.thumbImg(v.thumb_url) : A.placeholderSvg());
    return el("tr", null,
      el("td", { class: "c-thumb", style: { width: "104px" } }, thumb),
      el("td", null,
        el("div", { class: "t-title" }, v.course_host ? el("span", { class: "pill brass course-tag", text: `課程 ${v.course_host} ${v.course_part}/6` }) : null, v.is_public ? el("span", { class: "pill good course-tag", text: "公開" }) : null, v.title),
        el("div", { class: "t-sub", text: v.description || "尚未填寫簡介" }),
        v.hosts?.length && !v.course_host ? el("div", { class: "hosts", style: { marginTop: "6px" } }, ...v.hosts.map((h) => el("span", { class: "host", text: h }))) : null),
      el("td", { class: "num small", style: { whiteSpace: "nowrap" }, text: A.fmtDate(v.published_at) }),
      el("td", { class: "num small hide-sm", text: v.duration_sec ? A.fmtDur(v.duration_sec) : "—" }),
      el("td", { class: "small hide-sm" }, v.attachments?.length ? el("span", { class: "meta-ico" }, icon("paperclip"), String(v.attachments.length)) : el("span", { class: "muted", text: "—" })),
      el("td", null, el("label", { class: "switch" }, sw, el("span", { class: "track" }), el("span", { class: "state", text: v.is_published ? "已發布" : "草稿" }))),
      el("td", null, el("div", { class: "actions" },
        el("button", { class: "btn sm", type: "button", onclick: () => openEditor(v.id) }, icon("edit"), "編輯"),
        v.is_public ? el("button", { class: "btn sm icon", type: "button", "aria-label": `複製「${v.title}」的分享連結`, title: "複製分享連結（不用登入就能看）", onclick: () => A.copyText(`${location.origin}/watch?v=${v.id}`) }, icon("copy")) : null,
        el("button", { class: "btn sm icon danger", type: "button", "aria-label": `刪除 ${v.title}`, onclick: () => deleteVideo(v) }, icon("trash"))
      ))
    );
  });
  // 系統分享進度：CCC、X 各 6 份，哪幾份上架了
  const slot = (h, n) => state.videos.find((x) => x.course_host === h && x.course_part === n);
  const filled = COURSE_HOSTS.reduce((a, h) => a + PARTS.filter((n) => slot(h, n)?.is_published).length, 0);
  const courseCard = el("div", { class: "card course-grid-card" },
    el("div", { class: "course-grid-head" },
      el("h2", { text: "系統分享" }),
      el("span", { class: "small muted", text: `已上架 ${filled}／${COURSE_HOSTS.length * COURSE_PARTS}・研究員加入後每週解鎖一份（CCC→X，每 3 週休息一週）` })),
    el("div", { class: "course-grid" },
      ...COURSE_HOSTS.map((h) => el("div", { class: "course-grid-row" },
        el("span", { class: "host", text: h }),
        ...PARTS.map((n) => {
          const x = slot(h, n);
          return el("button", {
            class: "cg-cell" + (x ? (x.is_published ? " on" : " draft") : ""), type: "button",
            title: x ? `${h} 第 ${n} 份：${x.title}${x.is_published ? "" : "（草稿）"}` : `${h} 第 ${n} 份：還沒有影片。上傳後在「編輯」把類型改成系統分享`,
            onclick: () => (x ? openEditor(x.id) : A.toast(`上傳影片後，在「編輯」把類型選「系統分享」、${h} 第 ${n} 份`)),
          }, String(n));
        })))));
  box.replaceChildren(
    courseCard,
    el("div", { class: "table-wrap" },
      el("table", { class: "table stack vt" },
        el("thead", null, el("tr", null,
          el("th", null, el("span", { class: "sr-only", text: "封面" })), el("th", { text: "標題" }), el("th", { text: "日期" }),
          el("th", { class: "hide-sm", text: "長度" }), el("th", { class: "hide-sm", text: "教材" }), el("th", { text: "狀態" }),
          el("th", null, el("span", { class: "sr-only", text: "操作" })))),
        el("tbody", null, rows)))
  );
}

async function togglePublish(v, sw) {
  const next = sw.checked;
  sw.disabled = true;
  try {
    await api("/api/admin/videos", { method: "PATCH", body: { id: v.id, is_published: next } });
    v.is_published = next;
    sw.closest(".switch").querySelector(".state").textContent = next ? "已發布" : "草稿";
    A.toast(next ? `已發布「${v.title}」` : `已改回草稿「${v.title}」`);
  } catch (e) {
    sw.checked = !next;
    fail(e);
  } finally {
    sw.disabled = false;
  }
}

export async function deleteVideo(v) {
  const ok = await A.confirmDialog({
    title: "刪除影片",
    message: `確定要刪除「${v.title}」嗎？影片檔、封面、教材和研究員的觀看紀錄會一起刪除，無法復原。`,
    confirmText: "刪除",
    danger: true,
  });
  if (!ok) return false;
  try {
    await api(`/api/admin/videos?id=${v.id}`, { method: "DELETE" });
    state.videos = state.videos.filter((x) => x.id !== v.id);
    renderVideos();
    A.toast("已刪除");
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
