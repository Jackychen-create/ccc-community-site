// 付費制（v1.28.0）：#/plans「我的方案」——月費會員、系統分享單集購買、付款紀錄
// 只有付費制的研究員看得到（照舊的研究員打開 #/plans 會回首頁）；規則在 shared/rules.js 的「付費制」
import { $, el, api, toast, setBusy, confirmDialog } from "../core/index.js";
import { state, SITE } from "./state.js";
import { showPage } from "./views.js";
import { md } from "./format.js";
import { COURSE_HOSTS } from "../shared/rules.js";

export const isPaidMember = () => !!state.me?.volume?.paid && !state.me.isAdmin;
const money = (n) => `NT$${Number(n).toLocaleString("en-US")}`;

let info = null;
export async function loadPlans() {
  info = await api("/api/pay");
  return info;
}

// 送到綠界：伺服器給表單欄位，這裡做一個看不見的表單送出去（整頁換到綠界的付款頁）
export async function checkout(body, btn) {
  setBusy(btn, true, "前往付款…");
  try {
    const r = await api("/api/pay", { method: "POST", body });
    const form = el("form", { method: "POST", action: r.action, hidden: true });
    for (const [k, v] of Object.entries(r.fields)) form.append(el("input", { type: "hidden", name: k, value: v }));
    document.body.append(form);
    form.submit();
  } catch (e) {
    setBusy(btn, false);
    toast(e.message || "沒辦法開始付款，請稍後再試", "err");
  }
}

async function cancelSub(btn) {
  const until = info?.sub?.until;
  const ok = await confirmDialog({
    title: "取消自動扣款？",
    message: `之後不會再扣款。已經付的會員照常用到 ${until ? md(until) : "這一期結束"}，到期後直播留檔會關起來，Discord 研究員身分組也會收回；買過的系統分享一直都看得到。`,
    confirmText: "取消自動扣款",
    cancelText: "先不要",
    danger: true,
  });
  if (!ok) return;
  setBusy(btn, true);
  try {
    const r = await api("/api/pay", { method: "DELETE" });
    toast(`已取消，會員可以用到 ${md(r.until)}`);
    await refresh();
  } catch (e) {
    toast(e.message, "err");
    setBusy(btn, false);
  }
}

async function refresh() {
  state.me = await api("/api/me").catch(() => state.me);
  await loadPlans().catch(() => null);
  if (location.hash.startsWith("#/plans")) render();
  const { renderVolPanel } = await import("./account.js");
  renderVolPanel();
}

export async function openPlans() {
  if (!isPaidMember()) return (location.hash = "#/");
  showPage("listView", { nav: null, search: false, title: `我的方案｜${SITE}` });
  for (const id of ["continueList", "coursePanel", "statsPanel", "recentNotes"]) $("#" + id).hidden = true;
  document.querySelector("#listView .keys-panel").hidden = true;
  $("#chips").replaceChildren();
  $("#countText").textContent = "";
  document.querySelector("#listView .vhead").hidden = true;
  document.querySelector("#listView h1").firstChild.textContent = "我的方案 ";
  // 剛從綠界回來：通知可能晚幾秒才到，等一下再抓一次
  const back = /[?&]paid=1/.test(location.hash);
  if (back) history.replaceState(null, "", location.pathname + location.search + "#/plans");
  if (!info) $("#grid").replaceChildren(el("div", { class: "lock-page" }, el("p", { class: "muted", text: "讀取中…" })));
  try {
    // 系統分享每一集的標題（方案頁列出來）
    if (!state.course) await import("./course.js").then((m) => m.loadCourse()).catch(() => null);
    $("#coursePanel").hidden = true;
    await loadPlans();
  } catch (e) {
    return $("#grid").replaceChildren(el("div", { class: "lock-page" }, el("p", { class: "muted", text: e.message || "讀不到方案，請稍後再試" })));
  }
  render({ back });
  if (back) setTimeout(refresh, 4000);
}

