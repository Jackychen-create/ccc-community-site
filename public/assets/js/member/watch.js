// 播放頁（#/v/:id?t=秒）：播放器、速度、浮水印、全螢幕、記住看到哪、觀看分段、快捷鍵
import { $, el, api, icons, store, fmtDur, report } from "../core/index.js";
import { BUCKET_SEC } from "../shared/rules.js";
import { state, video, SITE } from "./state.js";
import { showPage, onLeavePage, handleErr } from "./views.js";
import { shortDate, weekday } from "./format.js";
import { statusOf, fileRow } from "./widgets.js";
import { renderChapters } from "./chapters.js";
import { resetNotes, loadNotes, setNoteAt } from "./notes.js";
import { askQuestion } from "./feedback.js";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const P = state.player;

// ── 播放速度 ──
function renderSpeed() {
  const cur = store.get("speed", 1);
  $("#speed").replaceChildren(
    ...SPEEDS.map((s) =>
      el("button", {
        type: "button", "aria-pressed": String(s === cur), text: s + "×",
        onclick: () => setSpeed(s),
      })
    )
  );
}
function setSpeed(s) {
  store.set("speed", s);
  video.defaultPlaybackRate = s;
  video.playbackRate = s;
  renderSpeed();
}
renderSpeed();

function setNotice(node) {
  $("#watchNotice").replaceChildren(...(node ? [node] : []));
}

// 「← 直播留檔」或「← 教學課程」
function setWatchBack(isCourse) {
  const a = $("#watchBack");
  a.href = isCourse ? "#/course" : "#/";
  a.lastChild.textContent = isCourse ? "教學課程" : "直播留檔";
}

export async function openWatch(id, { t = null } = {}) {
  if (state.current && state.current.id === id) {
    if (t !== null) {
      video.currentTime = t;
      video.play().catch(() => {});
    }
    return;
  }
  showPage("watchView", { title: null });
  setWatchBack(false);
  document.body.classList.add("watching");
  renderChapters(null);
  resetNotes();

  $("#wTitle").textContent = "載入中…";
  $("#wDate").textContent = "";
  $("#wMeta").replaceChildren();
  $("#wDesc").textContent = "";
  $("#wFiles").hidden = true;
  $("#videoLoading").hidden = false;
  setNotice(null);
  renderOthers(id);

  let d;
  try {
    d = await api(`/api/videos?id=${id}`);
  } catch (e) {
    if (e.code === "locked") {
      $("#videoLoading").hidden = true;
      setWatchBack(true);
      $("#wTitle").textContent = "這一份課程還沒解鎖";
      $("#wDesc").textContent = `${e.data.unlock_on} 解鎖。先看看已經解鎖的課程吧。`;
      return;
    }
    return handleErr(e, () => {
      $("#videoLoading").hidden = true;
      $("#wTitle").textContent = e.status === 404 ? "找不到這支影片" : "影片載入失敗";
      $("#wDesc").textContent = e.status === 404 ? "影片可能已經下架，回到列表看看其他場次。" : e.message;
    });
  }
  if (!location.hash.startsWith(`#/v/${id}`)) return; // 使用者已經離開

  state.current = d;
  P.retried = false;
  P.lastSaved = d.position_sec || -1;
  document.title = `${d.title}｜${SITE}`;
  $("#wTitle").textContent = d.title;
  $("#wDate").textContent = shortDate(d.published_at);
  const meta = $("#wMeta");
  meta.append(el("span", { text: `${String(d.published_at).slice(0, 4)} 年・${weekday(d.published_at)}` }));
  if (d.course_host) {
    setWatchBack(true);
    $("#wDate").textContent = "課程";
    meta.replaceChildren(el("span", null, "教學課程・", el("span", { class: "host", text: d.course_host }), ` 第 ${d.course_part} 份`));
  } else if (d.hosts?.length) meta.append(el("span", null, "主講 ", ...d.hosts.map((h) => el("span", { class: "host", text: h }))));
  if (d.duration_sec) meta.append(el("span", { class: "num", text: fmtDur(d.duration_sec) }));
  if (!d.is_published) meta.append(el("span", { class: "pill warn", text: "草稿預覽（研究員看不到）" }));
  $("#wDesc").textContent = d.description || "";

  if (d.attachments?.length) {
    $("#wFiles").hidden = false;
    $("#wFileList").replaceChildren(...d.attachments.map(fileRow));
  }

  const pos = d.position_sec || 0;
  const nearEnd = d.duration_sec && pos > d.duration_sec - 20;
  P.pendingSeek = t !== null ? t : pos >= 15 && !nearEnd ? pos : null;
  if (t !== null) P.jumpedTo = t;
  renderChapters(d);
  loadNotes(d.id);

  video.defaultPlaybackRate = store.get("speed", 1);
  startWatermark();
  video.src = d.url;
  if (!state.loadedList) {
    api("/api/videos").then((r) => {
      state.videos = r.videos || [];
      state.loadedList = true;
      if (state.current) renderOthers(state.current.id);
    }).catch(() => {});
  }
}

