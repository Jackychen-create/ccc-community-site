// 研究員：列表、搜尋、觀看資格、停權、重設密碼
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { cycleEnd } from "../shared/rules.js";
import { fail, loadingBox } from "./common.js";

let members = [];
let memberQuery = "";

// 其他頁改了研究員資料（例如交易量延長資格），下次進「研究員」重新抓
export function markMembersStale() {
  membersLoaded = false;
}

// 研究員
let membersLoaded = false;
export async function loadMembers(silent) {
  if (!membersLoaded && !silent) $("#memberTableBox").replaceChildren(loadingBox());
  try {
    const r = await api("/api/admin/members");
    members = r.members || [];
    membersLoaded = true;
    renderMembers();
  } catch (e) {
    if (!silent) fail(e);
  }
}

$("#memberSearch").addEventListener("input", (e) => {
  memberQuery = e.target.value.trim().toLowerCase();
  renderMembers();
});

function renderMembers() {
  $("#cMembers").textContent = members.length || "";
  const active = members.filter((m) => !m.banned).length;
  $("#memberSub").textContent = members.length ? `共 ${members.length} 位，${active} 位可觀看` : "用實驗室密碼加入的研究員";
  const list = members.filter((m) => !memberQuery || `${m.email} ${m.invite_code || ""}`.toLowerCase().includes(memberQuery));
  const box = $("#memberTableBox");
  if (!members.length) {
    box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有研究員" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "到「實驗室密碼」產生一組，把註冊連結傳出去。" })));
    return;
  }
  if (!list.length) {
    box.replaceChildren(el("div", { class: "empty" }, el("p", { text: "找不到符合的研究員" })));
    return;
  }
  box.replaceChildren(
    el("div", { class: "table-wrap" },
      el("table", { class: "table stack" },
        el("thead", null, el("tr", null, el("th", { text: "Email" }), el("th", { class: "hide-sm", text: "加入" }), el("th", { text: "最近登入" }), el("th", { class: "hide-sm", text: "看過" }), el("th", { text: "資格" }), el("th", { text: "狀態" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
        el("tbody", null,
          list.map((m) =>
            el("tr", null,
              el("td", null, el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: m.email }), el("div", { class: "small muted num", text: m.invite_code ? `實驗室密碼 ${m.invite_code}` : "" })),
              el("td", { class: "small num hide-sm", text: A.fmtDate(m.created_at) }),
              el("td", { class: "small", text: A.fmtRel(m.last_sign_in_at) }),
              el("td", { class: "small num hide-sm", text: `${m.watched_count} 支` }),
              el("td", null, accessCell(m)),
              el("td", null, m.banned ? el("span", { class: "pill warn" }, el("span", { class: "dot" }), "已停權") : el("span", { class: "pill good" }, el("span", { class: "dot" }), "正常")),
              el("td", null, el("div", { class: "actions" },
                el("button", { class: "btn sm", type: "button", onclick: () => editAccess(m) }, icon("clock"), "資格"),
                el("button", { class: "btn sm", type: "button", onclick: () => resetPassword(m) }, icon("key"), "重設密碼"),
                m.banned
                  ? el("button", { class: "btn sm", type: "button", text: "恢復", onclick: () => setBan(m, false) })
                  : el("button", { class: "btn sm danger", type: "button", text: "停權", onclick: () => setBan(m, true) })
              ))
            )
          )
        )))
  );
}

// ── 每月資格（看單月交易量決定）──
function twToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function monthEnd(offset = 0) {
  const [y, mo] = twToday().split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + offset + 1, 0));
  return d.toISOString().slice(0, 10);
}
function accessCell(m) {
  const today = twToday();
  const until = m.access_until;
  const label = !until
    ? el("span", { class: "pill dash", text: "不限" })
    : until < today
      ? el("span", { class: "pill warn" }, el("span", { class: "dot" }), `已過期 ${until.slice(5).replace("-", "/")}`)
      : el("span", { class: "pill" + ((Date.parse(until) - Date.parse(today)) / 86400000 <= 7 ? " brass" : "") }, `到 ${until.slice(5).replace("-", "/")}`);
  return el("div", null, label, m.note ? el("div", { class: "small muted", style: { marginTop: "4px", maxWidth: "22ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: m.note, text: m.note }) : null);
}
export function editAccess(m, onDone) {
  const date = el("input", { class: "input", type: "date", value: m.access_until || "" });
  const note = el("input", { class: "input", type: "text", maxlength: "200", placeholder: "例如：先試用一個月", value: m.note || "" });
  const quick = (label, val) => el("button", { class: "chip", type: "button", text: label, onclick: () => (date.value = val) });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: "儲存" });
  const mm = A.modal({
    title: "觀看資格",
    body: el("div", null,
      el("p", { class: "small sub", style: { marginTop: "14px", wordBreak: "break-all" }, text: m.email }),
      el("label", { class: "field" }, el("span", { class: "label", text: "可以看到哪一天（含當天）" }), date),
      el("div", { class: "chips", style: { marginTop: "10px" } }, quick(`今天起一個月（${cycleEnd(twToday()).slice(5).replace("-", "/")}）`, cycleEnd(twToday())), quick("這個月底", monthEnd(0)), quick("不限", "")),
      el("p", { class: "hint", text: "過了這天研究員就不能看，到期前 7 天會在畫面上提醒他。留空白＝不限。" }),
      el("label", { class: "field" }, el("span", { class: "label", text: "備註（只有管理員看得到）" }), note),
      err),
    actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => mm.close() }), save],
  });
  save.addEventListener("click", async () => {
    A.setBusy(save, true, "儲存中…");
    try {
      const accessUntil = date.value || null;
      await api("/api/admin/members", { method: "PATCH", body: { userId: m.user_id, action: "access", accessUntil, note: note.value } });
      m.access_until = accessUntil;
      m.note = note.value.trim() || null;
      membersLoaded = false;
      if (onDone) onDone();
      else renderMembers();
      mm.close();
      A.toast(accessUntil ? `資格更新到 ${accessUntil}` : "已改成不限");
    } catch (e) {
      A.setBusy(save, false);
      err.textContent = e.message;
      err.hidden = false;
    }
  });
}

