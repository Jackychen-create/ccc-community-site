// 三級制度：等級提醒橫幅、右欄「我的等級」（這一輪交易量）、升級恭喜（規則在 shared/rules.js 的 TIERS）
import { $, el, icons, fmtRel, api, modal, confirmDialog, setBusy, toast, cfg } from "../core/index.js";
import { state } from "./state.js";
import { DAY, md } from "./format.js";
import { AUTO_EXCHANGES, TIERS, MAX_TIER, SITE_TIER, tierName, tierInfo, tierRuleText, goalFor, fmtAmount, gapTo, progressTo, isLots, addDays, TRADFI_NOTE, cleanExId, exIdOk, exIdError, needsName, cleanAccountName, accountNameOk, ACCOUNT_NAME_ERROR } from "../shared/rules.js";

const twToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const withUnit = (ex, n) => `${fmtAmount(ex, n)}${isLots(ex) ? "" : " USDT"}`;
// 右欄進度條要比哪一級：這一輪還沒保住現在的等級 → 比現在的等級；保住了 → 比下一級
export const targetTier = (v) => (v.cycleTier < v.tier ? v.tier : Math.min(MAX_TIER, v.cycleTier + 1));

// 上方提醒：沒有等級；或這一輪還沒保住現在的等級、7 天內就會降級
export function renderAccessBanner() {
  const v = state.me?.volume;
  const box = $("#accessBanner");
  if (!v || state.me.free) return (box.hidden = true);
  if (v.tier === 0) {
    box.hidden = false;
    return box.replaceChildren(el("span", { html: icons.clock }),
      el("span", { text: "你目前沒有等級。" }),
      el("span", { class: "muted", text: `這一輪（${md(v.periodStart)}～${md(v.periodEnd)}）${tierRuleText(1)}，就能恢復研究員身分和會員直播；${tierRuleText(SITE_TIER)} 解鎖網站。` }));
  }
  const days = v.tierUntil ? Math.round((Date.parse(v.tierUntil) - Date.parse(twToday())) / DAY) : Infinity;
  if (v.cycleTier >= v.tier || days > 7) return (box.hidden = true);
  box.hidden = false;
  box.replaceChildren(el("span", { html: icons.clock }),
    el("span", { text: days <= 0 ? `你的${tierName(v.tier)}今天（${md(v.tierUntil)}）到期。` : `你的${tierName(v.tier)}到 ${md(v.tierUntil)}，還有 ${days} 天。` }),
    el("span", { class: "muted", text: `這一輪${gapTo(v.amounts || {}, v.tier, v.exchanges)}就能保住；沒達到的話，${md(addDays(v.tierUntil, 1))} 起是${tierName(v.cycleTier)}。` }));
}

// 右欄：我的等級＋這一輪的交易量（每人從加入那天起算，一輪一個月；OKX、UM 管理員填；Bybit、BingX 綁定 UID 後每天自動更新）
export function renderVolPanel() {
  const box = $("#volPanel");
  const v = state.me?.volume;
  if (!v) return (box.hidden = true);
  box.hidden = false;
  // 贈送名額：一直是第二級；交易所 UID 想填再填
  if (state.me.free) {
    return box.replaceChildren(...[
      el("div", { class: "panel-head", style: { padding: "14px 18px" } },
        el("div", null, el("h2", { text: "我的等級" })),
        el("span", { class: "pill good" }, el("span", { class: "dot" }), `贈送名額・${tierName(Math.max(v.tier, SITE_TIER))}`)),
      el("p", { class: "small muted vol-note", text: "你是贈送名額，不用綁交易所，也沒有交易量條件，網站不限期。" }),
      state.me.links?.some((l) => l.uid) ? linkRows() : null,
    ].filter(Boolean));
  }
  const target = targetTier(v);
  const keep = v.cycleTier < v.tier; // 這一輪還沒保住現在的等級
  const status = v.tier === 0
    ? `你目前沒有等級。這一輪${tierRuleText(1)}，就是第一級。`
    : `你現在是${tierName(v.tier)}，${v.tierUntil ? `至少到 ${md(v.tierUntil)}` : "不限期"}。` + (keep
      ? `這一輪還沒保住：${gapTo(v.amounts || {}, v.tier, v.exchanges)}（${md(v.periodEnd)} 前）。`
      : v.cycleTier >= MAX_TIER ? "已經是最高級。" : `再升一級：${tierName(target)}${gapTo(v.amounts || {}, target, v.exchanges)}（${tierInfo(target).perks.join("、")}）。`);
  box.replaceChildren(...[
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("div", null, el("h2", { text: "我的等級" }), el("div", { class: "small muted num vol-range", text: `這一輪 ${md(v.periodStart)}～${md(v.periodEnd)}` })),
      el("span", { class: "pill" + (v.tier >= SITE_TIER ? " good" : "") }, v.tier >= SITE_TIER ? el("span", { class: "dot" }) : null, tierName(v.tier))),
    tierLadder(v),
    el("p", { class: "small tier-status", text: status }),
    // 還沒填數字就不放空的進度條
    !v.amounts ? null : el("div", { class: "vol-rows" },
      ...v.exchanges.map((ex) => {
        const n = Number(v.amounts?.[ex] || 0);
        const goal = goalFor(ex, target);
        return el("div", { class: "vol-row" + (n >= goal ? " ok" : "") },
          el("span", { class: "vol-ex", text: ex }),
          el("span", { class: "num vol-n", text: `${fmtAmount(ex, n)}／${fmtAmount(ex, goal)}` }),
          el("span", { class: "track" }, el("i", { style: { width: Math.min(100, (n / goal) * 100) + "%" } })));
      })),
    linkRows(),
    el("p", { class: "small muted vol-note", text: "從加入那天起算，每一輪一個月；這一輪達到第幾級，下一輪就是第幾級（任一間交易所達到就算）。" + (v.updatedAt ? `上次更新：${fmtRel(v.updatedAt)}。` : `${v.exchanges.filter((ex) => !AUTO_EXCHANGES.includes(ex)).join("、")} 由管理員更新。`) + (v.exchanges.includes("Bybit") ? TRADFI_NOTE : "") }),
  ].filter(Boolean));
}