// 右側「其他場次」
function renderOthers(id) {
  const others = state.videos.filter((v) => v.id !== id).slice(0, 8);
  const box = $("#others");
  if (!others.length) {
    box.replaceChildren(el("p", { class: "small muted", text: state.loadedList ? "目前沒有其他場次" : "" }));
    return;
  }
  box.replaceChildren(
    ...others.map((v) =>
      el("a", { href: `#/v/${v.id}` },
        el("span", { class: "vdate", text: shortDate(v.published_at) }),
        el("span", { class: "vtitle", text: v.title }),
        statusOf(v, { compact: true })
      )
    )
  );
}

// ── 浮水印（防外流）：研究員 Email 在畫面上定時換位置，全螢幕時一起顯示 ──
let wmTimer = null;
function startWatermark() {
  const box = $("#wm");
  const who = state.me?.email || "";
  const stamp = new Date().toISOString().slice(0, 10);
  const tile = el("div", { class: "wm-tile" });
  for (let i = 0; i < 24; i++) tile.append(el("span", { text: who }));
  const mover = el("div", { class: "wm-move", text: `${who}・${stamp}` });
  box.replaceChildren(tile, mover);
  const move = () => {
    mover.style.left = 4 + Math.random() * 56 + "%";
    mover.style.top = 6 + Math.random() * 78 + "%";
  };
  move();
  clearInterval(wmTimer);
  wmTimer = setInterval(move, 12000);
}
function stopWatermark() {
  clearInterval(wmTimer);
  wmTimer = null;
  $("#wm").replaceChildren();
}

// ── 全螢幕：一律放大整個播放區（含浮水印），不用影片本身的全螢幕 ──
const player = $("#player");
const canFs = !!(player.requestFullscreen || player.webkitRequestFullscreen);
function toggleFullscreen() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else if (player.requestFullscreen) player.requestFullscreen().catch(() => {});
  else if (player.webkitRequestFullscreen) player.webkitRequestFullscreen();
}
if (!canFs) $("#fsBtn").hidden = true;
$("#fsBtn").addEventListener("click", toggleFullscreen);
video.addEventListener("dblclick", (e) => {
  e.preventDefault();
  if (canFs) toggleFullscreen();
});
player.addEventListener("contextmenu", (e) => e.preventDefault());

// 離開播放頁（換分頁、登出）：存進度、停止播放
export function leaveWatch() {
  document.body.classList.remove("watching", "playing");
  if (state.current) saveProgress(true);
  state.current = null;
  P.pendingSeek = null;
  seen = {};
  lastBucket = -1;
  stopWatermark();
  video.pause();
  video.removeAttribute("src");
  video.load();
}
onLeavePage(leaveWatch);

// ── 觀看分段：每 30 秒一格，播放時每進到一格記一次（倒回去重看會再記一次），存進度時一起送出 ──
let seen = {};
let lastBucket = -1;
video.addEventListener("timeupdate", () => {
  if (!state.current || video.paused || video.seeking) return;
  const b = Math.floor(video.currentTime / BUCKET_SEC);
  if (b !== lastBucket) {
    seen[b] = (seen[b] || 0) + 1;
    lastBucket = b;
  }
});
video.addEventListener("seeking", () => (lastBucket = -1));

// ── 記住看到哪 ──
function saveProgress(force) {
  const current = state.current;
  if (!current || !video.duration || !isFinite(video.duration)) return;
  const pos = Math.floor(video.ended ? video.duration : video.currentTime);
  if (!force && Math.abs(pos - P.lastSaved) < 5) return;
  P.lastSaved = pos;
  P.lastSaveAt = Date.now();
  const dur = Math.floor(video.duration);
  const v = state.videos.find((x) => x.id === current.id);
  if (v) {
    v.position_sec = pos;
    v.duration_sec = v.duration_sec || dur;
    v.watched_at = new Date().toISOString();
  }
  const body = { videoId: current.id, position: pos, duration: dur };
  if (Object.keys(seen).length) {
    body.seen = seen;
    seen = {};
  }
  api("/api/progress", { method: "POST", body, keepalive: true }).catch(() => {});
}

// ── 影片事件 ──
video.addEventListener("play", () => document.body.classList.add("playing"));
video.addEventListener("pause", () => document.body.classList.remove("playing"));
video.addEventListener("ended", () => document.body.classList.remove("playing"));