async function setBan(m, ban) {
  if (ban) {
    const ok = await A.confirmDialog({
      title: "停權研究員",
      message: `確定要停權 ${m.email} 嗎？對方會立刻無法觀看影片，之後可以再恢復。`,
      confirmText: "停權",
      danger: true,
    });
    if (!ok) return;
  }
  try {
    await api("/api/admin/members", { method: "PATCH", body: { userId: m.user_id, action: ban ? "ban" : "unban" } });
    m.banned = ban;
    renderMembers();
    A.toast(ban ? "已停權" : "已恢復觀看權限");
  } catch (e) {
    fail(e);
  }
}

async function resetPassword(m) {
  const ok = await A.confirmDialog({
    title: "重設密碼",
    message: `要幫 ${m.email} 產生一組新密碼嗎？舊密碼會立刻失效。`,
    confirmText: "產生新密碼",
  });
  if (!ok) return;
  try {
    const r = await api("/api/admin/members", { method: "PATCH", body: { userId: m.user_id, action: "reset" } });
    const msg = `你的交易實驗室新密碼：${r.password}\n登入後可以在右上角選單自行修改。`;
    const mm = A.modal({
      title: "新密碼",
      body: el("div", null,
        el("p", { class: "sub", style: { marginTop: "14px" }, text: `請私訊給 ${m.email}。這組密碼只會顯示這一次。` }),
        el("div", { class: "new-code" }, el("div", { class: "big num", style: { letterSpacing: ".04em" }, text: r.password }))
      ),
      actions: [
        el("button", { class: "btn", type: "button", onclick: () => A.copyText(r.password) }, icon("copy"), "只複製密碼"),
        el("button", { class: "btn primary", type: "button", onclick: () => { A.copyText(msg); mm.close(); } }, "複製訊息並關閉"),
      ],
    });
  } catch (e) {
    fail(e);
  }
}