function render({ back = false } = {}) {
  const p = info;
  const sub = p.sub || {};
  const owned = new Set(p.owned || []);
  const course = state.course?.slots || [];
  const titleOf = (host, part) => course.find((s) => s.host === host && s.part === part)?.video?.title || "";
  const discord = state.me.discord;

  const subLine = sub.on
    ? sub.renewing ? `月費會員，到 ${md(sub.until)}，之後每個月自動扣 ${money(p.monthly)}。` : sub.status === "past_due" ? `這個月扣款沒有成功，會員先保留到 ${md(sub.until)}。請確認信用卡，或取消後重新訂閱。` : `已取消自動扣款，會員可以用到 ${md(sub.until)}。`
    : "還沒有月費會員。";

  const subBtn = el("button", { class: "btn primary lg", type: "button", text: sub.on && !sub.renewing && sub.status !== "past_due" ? "重新訂閱（到期後接著扣）" : `訂閱月費 ${money(p.monthly)}／月`, onclick: (e) => checkout({ item: "monthly" }, e.currentTarget) });
  const canSubscribe = p.open && !(sub.on && (sub.renewing || sub.status === "past_due"));

  $("#grid").replaceChildren(el("div", { class: "lock-page plans" },
    back ? el("div", { class: "plan-note good", text: "付款完成的話，幾秒內就會打開。沒看到變化，重新整理一次。" }) : null,
    p.test ? el("div", { class: "plan-note", text: "測試模式：用綠界的測試信用卡 4311-9522-2222-2222（有效期限填未來的月份、安全碼 222），不會真的扣錢。" }) : null,
    !p.open ? el("div", { class: "plan-note", text: "付款還沒開放，開放後會在 Discord 公告。" }) : null,
    el("div", { class: "lock-hero" },
      el("span", { class: "pill" + (sub.on ? " good" : "") }, sub.on ? "月費會員" : "還沒訂閱"),
      el("h2", { text: "選你要的方案" }),
      el("p", { class: "sub", text: "月費看直播和留檔；系統分享一集一集買，買了永久看。" })),
    el("ol", { class: "tier-table plan-table" },
      el("li", { class: "tier-card" + (sub.on ? " me" : "") },
        el("div", { class: "tier-head" }, el("b", { text: "月費會員" }), sub.on ? el("span", { class: "pill good", text: "訂閱中" }) : null),
        el("div", { class: "plan-price" }, el("span", { class: "num", text: money(p.monthly) }), el("small", { text: "／月，信用卡每月自動扣" })),
        el("ul", null,
          el("li", { text: "會員直播（Discord 研究員身分組）" }),
          el("li", { text: "全部直播留檔，含直播精華和章節" }),
          el("li", { text: "研究員專區：筆記、提問、每日回顧" })),
        el("p", { class: "small", text: subLine }),
        canSubscribe ? subBtn : null,
        sub.on && (sub.renewing || sub.status === "past_due") ? el("button", { class: "btn sm ghost", type: "button", text: "取消自動扣款", onclick: (e) => cancelSub(e.currentTarget) }) : null,
        sub.on && discord && !discord.linked ? el("p", { class: "small plan-dc" }, "還沒連結 Discord：到 Discord 按「🔗 連結網站帳號」，研究員身分組會自動給你，才看得到會員直播。") : null),
      el("li", { class: "tier-card plan-parts" },
        el("div", { class: "tier-head" }, el("b", { text: "系統分享・單集" }), owned.size ? el("span", { class: "pill", text: `已買 ${owned.size}／${p.parts}` }) : null),
        el("div", { class: "plan-price" }, el("span", { class: "num", text: money(p.part) }), el("small", { text: "／集，一次付清、永久看" })),
        el("p", { class: "small muted", text: `每一集是 ${COURSE_HOSTS.join("、")} 的同一份一起開，不用等每週解鎖。` }),
        el("ol", { class: "part-list" },
          ...Array.from({ length: p.parts }, (_, i) => i + 1).map((n) => {
            const titles = COURSE_HOSTS.map((h) => titleOf(h, n)).filter(Boolean);
            return el("li", { class: owned.has(n) ? "own" : "" },
              el("b", { class: "num", text: `第 ${n} 集` }),
              el("span", { class: "small muted part-t", text: titles.length ? titles.join("／") : "CCC、X 各一份" }),
              owned.has(n) ? el("a", { class: "btn sm", href: "#/course", text: "去看" })
                : p.open ? el("button", { class: "btn sm", type: "button", text: `購買 ${money(p.part)}`, onclick: (e) => checkout({ item: "part", part: n }, e.currentTarget) }) : null);
          })))),
    p.orders?.length ? el("details", { class: "plan-orders" },
      el("summary", { text: `付款紀錄（${p.orders.length}）` }),
      el("ul", null, ...p.orders.map((o) => el("li", { class: "small" },
        el("span", { class: "num", text: md(o.createdAt.slice(0, 10)) }), " ",
        `${o.item}・${o.grant ? "贈送" : money(o.amount)}・${STATUS[o.status] || o.status}${o.kind === "monthly" && o.paidUntil ? `（到 ${md(o.paidUntil)}）` : ""}${o.test ? "・測試" : ""}`)))) : null,
    el("p", { class: "small muted", text: "付款由綠界處理，網站不會存你的信用卡資料。要退款或有問題，到 Discord 開客服單。" })));
}

const STATUS = { active: "自動扣款中", past_due: "扣款失敗", canceled: "已取消續扣", ended: "已結束", paid: "已付款", refunded: "已退款" };

// 系統分享頁、播放頁的「購買這一集」：確認後送到綠界
export async function buyPart(part, price) {
  const ok = await confirmDialog({
    title: `購買系統分享第 ${part} 集`,
    message: `${money(price)}，一次付清。${COURSE_HOSTS.join("、")} 的第 ${part} 份一起打開，之後一直看得到。接下來會到綠界的付款頁刷卡。`,
    confirmText: "前往付款",
    cancelText: "先不要",
  });
  if (!ok) return;
  const btn = el("button", { class: "btn", hidden: true });
  document.body.append(btn);
  await checkout({ item: "part", part }, btn);
}
