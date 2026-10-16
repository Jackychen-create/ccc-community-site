// 觀看資格：到期提醒橫幅、右欄「本月交易量」
import { $, el, icons, fmtRel, api, modal, confirmDialog, setBusy, toast, cfg } from "../core/index.js";
import { state } from "./state.js";
import { DAY, md } from "./format.js";
import { AUTO_EXCHANGES, goalOf, fmtAmount, gapText, ruleText } from "../shared/rules.js";

// 每月資格：到期前 7 天提醒
export function renderAccessBanner() {
  const me = state.me;
  const box = $("#accessBanner");
  const until = me?.accessUntil;
  if (!until) return (box.hidden = true);
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(until) - Date.parse(today)) / DAY);
  if (days > 7) return (box.hidden = true);
  box.hidden = false;
  box.replaceChildren(
    el("span", { html: icons.clock }),
    el("span", { text: days <= 0 ? `你的觀看資格今天（${until}）到期。` : `你的觀看資格到 ${until}，還有 ${days} 天。` }),
    el("span", { class: "muted", text: volHint(me.volume) })
  );
}

// 資格提醒的第二句：這個月達標還能延長，就講這個月；已經到月底了，就講下個月
function volHint(v) {
  if (!v) return "要繼續觀看請聯絡管理員更新資格。";
  const rule = ruleText(v.threshold, v.exchanges);
  return v.qualified ? `下個月${rule}，達標那天起可以再看一個月。` : `這個月${rule}，達標那天起可以再看一個月。`;
}

// 右欄：本月交易量（OKX 管理員在後台填；Bybit、BingX 綁定 UID 後每天自動更新；任一間達標就有資格）
export function renderVolPanel() {
  const box = $("#volPanel");
  const v = state.me?.volume;
  if (!v) return (box.hidden = true);
  box.hidden = false;
  const monthNo = Number(v.month.slice(5));
  box.replaceChildren(...[
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("h2", { text: `${monthNo} 月交易量` }),
      v.qualified ? el("span", { class: "pill good" }, el("span", { class: "dot" }), "已達標")
        : el("span", { class: "pill" }, v.amounts ? gapText(v.amounts, v.threshold, v.exchanges) : "尚未更新")),
    // 還沒填數字就不放空的進度條，標題旁的「尚未更新」已經說明了
    !v.amounts ? null : el("div", { class: "vol-rows" },
      ...v.exchanges.map((ex) => {
        const n = Number(v.amounts?.[ex] || 0);
        const goal = goalOf(ex, v.threshold);
        return el("div", { class: "vol-row" + (n >= goal ? " ok" : "") },
          el("span", { class: "vol-ex", text: ex }),
          el("span", { class: "num vol-n", text: v.amounts ? fmtAmount(ex, n) : "—" }),
          el("span", { class: "track" }, el("i", { style: { width: Math.min(100, (n / goal) * 100) + "%" } })));
      })),
    linkRows(),
    el("p", { class: "small muted vol-note", text: (v.qualifiedAt ? `${md(v.qualifiedAt)} 達標，可以看到 ${md(v.qualifiedUntil)}。` : `${ruleText(v.threshold, v.exchanges)}，達標那天起可以看一個月（例如 10/15 達標，看到 11/14）。`) + (v.updatedAt ? `上次更新：${fmtRel(v.updatedAt)}。` : `${v.exchanges.filter((ex) => !AUTO_EXCHANGES.includes(ex)).join("、")} 由管理員每月更新。`) }),
  ].filter(Boolean));
}

// ── Bybit、BingX：綁定 UID 後每天自動更新交易量 ──
const LINK_INFO = {
  Bybit: { hint: "UID 在 Bybit 的個人頁面，請填主帳號的 UID。要用 CCC 的 Bybit 邀請連結註冊的帳號才能綁定。", invite: "BYBIT_INVITE_URL", lag: "Bybit 的數字隔天才會更新。" },
  BingX: { hint: "UID 在 BingX 的個人頁面。要用 CCC 的 BingX 邀請連結註冊的帳號才能綁定。", invite: "BINGX_INVITE_URL", lag: "" },
};

function linkRows() {
  const links = (state.me?.links || []).filter((l) => l.enabled);
  if (!links.length) return null;
  return el("div", { class: "bx-rows" }, ...links.map((l) => l.uid
    ? el("div", { class: "bx-row" },
        el("span", { class: "bx-text" }, `${l.exchange} UID `, el("b", { class: "num", text: l.uid }), "・每天自動更新"),
        el("button", { class: "btn sm ghost", type: "button", text: "解除", "aria-label": `解除綁定 ${l.exchange}`, onclick: () => unbindLink(l.exchange) }))
    : el("div", { class: "bx-row" },
        el("span", { class: "bx-text", text: `${l.exchange} 綁定 UID 後，交易量每天自動更新。` }),
        el("button", { class: "btn sm", type: "button", text: `綁定 ${l.exchange}`, onclick: () => bindLink(l.exchange) }))));
}

async function refreshMe() {
  try {
    state.me = await api("/api/me");
  } catch {}
  renderAccessBanner();
  renderVolPanel();
}

function bindLink(ex) {
  const info = LINK_INFO[ex] || { hint: "", invite: "", lag: "" };
  const input = el("input", { class: "input num", type: "text", inputmode: "numeric", autocomplete: "off", maxlength: "15", placeholder: "例如 12345678" });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: "綁定" });
  const invite = cfg[info.invite];
  const m = modal({
    title: `綁定 ${ex}`,
    body: el("div", null,
      el("label", { class: "field" }, el("span", { class: "label", text: `你的 ${ex} UID` }), input,
        el("span", { class: "hint", text: info.hint })),
      invite ? el("p", { class: "small", style: { marginTop: "12px" } }, `還沒有 ${ex} 帳號？`, el("a", { href: invite, target: "_blank", rel: "noopener", text: "用邀請連結註冊" })) : null,
      err),
    actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), save],
  });
  const fail = (t) => { err.textContent = t; err.hidden = false; };
  input.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  save.addEventListener("click", async () => {
    const uid = input.value.replace(/\s/g, "");
    if (!/^\d{5,15}$/.test(uid)) return fail("UID 是一串數字，請再確認一次");
    setBusy(save, true, `向 ${ex} 確認中…`);
    try {
      const r = await api("/api/exchange-link", { method: "POST", body: { exchange: ex, uid } });
      m.close();
      toast(r.synced ? `已綁定，這個月的 ${ex} 交易量已經更新。${info.lag}` : "已綁定，交易量稍後自動更新");
      refreshMe();
    } catch (e) {
      setBusy(save, false);
      fail(e.message);
    }
  });
}

async function unbindLink(ex) {
  const ok = await confirmDialog({ title: `解除綁定 ${ex}`, message: `解除後就不會再自動更新 ${ex} 交易量，已經記下的數字會保留。確定要解除嗎？`, confirmText: "解除綁定", danger: true });
  if (!ok) return;
  try {
    await api(`/api/exchange-link?exchange=${encodeURIComponent(ex)}`, { method: "DELETE" });
    toast("已解除綁定");
    refreshMe();
  } catch (e) {
    toast(e.message, "err");
  }
}
