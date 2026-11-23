// 研究員：列表、搜尋、觀看資格、停權、重設密碼
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { idLabel, tierName, TIERS, SITE_TIER, EXCHANGES } from "../shared/rules.js";
import { fail, loadingBox, segTabs, noteLine } from "./common.js";
import { state } from "./state.js";
import { canManageMembers } from "../shared/roles.js";

let members = [];
let memberQuery = "";
let memberTab = "active"; // active 正常 | banned 已停權（分開放，不混在一起）
let memberEx = "all"; // 依交易所分類：all 全部 | OKX、Bybit、BingX | free 贈送名額 | none 還沒填 UID
try { memberEx = localStorage.getItem("adminMemberEx") || "all"; } catch {}
if (!["all", "free", "none", ...EXCHANGES].includes(memberEx)) memberEx = "all"; // 撤掉的交易所（UM）存在瀏覽器裡的分類
// 這位研究員屬於哪幾類（填了好幾間交易所的，每一間都會出現）
const exGroupsOf = (m) => {
  if (m.free) return ["free"];
  const exs = EXCHANGES.filter((ex) => m.uids?.[ex]);
  return exs.length ? exs : ["none"];
};

// 其他頁改了研究員資料（例如交易量延長資格），下次進「研究員」重新抓
export function markMembersStale() {
  membersLoaded = false;
}

