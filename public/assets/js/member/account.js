// 觀看資格：到期提醒橫幅、右欄「本月交易量」
import { $, el, icons, fmtRel, api, modal, confirmDialog, setBusy, toast, cfg } from "../core/index.js";
import { state } from "./state.js";
import { DAY, md } from "./format.js";
import { AUTO_EXCHANGES, goalOf, fmtAmount, gapText, ruleText, addDays } from "../shared/rules.js";

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

// 資格提醒的第二句：這一輪還沒達標就講這一輪；已經達標了，提醒下一輪也要達標
function volHint(v) {
  if (!v) return "要繼續觀看請聯絡管理員更新資格。";
  const rule = ruleText(v.threshold, v.exchanges);
  return v.qualified
    ? `下一輪（${md(addDays(v.periodEnd, 1))} 起）也是${rule}，就能再看一輪。`
    : `這一輪（${md(v.periodStart)}～${md(v.periodEnd)}）${rule}，就能看到下一輪結束。`;
}

// 右欄：這一輪的交易量（每人從加入那天起算，一輪一個月；OKX、UM 管理員填；Bybit、BingX 綁定 UID 後每天自動更新）
export function renderVolPanel() {
  const box = $("#volPanel");
  const v = state.me?.volume;
  if (!v) return (box.hidden = true);
  box.hidden = false;
  box.replaceChildren(...[
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("div", null, el("h2", { text: "這一輪交易量" }), el("div", { class: "small muted num vol-range", text: `${md(v.periodStart)}～${md(v.periodEnd)}` })),
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
    el("p", { class: "small muted vol-note", text: (v.qualifiedAt ? `${md(v.qualifiedAt)} 達標，可以看到 ${md(v.qualifiedUntil)}。` : `從加入那天起算，每一輪一個月。${md(v.periodEnd)} 之前${ruleText(v.threshold, v.exchanges)}，就能看到下一輪結束；沒達標，${md(addDays(v.periodEnd, 1))} 起就不能看。`) + (v.updatedAt ? `上次更新：${fmtRel(v.updatedAt)}。` : `${v.exchanges.filter((ex) => !AUTO_EXCHANGES.includes(ex)).join("、")} 由管理員更新。`) }),
  ].filter(Boolean));
}

// ── Bybit、BingX：綁定 UID 後每天自動更新交易量 ──
const LINK_INFO = {
  OKX: { hint: "UID 在 OKX 的個人中心。填了之後，管理員才對得到你的交易量。", invite: "", lag: "" },
  UM: { hint: "UM（Ultima Markets）的 MT5 交易帳號。填了之後，管理員才對得到你的手數。", invite: "", lag: "", label: "MT5 帳號" },
  Bybit: { hint: "UID 在 Bybit 的個人頁面，請填主帳號的 UID。要用 CCC 的 Bybit 邀請連結註冊的帳號才能綁定。", invite: "BYBIT_INVITE_URL", lag: "Bybit 的數字隔天才會更新。" },
  BingX: { hint: "UID 在 BingX 的個人頁面。要用 CCC 的 BingX 邀請連結註冊的帳號才能綁定。", invite: "BINGX_INVITE_URL", lag: "" },
};
const uidLabel = (ex) => LINK_INFO[ex]?.label || "UID";

// 我的交易所 UID：Bybit、BingX 綁定後每天自動更新；OKX、UM 填了讓管理員對得到人
function linkRows() {
  const links = (state.me?.links || []).filter((l) => l.enabled);
  if (!links.length) return null;
  const none = !links.some((l) => l.uid);
  return el("div", { class: "bx-rows" + (none ? " empty" : "") },
    el("div", { class: "bx-title small", text: "我的交易所 UID" }),
    none ? el("p", { class: "bx-nudge small", text: "請填你用 CCC 邀請連結註冊的交易所 UID，管理員才對得到你的交易量。" }) : null,
    ...links.map((l) => el("div", { class: "bx-row" },
      el("span", { class: "bx-ex", text: l.exchange }),
      l.uid
        ? el("span", { class: "bx-text" }, el("b", { class: "num", text: l.uid }), l.auto ? el("span", { class: "muted", text: "・每天自動更新" }) : null)
        : el("span", { class: "bx-text muted", text: l.auto ? "綁定後每天自動更新" : `還沒填${uidLabel(l.exchange)}` }),
      l.uid
        ? el("button", { class: "btn sm ghost", type: "button", text: "解除", "aria-label": `解除 ${l.exchange}`, onclick: () => unbindLink(l.exchange, l.auto) })
        : el("button", { class: "btn sm", type: "button", text: l.auto ? "綁定" : "填寫", "aria-label": `${l.auto ? "綁定" : "填寫"} ${l.exchange}`, onclick: () => bindLink(l.exchange, l.auto) }))));
}

async function refreshMe() {
  try {
    state.me = await api("/api/me");
  } catch {}
  renderAccessBanner();
  renderVolPanel();
}