// ── 三級的階梯：這一輪達到哪一級就亮到哪一級，下面寫門檻 ──
function tierLadder(v) {
  return el("ol", { class: "ms-strip tiers", "aria-label": `這一輪達到：${tierName(v.cycleTier)}` },
    ...TIERS.map((t) => el("li", { class: "ms-step" + (v.cycleTier >= t.tier ? " on" : "") + (v.cycleTier === t.tier ? " now" : ""), title: t.perks.join("、") },
      el("span", { class: "ms-dot", "aria-hidden": "true" }),
      el("span", { class: "ms-label", text: tierName(t.tier) }),
      el("span", { class: "ms-goal num", text: `${fmtAmount("", t.usdt)}／${t.lots} 手` }))));
}

// 這一輪升級了：首頁跳一次恭喜（Discord 也會私訊一份）
export function celebrateMilestone() {
  const v = state.me?.volume;
  const ms = v?.milestone;
  if (!ms || state.me.isAdmin) return;
  let tries = 0;
  const open = () => {
    if (document.querySelector(".modal-back")) return ++tries < 120 && setTimeout(open, 1000);
    const lvl = ms.level;
    const b = v.amounts ? progressTo(v.amounts, lvl, v.exchanges) : null;
    const ok = el("button", { class: "btn primary", type: "button", text: lvl >= SITE_TIER ? "太好了" : "繼續衝" });
    const mm = modal({
      title: `${{ 1: "✅", 2: "🎉", 3: "🏆" }[lvl] || "🎉"} 升上${tierName(lvl)}！`,
      body: el("div", { class: "ms-pop" },
        el("div", { class: "ms-big", text: tierName(lvl) }),
        b ? el("p", { class: "small sub", text: `這一輪 ${b.ex}：${withUnit(b.ex, b.n)}` }) : null,
        el("ul", { class: "tier-perks" }, ...TIERS.filter((t) => t.tier <= lvl).flatMap((t) => t.perks).map((x) => el("li", { text: x }))),
        el("p", { text: `至少到 ${md(v.nextEnd)}。` + (lvl < MAX_TIER ? `再往上：${tierName(lvl + 1)}${gapTo(v.amounts || {}, lvl + 1, v.exchanges)}（${tierInfo(lvl + 1).perks.join("、")}）。` : "到右邊「一對一交流」選這個月的講師（每位最多 5 位，額滿照交易量排）。") }),
        lvl >= SITE_TIER && (state.me.tier ?? 0) >= SITE_TIER ? el("p", { class: "small sub", text: "直播留檔、教學課程都已經打開，重新整理就看得到。" }) : null),
      actions: [ok],
      onClose: () => api("/api/me", { method: "PATCH", body: { milestoneSeen: true } }).catch(() => {}),
    });
    ok.addEventListener("click", () => mm.close());
    v.milestone = null;
  };
  setTimeout(open, 600);
}

