// 直播留檔列表（首頁）：篩選、搜尋、每一列、右欄（上次看到、統計、課程、筆記）
import { $, el, api, icon, cfg, report, countUp, fmtDur, placeholderSvg } from "../core/index.js";
import { state } from "./state.js";
import { showPage, onLeavePage, handleErr } from "./views.js";
import { shortDate, weekday, monthKey, monthLabel, pctOf, isWatched, isInProgress, isNew } from "./format.js";
import { statusOf, hostTags, thumbBox, coverThumb, emptyBox, skelRow } from "./widgets.js";
import { loadCourse } from "./course.js";
import { loadRecentNotes } from "./notes.js";

let filter = "all";
let host = ""; // 主講人篩選，空字串＝全部
let query = "";
let searchMissTimer = null;
let listScroll = 0;
let asideAnimated = false; // 右側統計數字、進度條：進到列表時跑一次

// 離開列表時記住捲到哪，回來時捲回去
onLeavePage(() => {
  if (!$("#listView").hidden) listScroll = window.scrollY;
});

export async function openList() {
  showPage("listView", { nav: "list", search: true, scrollTop: false });
  asideAnimated = false;
  if (!state.loadedList) renderSkeleton();
  else {
    renderList();
    requestAnimationFrame(() => window.scrollTo(0, listScroll));
  }
  loadRecentNotes();
  loadCourse();
  try {
    const r = await api("/api/videos");
    state.videos = r.videos || [];
    state.loadedList = true;
    if (!$("#listView").hidden) renderList();
  } catch (e) {
    handleErr(e, () => {
      $("#grid").replaceChildren(emptyBox("讀不到影片清單", e.message, openList));
    });
  }
}

function renderSkeleton() {
  $("#continueList").replaceChildren(skelRow({ "aria-hidden": "true" }));
  $("#statsPanel").replaceChildren();
  $("#chips").replaceChildren();
  $("#countText").textContent = "";
  const items = [];
  for (let i = 0; i < 6; i++) items.push(skelRow({ "aria-hidden": "true" }));
  $("#grid").replaceChildren(...items);
}

// ── 篩選 ──
function renderChips() {
  const months = [...new Set(state.videos.map(monthKey))];
  const opts = [["all", "全部"], ["unfinished", "未看完"], ...months.map((k) => ["m:" + k, monthLabel(k)])];
  if (!opts.some(([k]) => k === filter)) filter = "all";
  const hosts = hostList();
  if (host && !hosts.includes(host)) host = "";
  $("#chips").replaceChildren(...[
    ...opts.map(([k, label]) =>
      el("button", {
        class: "chip", type: "button", "aria-pressed": String(filter === k), text: label,
        onclick: () => {
          filter = k;
          renderList();
        },
      })
    ),
    hosts.length > 1 ? el("span", { class: "chip-sep", "aria-hidden": "true" }) : null,
    ...(hosts.length > 1 ? hosts : []).map((h) =>
      el("button", {
        class: "chip host-chip", type: "button", "aria-pressed": String(host === h), title: `只看 ${h} 主講的場次`, text: h,
        onclick: () => {
          host = host === h ? "" : h;
          renderList();
        },
      })
    ),
  ].filter(Boolean));
}

// 有出現在影片裡的主講人，照 config.js 的順序排
function hostList() {
  const used = new Set(state.videos.flatMap((v) => v.hosts || []));
  const order = cfg.HOSTS || [];
  return [...order.filter((h) => used.has(h)), ...[...used].filter((h) => !order.includes(h))];
}

// 搜尋到章節時，列出符合的章節，點了直接跳到那個時間
function chapterHits(v) {
  const q = query.trim().toLowerCase();
  if (!q || !v.chapters?.length) return null;
  const hits = v.chapters.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 3);
  if (!hits.length) return null;
  return el("div", { class: "chap-hits" }, ...hits.map((c) =>
    el("span", { class: "chap-hit", role: "link", tabindex: "0", onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      location.hash = `#/v/${v.id}?t=${c.t}`;
    } }, el("b", { class: "num", text: fmtDur(c.t) }), c.title)));
}

