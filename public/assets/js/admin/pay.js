// 後台「付費」（v1.28.0，主要管理員）：收款模式、價格、付費制開始日期、舊研究員照舊到哪天、訂單、手動給
// 規則在 shared/rules.js 的「付費制」；伺服器在 server/admin/pay.js
import * as A from "../core/index.js";
const { el, $, api } = A;
import { fail, loadingBox } from "./common.js";
import { COURSE_PARTS } from "../shared/rules.js";

let data = null;
const money = (n) => `NT$${Number(n || 0).toLocaleString("en-US")}`;
const md = (d) => (d ? d.slice(5).replace("-", "/") : "");
const STATUS = { active: "自動扣款中", past_due: "扣款失敗（寬限中）", canceled: "不再續扣", ended: "已結束", paid: "已付款", refunded: "已退款", failed: "失敗" };
const MODE = { off: "關閉", test: "測試", live: "正式" };

export async function loadPay() {
  if (!data) $("#payBox").replaceChildren(loadingBox());
  try {
    data = await api("/api/admin/pay");
  } catch (e) {
    return fail(e);
  }
  render();
}

async function save(body, btn, msg) {
  A.setBusy(btn, true);
  try {
    data = await api("/api/admin/pay", { method: "PUT", body });
    A.toast(msg);
    render();
  } catch (e) {
    fail(e);
  } finally {
    A.setBusy(btn, false);
  }
}

