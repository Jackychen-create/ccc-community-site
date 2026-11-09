// 還沒到第二級的研究員：首頁換成「升上第二級，打開整個網站」（直播留檔、教學課程、筆記都鎖著）
// 右欄的直播預告、我的等級、徽章照樣顯示；規則在 shared/rules.js 的 TIERS
import { $, el } from "../core/index.js";
import { state, SITE } from "./state.js";
import { showPage } from "./views.js";
import { md } from "./format.js";
import { TIERS, SITE_TIER, tierName, tierRuleText, gapTo } from "../shared/rules.js";

export const locked = () => !!state.me && !state.me.isAdmin && (state.me.tier ?? 0) < SITE_TIER;

const SIGNUP = { OKX: "OKX 註冊", UM: "UM 開戶", Bybit: "Bybit 註冊", BingX: "BingX 註冊" };

export function openLocked() {
  showPage("listView", { nav: "list", search: false, title: SITE });
  for (const id of ["continueList", "coursePanel", "statsPanel", "recentNotes"]) $("#" + id).hidden = true;
  document.querySelector("#listView .keys-panel").hidden = true;
  $("#chips").replaceChildren();
  $("#countText").textContent = "";
  document.querySelector("#listView .vhead").hidden = true;
  document.querySelector("#listView h1").firstChild.textContent = "研究員專區 ";
  const v = state.me.volume;
  const tier = state.me.tier ?? 0;
  const invites = Object.entries(state.me.invites || {});
  $("#grid").replaceChildren(el("div", { class: "lock-page" },
    el("div", { class: "lock-hero" },
      el("span", { class: "pill" }, `你現在是${tierName(tier)}`),
      el("h2", { text: "升上第二級，打開整個網站" }),
      el("p", { class: "sub", text: `直播留檔、教學課程之後的更新，第二級以上才看得到。這一輪（${md(v.periodStart)}～${md(v.periodEnd)}）${tierRuleText(SITE_TIER)} 就能升級，${v.amounts ? gapTo(v.amounts, SITE_TIER, v.exchanges) : "還沒有交易量"}。` })),
    tier >= 1 ? el("a", { class: "lock-free", href: "#/course" },
      el("div", null, el("b", { text: "先看教學課程第 1 份" }), el("div", { class: "small muted", text: "第一級看得到每一組教學課程的第 1 份（照解鎖時間）；第 2 份以後要第二級。" })),
      el("span", { class: "btn sm", text: "去看" })) : null,
    el("ol", { class: "tier-table" },
      ...TIERS.map((t) => el("li", { class: "tier-card" + (t.tier === tier ? " me" : "") + (t.tier <= tier ? " got" : "") },
        el("div", { class: "tier-head" }, el("b", { text: tierName(t.tier) }), t.tier === tier ? el("span", { class: "pill good", text: "你在這裡" }) : null),
        el("div", { class: "tier-goal num", text: tierRuleText(t.tier) }),
        el("ul", null, ...t.perks.map((x) => el("li", { text: x })))))),
    el("p", { class: "small muted", text: "每人從加入那天起算，一輪一個月；這一輪達到第幾級，下一輪就是第幾級。交易量每天自動更新（Bybit、BingX），OKX、UM 由管理員更新。會員直播的時間看右邊的「下一場直播」和 Discord「研究員專屬公告」。" }),
    invites.length ? el("div", { class: "lock-signup" },
      el("div", { class: "small", text: "還沒有交易所帳號？用 CCC 的邀請連結註冊，交易量才算得到：" }),
      el("div", { class: "chips" }, ...invites.map(([ex, url]) => el("a", { class: "btn sm", href: url, target: "_blank", rel: "noopener", text: SIGNUP[ex] || ex })))) : null));
}