// 填交易所 UID 的視窗；ex 沒給就讓他先選交易所（登入後提醒補填用）
function bindLink(ex = null, auto = true, { title, intro } = {}) {
  const opts = (state.me?.links || []).filter((l) => l.enabled);
  let cur = ex || "";
  const isAuto = () => opts.find((l) => l.exchange === cur)?.auto ?? auto;
  const pick = ex ? null : el("select", { class: "select", "aria-label": "交易所" },
    el("option", { value: "", text: "選擇交易所" }), ...opts.map((l) => el("option", { value: l.exchange, text: l.exchange === "UM" ? "UM（Ultima Markets）" : l.exchange })));
  const input = el("input", { class: "input num", type: "text", inputmode: "numeric", autocomplete: "off", maxlength: "30", placeholder: "例如 12345678" });
  const label = el("span", { class: "label" });
  const hint = el("span", { class: "hint" });
  const inviteBox = el("p", { class: "small", style: { marginTop: "12px" }, hidden: true });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: ex && auto ? "綁定" : "儲存" });
  const refresh = () => {
    const info = LINK_INFO[cur] || { hint: "先選你用 CCC 邀請連結註冊的交易所。", invite: "" };
    label.textContent = cur ? `你的 ${cur} ${uidLabel(cur)}` : "UID";
    hint.textContent = info.hint;
    const invite = cfg[info.invite];
    inviteBox.hidden = !invite;
    inviteBox.replaceChildren(...(invite ? [`還沒有 ${cur} 帳號？`, el("a", { href: invite, target: "_blank", rel: "noopener", text: "用邀請連結註冊" })] : []));
  };
  pick?.addEventListener("change", () => { cur = pick.value; refresh(); });
  const m = modal({
    title: title || (isAuto() ? `綁定 ${cur}` : `填寫 ${cur} ${uidLabel(cur)}`),
    body: el("div", null,
      intro ? el("p", { class: "small", style: { marginTop: "12px" }, text: intro }) : null,
      pick ? el("label", { class: "field" }, el("span", { class: "label", text: "交易所" }), pick) : null,
      el("label", { class: "field" }, label, input, hint),
      inviteBox,
      err),
    actions: [el("button", { class: "btn", type: "button", text: ex ? "取消" : "之後再說", onclick: () => m.close() }), save],
  });
  refresh();
  const fail = (t) => { err.textContent = t; err.hidden = false; };
  input.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  save.addEventListener("click", async () => {
    if (!cur) return fail("請先選交易所");
    const uid = input.value.replace(/\s/g, "");
    if (!/^\d{5,20}$/.test(uid)) return fail("UID 是一串數字，請再確認一次");
    const a = isAuto();
    setBusy(save, true, a ? `向 ${cur} 確認中…` : "儲存中…");
    try {
      const r = await api("/api/exchange-link", { method: "POST", body: { exchange: cur, uid } });
      m.close();
      toast(!a ? `已記下你的 ${cur} ${uidLabel(cur)}` : r.synced ? `已綁定，這個月的 ${cur} 交易量已經更新。${LINK_INFO[cur]?.lag || ""}` : "已綁定，交易量稍後自動更新");
      refreshMe();
    } catch (e) {
      setBusy(save, false);
      fail(e.message);
    }
  });
}

// 登入後：一間交易所 UID 都還沒填，就請他補填（每次開網站提醒一次，有別的視窗開著就等它關掉）
export function promptUidIfMissing() {
  const me = state.me;
  if (!me?.links || me.isAdmin || me.links.some((l) => l.uid)) return;
  try {
    if (sessionStorage.getItem("uidPrompted")) return;
    sessionStorage.setItem("uidPrompted", "1");
  } catch {}
  let tries = 0;
  const open = () => {
    if (document.querySelector(".modal-back")) return ++tries < 120 && setTimeout(open, 1000);
    bindLink(null, false, { title: "填寫你的交易所 UID", intro: "請填你用 CCC 邀請連結註冊的交易所 UID，管理員才對得到你的交易量。用好幾間的話，之後可以在右邊「本月交易量」再加。" });
  };
  setTimeout(open, 800);
}

async function unbindLink(ex, auto = true) {
  const ok = await confirmDialog({
    title: auto ? `解除綁定 ${ex}` : `刪除 ${ex} ${uidLabel(ex)}`,
    message: auto ? `解除後就不會再自動更新 ${ex} 交易量，已經記下的數字會保留。確定要解除嗎？` : `刪除後管理員就對不到你的 ${ex} 交易量。確定要刪除嗎？`,
    confirmText: auto ? "解除綁定" : "刪除", danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/exchange-link?exchange=${encodeURIComponent(ex)}`, { method: "DELETE" });
    toast(auto ? "已解除綁定" : "已刪除");
    refreshMe();
  } catch (e) {
    toast(e.message, "err");
  }
}
