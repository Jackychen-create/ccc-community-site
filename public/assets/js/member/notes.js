// 筆記（只有自己看得到）：播放頁下方的筆記、#/notes「我的筆記」分頁
import { $, el, api, icon, fmtDur, setBusy, toast } from "../core/index.js";
import { state, video, SITE } from "./state.js";
import { showPage, handleErr } from "./views.js";
import { shortDate } from "./format.js";
import { emptyBox, skelRow } from "./widgets.js";
import { seekTo } from "./chapters.js";

let notes = []; // 正在看的這支影片的筆記
let noteAt = 0;

export function setNoteAt(t) {
  noteAt = Math.max(0, Math.floor(t || 0));
  $("#noteAt").textContent = fmtDur(noteAt);
}
$("#noteAt").addEventListener("click", () => setNoteAt(video.currentTime));
$("#noteBody").addEventListener("focus", () => {
  if (!$("#noteBody").value.trim()) setNoteAt(video.currentTime);
});

export function resetNotes() {
  notes = [];
  renderNotes();
}

export async function loadNotes(id) {
  try {
    const r = await api(`/api/notes?videoId=${id}`);
    if (state.current?.id !== id) return;
    notes = r.notes || [];
    renderNotes();
  } catch {}
}

function renderNotes() {
  const list = $("#noteList");
  if (!notes.length) {
    list.replaceChildren(el("p", { class: "small muted note-empty", text: "還沒有筆記。播放到重點時寫一句，之後點時間就能跳回來。" }));
    return;
  }
  list.replaceChildren(...notes.map((n) =>
    el("div", { class: "note" },
      el("button", { class: "note-t num", type: "button", text: fmtDur(n.t), "aria-label": `跳到 ${fmtDur(n.t)}`, onclick: () => seekTo(n.t) }),
      el("p", { class: "note-body", text: n.body }),
      el("button", { class: "btn sm ghost icon", type: "button", "aria-label": "刪除這則筆記", onclick: () => deleteNote(n) }, icon("trash")))));
}

$("#noteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = $("#noteBody").value.trim();
  if (!body || !state.current) return;
  const btn = $("#noteSave");
  setBusy(btn, true, "儲存中…");
  try {
    const r = await api("/api/notes", { method: "POST", body: { videoId: state.current.id, t: noteAt, body } });
    notes.push(r.note);
    notes.sort((a, b) => a.t - b.t);
    $("#noteBody").value = "";
    renderNotes();
    toast(`已記在 ${fmtDur(r.note.t)}`);
  } catch (err) {
    toast(err.message, "err");
  } finally {
    setBusy(btn, false);
  }
});
$("#noteBody").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("#noteForm").requestSubmit();
});

async function deleteNote(n) {
  try {
    await api(`/api/notes?id=${n.id}`, { method: "DELETE" });
    notes = notes.filter((x) => x.id !== n.id);
    renderNotes();
    if (!$("#notesView").hidden) openNotes();
  } catch (err) {
    toast(err.message, "err");
  }
}

// 右欄「最近的筆記」：進到列表時抓一次
export async function loadRecentNotes() {
  const box = $("#recentNotesList");
  let list = [];
  try {
    list = (await api("/api/notes")).notes || [];
  } catch {
    return;
  }
  const recent = list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 3);
  if (!recent.length) {
    box.replaceChildren(el("p", { class: "small muted note-empty", text: "看影片時按 N 就能在那個時間點記一筆，最近的筆記會出現在這裡。" }));
    return;
  }
  box.replaceChildren(...recent.map((n) =>
    el("a", { class: "recent-note", href: `#/v/${n.video_id}?t=${n.t}` },
      el("span", { class: "num", text: fmtDur(n.t) }),
      el("span", null, el("span", { class: "recent-note-body", text: n.body }), el("span", { class: "small muted", text: `${shortDate(n.published_at)} ${n.video_title}` })))));
}

// ── 我的筆記（全部，依場次分組）──
export async function openNotes() {
  showPage("notesView", { title: `我的筆記｜${SITE}`, scrollTop: false });
  const box = $("#notesAll");
  box.replaceChildren(skelRow());
  let all = [];
  try {
    all = (await api("/api/notes")).notes || [];
  } catch (e) {
    return handleErr(e, () => box.replaceChildren(emptyBox("讀不到筆記", e.message, openNotes)));
  }
  $("#notesCount").textContent = all.length ? `共 ${all.length} 則` : "";
  if (!all.length) {
    box.replaceChildren(emptyBox("還沒有筆記", "看影片時在播放器下方寫一句，就會出現在這裡。"));
    return;
  }
  const groups = new Map();
  for (const n of all) {
    if (!groups.has(n.video_id)) groups.set(n.video_id, { title: n.video_title, date: n.published_at, items: [] });
    groups.get(n.video_id).items.push(n);
  }
  box.replaceChildren(...[...groups.entries()]
    .sort((a, b) => String(b[1].date).localeCompare(String(a[1].date)))
    .map(([vid, g]) =>
      el("section", { class: "note-group" },
        el("a", { class: "note-group-head", href: `#/v/${vid}` }, el("span", { class: "vdate", text: shortDate(g.date) }), el("span", { class: "vtitle", text: g.title })),
        ...g.items.map((n) =>
          el("div", { class: "note" },
            el("a", { class: "note-t num", href: `#/v/${vid}?t=${n.t}`, text: fmtDur(n.t) }),
            el("p", { class: "note-body", text: n.body }),
            el("button", { class: "btn sm ghost icon", type: "button", "aria-label": "刪除這則筆記", onclick: () => deleteNote(n) }, icon("trash")))))));
}