// ── Bybit、BingX：綁定 UID 後每天自動更新交易量 ──
const LINK_INFO = {
  OKX: { hint: "UID 在 OKX 的個人中心。填了之後，管理員才對得到你的交易量。", invite: "", lag: "" },
  UM: { hint: "UM（Ultima Markets）的 MT5 帳號：UM App 最上面「Live」旁邊那串數字（例如 35904693），再加上你在 UM 開戶的英文姓名。填了之後，管理員才對得到你的手數。", invite: "", lag: "", label: "MT5 帳號" },
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
        ? el("span", { class: "bx-text" }, el("b", { class: "num", text: l.uid }), l.auto ? el("span", { class: "muted", text: "・每天自動更新" }) : null,
          l.needsName ? el("span", { class: "muted bx-mail", text: l.accountName ? `・${l.accountName}` : "・請重新填 MT5 帳號和姓名" }) : null)
        : el("span", { class: "bx-text muted", text: l.auto ? "綁定後每天自動更新" : `還沒填${uidLabel(l.exchange)}` }),
      l.uid && l.needsName && !l.accountName
        ? el("button", { class: "btn sm", type: "button", text: "重新填寫", "aria-label": `重新填寫 ${l.exchange}`, onclick: () => bindLink(l.exchange, l.auto, UM_REDO) })
        : l.uid
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
function bindLink(ex = null, auto = true, { title, intro, uid: prefill = "" } = {}) {
  const opts = (state.me?.links || []).filter((l) => l.enabled);
  let cur = ex || "";
  const isAuto = () => opts.find((l) => l.exchange === cur)?.auto ?? auto;
  const pick = ex ? null : el("select", { class: "select", "aria-label": "交易所" },
    el("option", { value: "", text: "選擇交易所" }), ...opts.map((l) => el("option", { value: l.exchange, text: l.exchange === "UM" ? "UM（Ultima Markets）" : l.exchange })));
  const input = el("input", { class: "input num", type: "text", inputmode: "numeric", autocomplete: "off", maxlength: "30", placeholder: "例如 12345678" });
  input.value = prefill;
  const nameInput = el("input", { class: "input", type: "text", autocomplete: "off", maxlength: "60", placeholder: "例如 WANG XIAO MING" });
  const nameRow = el("label", { class: "field", hidden: true }, el("span", { class: "label", text: "你在 UM 開戶的英文姓名（跟護照一樣）" }), nameInput);
  const label = el("span", { class: "label" });
  const hint = el("span", { class: "hint" });
  const inviteBox = el("p", { class: "small", style: { marginTop: "12px" }, hidden: true });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: ex && auto ? "綁定" : "儲存" });
  const refresh = () => {
    const info = LINK_INFO[cur] || { hint: "先選你用 CCC 邀請連結註冊的交易所。", invite: "" };
    // UM 另外填開戶的英文姓名
    nameRow.hidden = !needsName(cur);
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
      nameRow,
      inviteBox,
      err),
    actions: [el("button", { class: "btn", type: "button", text: ex ? "取消" : "之後再說", onclick: () => m.close() }), save],
  });
  refresh();
  const fail = (t) => { err.textContent = t; err.hidden = false; };
  input.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  save.addEventListener("click", async () => {
    if (!cur) return fail("請先選交易所");
    const uid = cleanExId(cur, input.value);
    if (!exIdOk(cur, uid)) return fail(exIdError(cur));
    const accountName = needsName(cur) ? cleanAccountName(nameInput.value) : undefined;
    if (needsName(cur) && !accountNameOk(accountName)) return fail(ACCOUNT_NAME_ERROR);
    const a = isAuto();
    setBusy(save, true, a ? `向 ${cur} 確認中…` : "儲存中…");
    try {
      const r = await api("/api/exchange-link", { method: "POST", body: { exchange: cur, uid, accountName } });
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
// UM 改成填 MT5 帳號＋開戶英文姓名（2026-10-17）之前填的 UM 號碼可能不是 MT5 帳號，沒有姓名的請他重填
const umNeedsRedo = (me) => (me?.links || []).some((l) => l.exchange === "UM" && l.uid && l.needsName && !l.accountName);
const UM_REDO = { title: "請重新填 UM 的 MT5 帳號", intro: "UM 改成填 MT5 帳號（UM App 最上面「Live」旁邊那串數字）和你在 UM 開戶的英文姓名，管理員才對得到你的手數。請重新填一次。" };

export function promptUidIfMissing() {
  const me = state.me;
  if (!me?.links || me.isAdmin || me.free) return; // 贈送名額不用填
  const missing = !me.links.some((l) => l.uid);
  const redoUm = !missing && umNeedsRedo(me);
  if (!missing && !redoUm) return;
  try {
    if (sessionStorage.getItem("uidPrompted")) return;
    sessionStorage.setItem("uidPrompted", "1");
  } catch {}
  let tries = 0;
  const open = () => {
    if (document.querySelector(".modal-back")) return ++tries < 120 && setTimeout(open, 1000);
    if (redoUm) return bindLink("UM", false, UM_REDO);
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
