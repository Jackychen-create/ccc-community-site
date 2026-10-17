// 直播預告：排直播時間 → 機器人發到 Discord「研究員專屬公告」頻道；修改、取消會在公告下面通知
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { fail, loadingBox } from "./common.js";

let data = null; // { lives, discord: { configured, channelId } }
let loaded = false;
let editing = null; // 正在修改的那場

export async function loadLives() {
  if (!loaded) $("#liveTableBox").replaceChildren(loadingBox());
  try {
    data = await api("/api/admin/lives");
    loaded = true;
    render();
  } catch (e) {
    fail(e);
  }
}

const WEEK = "日一二三四五六";
const pad = (n) => String(n).padStart(2, "0");
// 10/20（二）20:00（用瀏覽器的時間，管理員都在台灣）
function when(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toInput = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const isPast = (l) => Date.parse(l.starts_at) < Date.now() - 3 * 3600e3;

function render() {
  const upcoming = data.lives.filter((l) => l.status === "scheduled" && !isPast(l));
  const others = data.lives.filter((l) => !upcoming.includes(l)).reverse();
  $("#cLives").textContent = upcoming.length || "";
  renderHint();
  const box = $("#liveTableBox");
  const parts = [];
  if (!upcoming.length) {
    parts.push(el("div", { class: "empty" }, el("h2", { text: "還沒有排直播" }),
      el("p", { class: "small", style: { marginTop: "6px" }, text: "在右邊填好時間，研究員會在 Discord 收到公告，網站首頁也會顯示下一場。" })));
  } else {
    parts.push(table(upcoming, true));
  }
  if (others.length) {
    parts.push(el("details", { class: "live-more", style: { marginTop: "18px" } },
      el("summary", { class: "small", text: `已結束、已取消（${others.length}）` }), table(others, false)));
  }
  box.replaceChildren(...parts);
}

function renderHint() {
  const d = data.discord;
  $("#liveHint").textContent = !d.configured
    ? "Discord 機器人還沒設定，只會存在網站，不會發公告。"
    : !d.channelId ? "還沒有研究員專屬公告頻道：到「Discord 審核」按一鍵建立，才會發公告。" : "會發到 Discord「研究員專屬公告」頻道，開播前 30 分鐘自動提醒。";
}

function table(list, active) {
  return el("div", { class: "table-wrap" },
    el("table", { class: "table stack" },
      el("thead", null, el("tr", null, el("th", { text: "時間" }), el("th", { text: "直播" }), el("th", { text: "Discord" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
      el("tbody", null, list.map((l) => {
        const cancelled = l.status === "cancelled";
        const dc = cancelled ? ["已取消", "warn"] : l.discord_message_id ? [l.reminded_at ? "已公告、已提醒" : "已公告", "good"] : ["沒有發公告", ""];
        return el("tr", { "data-live": l.id },
          el("td", { "data-label": "時間" }, el("b", { class: "num", text: when(l.starts_at) })),
          el("td", { "data-label": "直播" }, el("span", { text: l.title }),
            l.note ? el("div", { class: "small muted live-note", text: l.note }) : null,
            l.link ? el("a", { class: "small", href: l.link, target: "_blank", rel: "noopener", text: "直播連結" }) : null),
          el("td", { "data-label": "Discord" }, el("span", { class: "pill " + dc[1] }, el("span", { class: "dot" }), dc[0])),
          el("td", null, active ? el("div", { class: "actions" },
            el("button", { class: "btn sm", type: "button", onclick: () => startEdit(l) }, icon("edit"), "修改"),
            el("button", { class: "btn sm ghost danger", type: "button", text: "取消直播", onclick: () => cancelLive(l) })) : null));
      }))));
}

function resetForm() {
  editing = null;
  $("#liveFormTitle").textContent = "排一場直播";
  $("#liveSave").textContent = "排定並發公告";
  $("#liveCancelEdit").hidden = true;
  $("#liveMentionRow").hidden = false;
  for (const id of ["#liveTitle", "#liveAt", "#liveNote", "#liveLink"]) $(id).value = "";
}

function startEdit(l) {
  editing = l;
  $("#liveFormTitle").textContent = "修改直播";
  $("#liveSave").textContent = "儲存修改";
  $("#liveCancelEdit").hidden = false;
  $("#liveMentionRow").hidden = true;
  $("#liveTitle").value = l.title;
  $("#liveAt").value = toInput(l.starts_at);
  $("#liveNote").value = l.note || "";
  $("#liveLink").value = l.link || "";
  $("#liveFormBox").scrollIntoView({ block: "start", behavior: A.reduceMotion() ? "auto" : "smooth" }); // 手機上表單在下面
  $("#liveTitle").focus({ preventScroll: true });
}

async function cancelLive(l) {
  const ok = await A.confirmDialog({ title: "取消這場直播", message: `「${l.title}」${when(l.starts_at)}。Discord 的公告會劃掉，並在下面通知研究員。`, confirmText: "取消直播", cancelText: "先不要", danger: true });
  if (!ok) return;
  try {
    data = await api(`/api/admin/lives?id=${l.id}`, { method: "DELETE" });
    if (editing?.id === l.id) resetForm();
    render();
    discordToast("已取消直播", data.announce);
  } catch (e) {
    fail(e);
  }
}

function discordToast(done, d) {
  if (d?.posted) A.toast(`${done}，已通知 Discord`);
  else A.toast(`${done}，但沒有發到 Discord：${d?.error || "未知原因"}`, "err");
}

$("#liveCancelEdit").addEventListener("click", resetForm);
$("#liveSave").addEventListener("click", async () => {
  const btn = $("#liveSave");
  const title = $("#liveTitle").value.trim();
  const at = $("#liveAt").value;
  if (!title) return A.toast("要填直播標題", "err");
  if (!at) return A.toast("要選直播時間", "err");
  const startsAt = new Date(at).toISOString();
  const body = { title, startsAt, note: $("#liveNote").value, link: $("#liveLink").value.trim() };
  A.setBusy(btn, true, editing ? "儲存中…" : "排定中…");
  try {
    if (editing) {
      data = await api("/api/admin/lives", { method: "PATCH", body: { id: editing.id, ...body } });
      const moved = Date.parse(editing.starts_at) !== Date.parse(startsAt);
      discordToast(moved ? "已改時間" : "已儲存", data.announce);
    } else {
      data = await api("/api/admin/lives", { method: "POST", body: { ...body, mention: $("#liveMention").checked } });
      discordToast(`已排定 ${when(startsAt)} 的直播`, data.announce);
    }
    A.setBusy(btn, false);
    resetForm();
    render();
  } catch (e) {
    A.setBusy(btn, false);
    fail(e);
  }
});