function render() {
  const { cfg, stats, liveReady, on, today } = data;
  $("#paySub").textContent = on
    ? `付費制從 ${cfg.paidFrom} 開始：之後加入的研究員要付費，${cfg.legacyUntil ? `之前加入的照舊到 ${cfg.legacyUntil}` : "之前加入的一直照舊（不用付費）"}。`
    : cfg.paidFrom ? `${cfg.paidFrom} 起改成付費制，在那之前全部照舊。` : "還沒開始付費制：全部研究員照原本的規則（交易量）。";

  // ── 收款模式 ──
  const modeBtns = ["off", "test", "live"].map((m) => el("button", {
    type: "button", class: "vol-seg-btn", "aria-pressed": String(cfg.mode === m), text: MODE[m],
    onclick: async (e) => {
      const btn = e.currentTarget;
      if (m === cfg.mode) return;
      if (m === "live" && !(await A.confirmDialog({ title: "切到正式收款？", message: "之後研究員付款會真的扣錢。測試模式的訂單不再算數（測試買的集數、月費會失效）。", confirmText: "切到正式" }))) return;
      save({ mode: m }, btn, `收款模式：${MODE[m]}`);
    },
  }));
  const modeNote = cfg.mode === "off" ? "付款按鈕不會出現。" : cfg.mode === "test" ? "用綠界測試環境，不會真的扣錢（測試卡 4311-9522-2222-2222、安全碼 222）。" : "正式收款中。";

  // ── 價格、日期 ──
  const monthly = el("input", { class: "input num", type: "number", min: "10", step: "1", value: cfg.monthly, style: { width: "110px" }, "aria-label": "月費" });
  const part = el("input", { class: "input num", type: "number", min: "10", step: "1", value: cfg.part, style: { width: "110px" }, "aria-label": "單集價格" });
  const paidFrom = el("input", { class: "input", type: "date", value: cfg.paidFrom || "", style: { width: "170px" }, "aria-label": "付費制開始日期" });
  const legacyUntil = el("input", { class: "input", type: "date", value: cfg.legacyUntil || "", style: { width: "170px" }, "aria-label": "舊研究員照舊到哪天" });
  const saveBtn = el("button", { class: "btn primary", type: "button", text: "儲存", onclick: async (e) => {
    const btn = e.currentTarget;
    if (paidFrom.value && paidFrom.value !== (cfg.paidFrom || "") && cfg.mode === "off" && !(await A.confirmDialog({ title: "收款還關著", message: "付費制開始後，新加入的研究員要付費才看得到內容，但現在收款模式是「關閉」，他們會沒辦法付款。確定先存日期？", confirmText: "還是存" }))) return;
    save({ monthly: Number(monthly.value), part: Number(part.value), paidFrom: paidFrom.value, legacyUntil: legacyUntil.value }, btn, "已儲存");
  } });

  const row = (label, ...kids) => el("div", { class: "pay-row" }, el("span", { class: "pay-l", text: label }), el("div", { class: "pay-c" }, ...kids));
  const settings = el("div", { class: "panel pay-panel" },
    el("h2", { text: "設定" }),
    row("收款模式", el("div", { class: "vol-seg", role: "group", "aria-label": "收款模式" }, ...modeBtns), el("span", { class: "small muted", text: modeNote })),
    !liveReady ? row("", el("span", { class: "small muted", text: "正式收款前，要在 Cloudflare 的環境變數填三個值：ECPAY_MERCHANT_ID、ECPAY_HASH_KEY、ECPAY_HASH_IV（綠界廠商後台 → 系統開發管理 → 系統介接設定）。" })) : null,
    row("月費", monthly, el("span", { class: "small muted", text: "元／月，信用卡定期定額每月自動扣。改價格只影響之後新訂的人。" })),
    row("系統分享單集", part, el("span", { class: "small muted", text: `元／集，第 N 集＝CCC、X 的第 N 份（共 ${COURSE_PARTS} 集）。` })),
    row("付費制開始", paidFrom, el("span", { class: "small muted", text: "這天起加入的研究員要付費；空白＝不開始。開始後註冊不用實驗室密碼，Discord 報名按鈕也會改成帶去網站。" })),
    row("舊研究員照舊到", legacyUntil, el("span", { class: "small muted", text: "空白＝一直照舊（不用付費）；填日期的話，過了那天舊研究員也要付費。贈送名額一直照舊。" })),
    el("div", { class: "pay-actions" }, saveBtn));

  // ── 數字 ──
  const tile = (n, label) => el("div", { class: "pay-tile" }, el("b", { class: "num", text: n }), el("span", { class: "small muted", text: label }));
  const statsBox = el("div", { class: "pay-tiles" },
    tile(String(stats.subscribers), "訂閱月費的研究員（含已取消、還沒到期）"),
    tile(String(stats.renewing), "自動扣款中"),
    tile(String(stats.partsSold), "單集賣出"),
    tile(money(stats.monthIncome), `${today.slice(5, 7)} 月收到（${cfg.mode === "live" ? "正式" : "含測試"}）`),
    on ? tile(String(stats.newPaidMembers), "付費制之後加入的研究員") : null);

  // ── 手動給 ──
  const gEmail = el("input", { class: "input", type: "email", placeholder: "研究員的 Email", style: { flex: "1 1 220px" }, "aria-label": "研究員 Email" });
  const gKind = el("select", { class: "select", "aria-label": "給什麼" },
    el("option", { value: "monthly", text: "月費" }), ...Array.from({ length: COURSE_PARTS }, (_, i) => el("option", { value: `part:${i + 1}`, text: `系統分享第 ${i + 1} 集` })));
  const gMonths = el("input", { class: "input num", type: "number", min: "1", max: "24", value: "1", style: { width: "70px" }, "aria-label": "幾個月" });
  const gMonthsWrap = el("label", { class: "small", style: { display: "flex", alignItems: "center", gap: "6px" } }, gMonths, "個月");
  gKind.addEventListener("change", () => (gMonthsWrap.hidden = gKind.value !== "monthly"));
  const gNote = el("input", { class: "input", type: "text", maxLength: 200, placeholder: "備註（例如：直播抽獎）", style: { flex: "1 1 200px" }, "aria-label": "備註" });
  const gBtn = el("button", { class: "btn", type: "button", text: "給", onclick: async (e) => {
    const btn = e.currentTarget;
    const body = gKind.value === "monthly" ? { email: gEmail.value, kind: "monthly", months: Number(gMonths.value) } : { email: gEmail.value, kind: "part", part: Number(gKind.value.split(":")[1]) };
    A.setBusy(btn, true);
    try {
      data = await api("/api/admin/pay", { method: "POST", body: { ...body, note: gNote.value } });
      A.toast("已給");
      render();
    } catch (err) { fail(err); } finally { A.setBusy(btn, false); }
  } });
  const grant = el("div", { class: "panel pay-panel" },
    el("h2", { text: "手動給（不扣款）" }),
    el("p", { class: "small muted", text: "抽獎、補償、合作夥伴用。月費會接在他現在的到期日後面；給月費會順便給 Discord 研究員身分組（有連結 Discord 的話）。" }),
    el("div", { class: "pay-grant" }, gEmail, gKind, gMonthsWrap, gNote, gBtn));

  // ── 訂單 ──
  const act = (o, action, label, danger) => el("button", { class: "btn sm" + (danger ? " ghost" : ""), type: "button", text: label, onclick: async (e) => {
    const btn = e.currentTarget;
    const ok = await A.confirmDialog(action === "cancel"
      ? { title: "停掉自動扣款？", message: `${o.email} 的月費之後不再扣款，用到 ${o.paidUntil} 為止。`, confirmText: "停扣" }
      : { title: o.mode === "grant" ? "收回？" : "標記已退款、收回？", message: o.mode === "grant" ? `收回給 ${o.email} 的「${o.item}」。` : `只是在網站上收回「${o.item}」，退款要另外到綠界後台操作。`, confirmText: "收回", danger: true });
    if (!ok) return;
    A.setBusy(btn, true);
    try {
      data = await api("/api/admin/pay", { method: "PATCH", body: { tradeNo: o.tradeNo, action } });
      A.toast("已更新");
      render();
    } catch (err) { fail(err); A.setBusy(btn, false); }
  } });
  const orders = data.orders;
  const list = orders.length ? el("div", { class: "table-wrap" }, el("table", { class: "table stack pay-orders" },
    el("thead", null, el("tr", null, el("th", { text: "時間" }), el("th", { text: "研究員" }), el("th", { text: "項目" }), el("th", { text: "金額" }), el("th", { text: "狀態" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
    el("tbody", null, orders.map((o) => el("tr", { class: o.counted ? "" : "dim" },
      el("td", { class: "small num", text: `${md(o.createdAt.slice(0, 10))} ${new Date(o.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })}` }),
      el("td", { style: { wordBreak: "break-all" } }, el("div", { text: o.email }), o.note ? el("div", { class: "small muted", text: o.note }) : null),
      el("td", null, el("div", { text: o.item }), el("div", { class: "small muted num", text: o.tradeNo })),
      el("td", { class: "num", text: o.mode === "grant" ? "贈送" : money(o.amount) }),
      el("td", null,
        el("span", { class: "pill" + (["active", "paid"].includes(o.status) ? " good" : o.status === "past_due" ? " warn" : ""), text: STATUS[o.status] || o.status }),
        o.mode === "test" ? el("span", { class: "pill", text: "測試" }) : null,
        o.kind === "monthly" && o.end ? el("div", { class: "small muted", text: `到 ${o.end}${o.times ? `・扣了 ${o.times} 次` : ""}` }) : null,
        o.msg && o.status !== "paid" && o.status !== "active" ? el("div", { class: "small muted", text: o.msg }) : null),
      el("td", null, el("div", { class: "actions" },
        o.kind === "monthly" && ["active", "past_due"].includes(o.status) ? act(o, "cancel", "停扣") : null,
        !["active", "past_due", "ended", "refunded", "failed"].includes(o.status) ? act(o, "revoke", o.mode === "grant" ? "收回" : "已退款", true) : null)))))))
    : el("div", { class: "empty" }, el("h2", { text: "還沒有訂單" }), el("p", { class: "muted", text: "研究員付款、或你手動給了之後會列在這裡。" }));

  $("#payBox").replaceChildren(settings, statsBox, grant, el("h2", { class: "pay-h", text: "訂單" }), list);
}
