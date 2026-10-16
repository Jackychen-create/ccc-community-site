// 實驗室密碼：產生、複製加入連結、停用
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { fail, loadingBox } from "./common.js";

let invites = [];

// 實驗室密碼
let invitesLoaded = false;
export async function loadInvites(silent) {
  if (!invitesLoaded && !silent) $("#inviteTableBox").replaceChildren(loadingBox());
  try {
    const r = await api("/api/admin/invites");
    invites = r.invites || [];
    invitesLoaded = true;
    renderInvites();
  } catch (e) {
    if (!silent) fail(e);
  }
}

const inviteLink = (code) => `${location.origin}/?invite=${encodeURIComponent(code)}`;
const shareText = (code) => `CCC 交易實驗室 實驗室密碼：${code}\n加入連結：${inviteLink(code)}`;

function inviteState(i) {
  if (i.disabled) return ["已停用", "warn"];
  if (i.used_count >= i.max_uses) return ["已用完", ""];
  return ["可使用", "good"];
}

function renderInvites() {
  $("#cInvites").textContent = invites.filter((i) => inviteState(i)[1] === "good").length || "";
  const box = $("#inviteTableBox");
  if (!invites.length) {
    box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有實驗室密碼" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "在右邊產生第一組，把註冊連結傳給研究員。" })));
    return;
  }
  box.replaceChildren(
    el("div", { class: "table-wrap" },
      el("table", { class: "table stack" },
        el("thead", null, el("tr", null, el("th", { text: "實驗室密碼" }), el("th", { text: "使用狀況" }), el("th", { class: "hide-sm", text: "備註" }), el("th", { text: "狀態" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
        el("tbody", null,
          invites.map((i) => {
            const [label, kind] = inviteState(i);
            const pct = i.max_uses ? Math.min(100, (i.used_count / i.max_uses) * 100) : 0;
            return el("tr", null,
              el("td", null, el("span", { class: "code num", text: i.code }), el("div", { class: "small muted num", text: A.fmtDate(i.created_at) })),
              el("td", null, el("div", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: pct + "%" } })), el("span", { class: "small num", text: `${i.used_count} / ${i.max_uses}` }))),
              el("td", { class: "small sub hide-sm", text: i.note || "—" }),
              el("td", null, el("span", { class: "pill " + kind }, el("span", { class: "dot" }), label)),
              el("td", null, el("div", { class: "actions" },
                el("button", { class: "btn sm", type: "button", onclick: () => A.copyText(shareText(i.code)) }, icon("copy"), "複製連結"),
                el("button", { class: "btn sm ghost", type: "button", text: i.disabled ? "啟用" : "停用", onclick: () => toggleInvite(i) }),
                el("button", { class: "btn sm ghost danger", type: "button", text: "刪除", "aria-label": `刪除 ${i.code}`, onclick: () => deleteInvite(i) })
              ))
            );
          })
        )))
  );
}

async function deleteInvite(i) {
  const used = i.used_count ? `已經有 ${i.used_count} 位用這組加入，他們的帳號不受影響。` : "";
  const ok = await A.confirmDialog({ title: `刪除實驗室密碼 ${i.code}`, message: `刪除後這組就不能再註冊，也會從列表消失。${used}確定要刪除嗎？`, confirmText: "刪除", danger: true });
  if (!ok) return;
  try {
    await api(`/api/admin/invites?code=${encodeURIComponent(i.code)}`, { method: "DELETE" });
    invites = invites.filter((x) => x.code !== i.code);
    renderInvites();
    A.toast(`已刪除 ${i.code}`);
  } catch (e) {
    fail(e);
  }
}

async function toggleInvite(i) {
  try {
    await api("/api/admin/invites", { method: "PATCH", body: { code: i.code, disabled: !i.disabled } });
    i.disabled = !i.disabled;
    renderInvites();
    A.toast(i.disabled ? "已停用，這組實驗室密碼不能再註冊" : "已重新啟用");
  } catch (e) {
    fail(e);
  }
}

$("#invCreate").addEventListener("click", async () => {
  const btn = $("#invCreate");
  const max = Number($("#invMax").value);
  if (!Number.isInteger(max) || max < 1 || max > 1000) return A.toast("可使用次數需要介於 1 到 1000", "err");
  A.setBusy(btn, true, "產生中…");
  try {
    const r = await api("/api/admin/invites", { method: "POST", body: { max_uses: max, note: $("#invNote").value } });
    invites.unshift(r.invite);
    renderInvites();
    $("#invNote").value = "";
    const code = r.invite.code;
    $("#invResult").replaceChildren(
      el("div", { class: "new-code" },
        el("div", { class: "label", text: "新的實驗室密碼" }),
        el("div", { class: "big num", text: code }),
        el("div", { class: "small sub", style: { marginTop: "4px", wordBreak: "break-all" }, text: inviteLink(code) }),
        el("div", { style: { display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" } },
          el("button", { class: "btn sm", type: "button", onclick: () => A.copyText(shareText(code)) }, icon("copy"), "複製加入訊息"),
          el("button", { class: "btn sm ghost", type: "button", onclick: () => A.copyText(code) }, "只複製代碼")
        )
      )
    );
  } catch (e) {
    fail(e);
  } finally {
    A.setBusy(btn, false);
  }
});