function filtered() {
  const q = query.trim().toLowerCase();
  return state.videos.filter((v) => {
    if (filter === "unfinished" && isWatched(v)) return false;
    if (filter.startsWith("m:") && monthKey(v) !== filter.slice(2)) return false;
    if (host && !(v.hosts || []).includes(host)) return false;
    if (q && !`${v.title} ${v.description || ""} ${(v.hosts || []).join(" ")} ${(v.chapters || []).map((c) => c.title).join(" ")}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ── 列表 ──
function renderList() {
  const videos = state.videos;
  renderChips();
  renderTicker();
  const list = filtered();
  $("#countText").textContent = videos.length ? `共 ${videos.length} 場` : "";
  renderAside();

  if (!videos.length) {
    $("#grid").replaceChildren(emptyBox("目前還沒有影片", "新的直播留檔上傳後會出現在這裡。"));
    return;
  }
  if (!list.length) {
    const q = query.trim();
    clearTimeout(searchMissTimer);
    // 搜不到東西也記到後台「網站狀況」，知道大家在找什麼
    if (q.length >= 2) searchMissTimer = setTimeout(() => query.trim() === q && report("search_empty", q, { q }), 1500);
    const box = emptyBox("找不到符合的場次", q ? `沒有標題或簡介包含「${q}」的場次。` : "換個篩選條件試試看。");
    box.append(el("button", { class: "btn sm", type: "button", style: { marginTop: "14px" }, text: "顯示全部場次", onclick: () => {
      filter = "all";
      host = "";
      query = "";
      $("#search").value = "";
      renderList();
    } }));
    $("#grid").replaceChildren(box);
    return;
  }
  $("#grid").replaceChildren(...list.map(row));
  state.ticked = true;
}

function renderTicker() {
  const t = $("#ticker");
  const videos = state.videos;
  if (!videos.length) return t.replaceChildren();
  t.replaceChildren(
    el("span", null, "最新一場", el("b", { text: shortDate(videos[0].published_at) })),
    el("span", null, "累計", el("b", { text: String(videos.length) }), " 場")
  );
}

function row(v) {
  const fresh = isNew(v);
  const dur = v.duration_sec ? fmtDur(v.duration_sec) : "—";
  const files = v.attachment_count || 0;
  return el("a", { class: "vrow" + (fresh ? " is-new" + (state.ticked ? "" : " tick") : ""), href: `#/v/${v.id}` },
    el("span", { class: "vdate" }, shortDate(v.published_at), el("small", { text: weekday(v.published_at) })),
    el("span", { class: "vmain" },
      coverThumb(v, { badge: shortDate(v.published_at) }),
      el("span", { class: "vtext" },
        el("div", { class: "vtitle", text: v.title }),
        v.description ? el("div", { class: "vdesc", text: v.description }) : null,
        hostTags(v),
        chapterHits(v),
        el("div", { class: "vm" }, el("span", { text: dur }), files ? el("span", { text: `教材 ${files}` }) : null)
      )
    ),
    el("span", { class: "vfig r" + (v.duration_sec ? "" : " dim"), text: dur }),
    el("span", { class: "vfig r" + (files ? "" : " dim"), text: files ? String(files) : "—" }),
    el("span", { class: "r" }, statusOf(v))
  );
}

// ── 右欄：上次看到哪一場、本月統計（課程、交易量、最近的筆記在各自的檔案）──
function renderAside() {
  const videos = state.videos;
  const box = $("#continueList");
  const animate = !asideAnimated;
  asideAnimated = true;
  const numNode = (n) => {
    const t = document.createTextNode(String(n));
    if (animate) countUp(t, n);
    return t;
  };

  // 統計
  const thisMonth = new Date().toISOString().slice(0, 7);
  const watchedThisMonth = videos.filter((v) => v.position_sec > 0 && String(v.watched_at || "").slice(0, 7) === thisMonth).length;
  const unfinished = videos.filter((v) => !isWatched(v)).length;
  const done = videos.filter(isWatched).length;
  const stat = (label, n) => el("div", null, el("small", { text: label }), el("b", null, numNode(n), el("span", { text: "場" })));
  $("#statsPanel").replaceChildren(
    el("div", { class: "stats stats-4" }, stat("這個月看了", watchedThisMonth), stat("未看完", unfinished), stat("看完了", done), stat("全部場次", videos.length))
  );

  // 上次看到／最新一場／還沒有影片
  if (!videos.length) {
    box.replaceChildren(el("div", { class: "resume" },
      el("span", { class: "label", text: "最新一場" }),
      el("div", { class: "screen" }, placeholderSvg()),
      el("div", { class: "vtitle", text: "第一場直播還沒上架" }),
      el("p", { class: "small muted", style: { marginTop: "6px" }, text: state.me?.notify ? "上架後會出現在這裡，也會寄信通知你。" : "上架後會出現在這裡。" })));
    return;
  }
  const cont = videos
    .filter(isInProgress)
    .sort((a, b) => new Date(b.watched_at || 0) - new Date(a.watched_at || 0));
  if (!cont.length) {
    const latest = videos[0];
    box.replaceChildren(
      el("div", { class: "resume" },
        el("span", { class: "label", text: "最新一場" }),
        el("a", { href: `#/v/${latest.id}`, style: { display: "block" } }, thumbBox(latest)),
        el("div", { class: "vtitle", text: latest.title }),
        el("div", { class: "prog" }, el("span", { text: shortDate(latest.published_at) }), el("span", { text: latest.duration_sec ? fmtDur(latest.duration_sec) : "" })),
        el("a", { class: "btn primary block", href: `#/v/${latest.id}` }, icon("play"), "開始看")
      )
    );
    return;
  }
  const v = cont[0];
  const pct = Math.round(pctOf(v) * 100);
  const left = v.duration_sec ? fmtDur(v.duration_sec - v.position_sec) : "";
  const screen = thumbBox(v);
  screen.append(el("span", { class: "tc", text: `${fmtDur(v.position_sec)}${v.duration_sec ? " / " + fmtDur(v.duration_sec) : ""}` }));
  const more = cont.slice(1, 4);
  box.replaceChildren(...[
    el("div", { class: "resume" },
      el("span", { class: "label", text: "上次看到" }),
      el("a", { href: `#/v/${v.id}`, style: { display: "block" }, "aria-label": `繼續看 ${v.title}` }, screen),
      el("div", { class: "vtitle", text: v.title }),
      el("div", { class: "prog" }, el("span", { text: shortDate(v.published_at) }), el("span", { text: left ? `剩 ${left}` : "" })),
      el("div", { class: "track" + (animate ? " grow" : "") }, el("i", { style: { width: pct + "%" } })),
      el("a", { class: "btn primary block", href: `#/v/${v.id}` }, icon("play"), `從 ${fmtDur(v.position_sec)} 繼續`)
    ),
    more.length ? el("div", { class: "more" }, ...more.map((m) =>
      el("a", { href: `#/v/${m.id}` }, el("span", { text: m.title }), el("span", { class: "num", text: Math.round(pctOf(m) * 100) + "%" })))) : null,
  ].filter(Boolean));
}

$("#search").addEventListener("input", (e) => {
  query = e.target.value;
  if (state.loadedList) renderList();
});