// 研究員
let membersLoaded = false;
// v1.36.0：匯出研究員名單（Email、收不收通知、交易所 UID、Discord），Excel 直接打得開（UTF-8 加 BOM）
const FAKE_EMAIL = "@users.ccc-community-site.pages.dev"; // 用 Discord 加入、Discord 沒給 Email 的人：網站帳號的代號，不是真的信箱
export function exportMembers(list = members) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Email", "收通知", "同意時間", "加入方式", ...EXCHANGES.map((ex) => `${ex} UID`), "Discord", "加入日期", "狀態"]];
  for (const m of list) {
    const email = String(m.email || "").endsWith(FAKE_EMAIL) ? "" : m.email;
    rows.push([email, m.notify ? "是" : "否", m.notify_consent_at ? m.notify_consent_at.slice(0, 10) : "", m.joined_via === "discord" ? "Discord" : "Email", ...EXCHANGES.map((ex) => m.uids?.[ex] || ""), m.discord || "", String(m.created_at || "").slice(0, 10), m.banned ? "停權" : "正常"]);
  }
  const csv = "\ufeff" + rows.map((r) => r.map(q).join(",")).join("\r\n");
  const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `CCC研究員名單-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
let exportWired = false;

export async function loadMembers(silent) {
  if (!exportWired && $("#memberExport")) {
    exportWired = true;
    $("#memberExport").addEventListener("click", async () => {
      if (!membersLoaded) await loadMembers(true);
      exportMembers();
    });
  }
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
  const hit = members.filter((m) => !memberQuery || `${m.email} ${m.invite_code || ""} ${Object.values(m.uids || {}).join(" ")} ${Object.values(m.account_names || {}).join(" ")} ${m.discord || ""} ${m.note || ""}`.toLowerCase().includes(memberQuery));
  // 依交易所分類（數字算目前搜尋到、這個分組裡的人）
  const inTab = (m) => (memberTab === "banned" ? m.banned : !m.banned);
  const exOptions = [
    { key: "all", label: "全部" },
    ...EXCHANGES.map((ex) => ({ key: ex, label: ex })),
    { key: "free", label: "贈送名額" },
    { key: "none", label: "還沒填 UID" },
  ].map((o) => ({ ...o, count: hit.filter((m) => inTab(m) && (o.key === "all" || exGroupsOf(m).includes(o.key))).length }))
    .filter((o) => o.key === "all" || o.key === memberEx || o.count || EXCHANGES.includes(o.key));
  const byEx = (m) => memberEx === "all" || exGroupsOf(m).includes(memberEx);
  const groups = { active: hit.filter((m) => !m.banned && byEx(m)), banned: hit.filter((m) => m.banned && byEx(m)) };
  // 停權的都恢復了，就回到「正常」
  if (memberTab === "banned" && !members.some((m) => m.banned)) memberTab = "active";
  const list = groups[memberTab];
  const exTabs = segTabs(exOptions, memberEx, (k) => { memberEx = k; try { localStorage.setItem("adminMemberEx", k); } catch {} renderMembers(); }, "依交易所分類");
  const box = $("#memberTableBox");
  if (!members.length) {
    box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有研究員" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "到「實驗室密碼」產生一組，把註冊連結傳出去。" })));
    return;
  }
  const tabs = members.some((m) => m.banned)
    ? segTabs([{ key: "active", label: "正常", count: groups.active.length }, { key: "banned", label: "已停權", count: groups.banned.length }], memberTab, (k) => { memberTab = k; renderMembers(); }, "研究員分組")
    : null;
  if (!list.length) {
    const other = memberTab === "active" ? groups.banned.length : groups.active.length;
    box.replaceChildren(...[tabs, exTabs, el("div", { class: "empty" }, el("p", { text: memberQuery ? `這一組沒有符合的研究員${other ? `（「${memberTab === "active" ? "已停權" : "正常"}」有 ${other} 位）` : ""}` : "這一組沒有研究員" }))].filter(Boolean));
    return;
  }
  box.replaceChildren(
    ...[tabs, exTabs].filter(Boolean),
    el("div", { class: "table-wrap" },
      el("table", { class: "table stack" },
        el("thead", null, el("tr", null, el("th", { text: "Email" }), el("th", { class: "hide-sm", text: "加入" }), el("th", { text: "最近登入" }), el("th", { class: "hide-sm", text: "看過" }), el("th", { text: "等級" }), el("th", { text: "狀態" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
        el("tbody", null,
          list.map((m) =>
            el("tr", null,
              el("td", null,
                el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: m.email }),
                el("div", { class: "small muted num", text: m.invite_code ? `實驗室密碼 ${m.invite_code}` : "" }, m.free ? el("span", { class: "pill brass", style: { marginLeft: "6px" }, text: "贈送名額" }) : null),
                m.discord ? el("div", { class: "small mem-dc", text: `Discord：${m.discord}` }) : null,
                noteLine(m.note, {
                  title: m.email, sub: m.email, placeholder: "例如：小明，朋友介紹", editable: canManageMembers(state.me?.adminRole),
                  onSave: async (t) => { await api("/api/admin/members", { method: "PATCH", body: { userId: m.user_id, action: "access", note: t } }); m.note = t || null; membersLoaded = false; },
                  onDone: () => renderMembers(),
                }),
                Object.keys(m.uids || {}).length ? el("div", { class: "mem-uids" }, ...Object.entries(m.uids).map(([ex, uid]) => el("span", { class: "mem-uid small num", title: `${ex} ${idLabel(ex)}` }, el("b", { text: ex }), uid + (m.account_names?.[ex] ? `・${m.account_names[ex]}` : "")))) : null),
              el("td", { class: "small num hide-sm", text: A.fmtDate(m.created_at) }),
              el("td", { class: "small", text: A.fmtRel(m.last_sign_in_at) }),
              el("td", { class: "small num hide-sm", text: `${m.watched_count} 支` }),
              el("td", null, accessCell(m)),
              el("td", null, m.banned ? el("span", { class: "pill warn" }, el("span", { class: "dot" }), "已停權") : el("span", { class: "pill good" }, el("span", { class: "dot" }), "正常")),
              // 協作管理員只能看，不能改資格、重設密碼、停權
              !canManageMembers(state.me?.adminRole) ? el("td", { class: "small muted", text: "只能檢視" }) : el("td", null, el("div", { class: "actions" },
                el("button", { class: "btn sm", type: "button", onclick: () => editAccess(m) }, icon("clock"), "等級"),
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

// ── 等級（三級制度，規則在 shared/rules.js 的 TIERS）──
const mdv = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
function accessCell(m) {
  if (m.free) return el("div", null, el("span", { class: "pill brass", text: "贈送（不分級）" }));
  const t = m.tier ?? 0;
  const pill = el("span", { class: "pill" + (t >= SITE_TIER ? " good" : t ? "" : " warn") }, t >= SITE_TIER ? el("span", { class: "dot" }) : null, tierName(t));
  const sub = t ? (m.tier_until ? `到 ${mdv(m.tier_until)}` : "不限") : "";
  const drop = t && m.cycle_tier < t ? `這一輪還沒保住` : "";
  return el("div", null, pill,
    sub || drop ? el("div", { class: "small muted", style: { marginTop: "4px" }, text: [sub, drop].filter(Boolean).join("・") }) : null,
    m.min_tier ? el("div", { class: "small", style: { marginTop: "2px", color: "var(--amber)" }, text: `手動：至少${tierName(m.min_tier)}${m.min_tier_until ? `到 ${mdv(m.min_tier_until)}` : "（不限）"}` }) : null);
}
// 手動給等級：「至少第幾級到哪天」；清掉就完全照交易量
export function editAccess(m, onDone) {
  let pick = m.min_tier || 0;
  const date = el("input", { class: "input", type: "date", value: m.min_tier_until || "" });
  const note = el("input", { class: "input", type: "text", maxlength: "200", placeholder: "例如：合作夥伴、先試用一個月", value: m.note || "" });
  const joined = m.created_at ? new Date(new Date(m.created_at).getTime() + 8 * 3600e3).toISOString().slice(0, 10) : "";
  const from = el("input", { class: "input", type: "date", value: m.volume_from || "", max: joined, "aria-label": "第一輪交易量從哪天算" });
  const chips = el("div", { class: "chips", role: "group", "aria-label": "至少第幾級" });
  const draw = () => chips.replaceChildren(
    el("button", { class: "chip", type: "button", "aria-pressed": String(!pick), text: "不手動給（照交易量）", onclick: () => { pick = 0; draw(); } }),
    ...TIERS.map((t) => el("button", { class: "chip", type: "button", "aria-pressed": String(pick === t.tier), text: tierName(t.tier), onclick: () => { pick = t.tier; draw(); } })));
  draw();
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: "儲存" });
  const mm = A.modal({
    title: "等級",
    body: el("div", null,
      el("p", { class: "small sub", style: { marginTop: "14px", wordBreak: "break-all" }, text: `${m.email}・現在是${tierName(m.tier ?? 0)}（照交易量和手動取高的）` }),
      el("div", { class: "field" }, el("span", { class: "label", text: "手動給：至少第幾級" }), chips),
      el("label", { class: "field" }, el("span", { class: "label", text: "到哪一天（含當天，空白＝不限）" }), date),
      el("p", { class: "hint", text: "交易量達到更高的等級時會照交易量；過了這天就完全照交易量。" }),
      el("label", { class: "field" }, el("span", { class: "label", text: "第一輪交易量從哪天算（空白＝加入網站那天）" }), from),
      el("p", { class: "hint", text: "社群裡本來就有、網站才剛註冊的人用：加入前的量也算進第一輪，最多往前 60 天。存好會馬上重新同步 Bybit、BingX。" }),
      el("label", { class: "field" }, el("span", { class: "label", text: "備註（只有管理員看得到）" }), note),
      err),
    actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => mm.close() }), save],
  });
  save.addEventListener("click", async () => {
    A.setBusy(save, true, "儲存中…");
    try {
      const body = { userId: m.user_id, action: "access", note: note.value, minTier: pick || null, minTierUntil: pick ? date.value || null : null };
      if ((from.value || null) !== (m.volume_from || null)) body.volumeFrom = from.value || null;
      await api("/api/admin/members", { method: "PATCH", body });
      membersLoaded = false;
      mm.close();
      A.toast(pick ? `已手動給${tierName(pick)}${date.value ? `到 ${date.value}` : "（不限）"}` : "已改成照交易量");
      if (onDone) onDone();
      else loadMembers();
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
    A.toast(ban ? "已停權，移到「已停權」" : "已恢復觀看權限，移回「正常」");
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