video.addEventListener("loadedmetadata", () => {
  $("#videoLoading").hidden = true;
  video.playbackRate = store.get("speed", 1);
  if (P.pendingSeek !== null && P.pendingSeek < video.duration - 5) {
    const at = P.pendingSeek;
    video.currentTime = at;
    if (!P.retried) {
      const jumped = P.jumpedTo !== null;
      P.jumpedTo = null;
      setNotice(el("div", { class: "notice" },
        el("span", { html: icons.clock }),
        el("span", { text: jumped ? `從 ${fmtDur(at)} 開始播放` : `已從 ${fmtDur(at)} 繼續播放` }),
        el("span", { class: "spacer" }),
        el("button", { class: "btn sm", type: "button", text: "從頭開始", onclick: () => {
          video.currentTime = 0;
          setNotice(null);
          video.play().catch(() => {});
        } })
      ));
    }
  }
  P.pendingSeek = null;
});
video.addEventListener("waiting", () => ($("#videoLoading").hidden = false));
video.addEventListener("loadeddata", () => ($("#videoLoading").hidden = true));
video.addEventListener("pause", () => ($("#videoLoading").hidden = true));
video.addEventListener("canplay", () => ($("#videoLoading").hidden = true));
video.addEventListener("playing", () => {
  $("#videoLoading").hidden = true;
  P.retried = false;
});
video.addEventListener("pause", () => saveProgress(true));
video.addEventListener("seeked", () => saveProgress(false));
video.addEventListener("timeupdate", () => {
  if (Date.now() - P.lastSaveAt > 15000) saveProgress(false);
});
video.addEventListener("ratechange", () => {
  if (SPEEDS.includes(video.playbackRate) && video.playbackRate !== store.get("speed", 1)) {
    store.set("speed", video.playbackRate);
    renderSpeed();
  }
});
video.addEventListener("ended", () => {
  saveProgress(true);
  const idx = state.videos.findIndex((v) => v.id === state.current?.id);
  const next = idx >= 0 ? state.videos[idx + 1] : null;
  setNotice(el("div", { class: "notice" },
    el("span", { html: icons.ok }),
    el("span", { text: "這一場看完了" }),
    el("span", { class: "spacer" }),
    next ? el("a", { class: "btn sm primary", href: `#/v/${next.id}`, text: `下一場：${next.title}` }) : el("a", { class: "btn sm", href: "#/", text: "回到列表" })
  ));
});
video.addEventListener("error", async () => {
  const current = state.current;
  if (!current || !video.getAttribute("src")) return;
  $("#videoLoading").hidden = true;
  // 簽名連結過期（例如暫停太久）就換一個新的，從原本的位置繼續
  if (!P.retried) {
    P.retried = true;
    const at = video.currentTime || P.pendingSeek || 0;
    try {
      const d = await api(`/api/videos?id=${current.id}`);
      if (!state.current || state.current.id !== d.id) return;
      P.pendingSeek = at;
      video.src = d.url;
      return;
    } catch {}
  }
  report("video", `播放失敗（錯誤碼 ${video.error?.code ?? "?"}）`, { video: current.id, title: current.title });
  setNotice(el("div", { class: "notice" }, el("span", { html: icons.alert }),
    el("span", { text: "影片暫時無法播放，請重新整理頁面，或確認瀏覽器支援這個格式。" }),
    el("span", { class: "spacer" }),
    el("button", { class: "btn sm", type: "button", text: "回報這個問題", onclick: () => askQuestion("problem") })));
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveProgress(true);
});
window.addEventListener("pagehide", () => saveProgress(true));

// ── 快捷鍵（列表按 / 搜尋；播放頁：空白鍵／K 播放暫停、←→／J L 跳 10 秒、F 全螢幕、M 靜音、N 寫筆記）──
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, textarea, select, button, a, video, [contenteditable]")) return;
  if ($("#appView").hidden) return;
  if (!$("#listView").hidden && e.key === "/") {
    e.preventDefault();
    $("#search").focus();
    return;
  }
  if ($("#watchView").hidden || !state.current) return;
  const k = e.key.toLowerCase();
  if (k === " " || k === "k") {
    e.preventDefault();
    video.paused ? video.play().catch(() => {}) : video.pause();
  } else if (k === "arrowleft" || k === "j") {
    e.preventDefault();
    video.currentTime = Math.max(0, video.currentTime - 10);
  } else if (k === "arrowright" || k === "l") {
    e.preventDefault();
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
  } else if (k === "f") {
    if (canFs) toggleFullscreen();
  } else if (k === "m") {
    video.muted = !video.muted;
  } else if (k === "n") {
    e.preventDefault();
    setNoteAt(video.currentTime);
    $("#noteBody").focus({ preventScroll: false });
  }
});
