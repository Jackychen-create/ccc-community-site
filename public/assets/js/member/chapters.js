// 播放頁的章節：右側清單＋影片下方的時間軸，點了跳到那一段
import { $, el, fmtDur } from "../core/index.js";
import { state, video } from "./state.js";

let chapters = [];
let activeChap = -1;

export function renderChapters(d) {
  chapters = d?.chapters || [];
  const has = chapters.length > 0;
  $("#wChapters").hidden = !has;
  $("#chapBar").hidden = !has;
  if (!has) {
    $("#chapList").replaceChildren();
    $("#chapBar").replaceChildren();
    return;
  }
  $("#chapCount").textContent = `${chapters.length} 段`;
  $("#chapList").replaceChildren(...chapters.map((c, i) =>
    el("button", { class: "chap", type: "button", dataset: { i }, onclick: () => seekTo(c.t) },
      el("span", { class: "num", text: fmtDur(c.t) }), el("span", { class: "chap-title", text: c.title }))));
  // 時間軸：每一段一格，寬度照長度
  const total = d.duration_sec || chapters[chapters.length - 1].t + 60;
  $("#chapBar").replaceChildren(
    ...chapters.map((c, i) => {
      const end = chapters[i + 1]?.t ?? total;
      return el("button", { class: "seg", type: "button", title: `${fmtDur(c.t)} ${c.title}`, "aria-label": `跳到 ${fmtDur(c.t)} ${c.title}`,
        style: { flexGrow: String(Math.max(1, end - c.t)) }, dataset: { i }, onclick: () => seekTo(c.t) }, el("i"));
    })
  );
  updateChapter();
}

// 跳到某個時間；影片還沒載入好就等載入後再跳
export function seekTo(t) {
  if (!isFinite(video.duration)) {
    state.player.pendingSeek = t;
    state.player.jumpedTo = t;
    return;
  }
  video.currentTime = t;
  video.play().catch(() => {});
}

function updateChapter() {
  if (!chapters.length) return;
  const now = video.currentTime || 0;
  let idx = -1;
  chapters.forEach((c, i) => {
    if (now >= c.t) idx = i;
  });
  document.querySelectorAll("#chapBar .seg").forEach((seg, i) => {
    const c = chapters[i];
    const end = chapters[i + 1]?.t ?? (video.duration || c.t + 60);
    const f = Math.max(0, Math.min(1, (now - c.t) / Math.max(1, end - c.t)));
    seg.firstChild.style.width = f * 100 + "%";
  });
  if (idx === activeChap) return;
  activeChap = idx;
  document.querySelectorAll("#chapList .chap").forEach((b, i) => b.classList.toggle("on", i === idx));
  document.querySelectorAll("#chapBar .seg").forEach((b, i) => b.classList.toggle("on", i === idx));
}
video.addEventListener("timeupdate", updateChapter);
video.addEventListener("seeked", updateChapter);
