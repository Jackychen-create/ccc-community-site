// 研究員前台的進入點（index.html 載入這一支）：開機、登入後進主畫面、網址分頁
//
//   #/            直播紀錄列表   list.js
//   #/v/:id?t=秒  播放頁         watch.js（章節 chapters.js、筆記 notes.js）
//   #/course      系統分享       course.js
//   #/notes       我的筆記       notes.js
//   #/feedback    我的提問       feedback.js
//   #/plans       我的方案       plans.js（付費制的研究員：月費、系統分享單集）
import { $, api, sb, store, whatsNew, confirmDialog, tutorial } from "../core/index.js";
import { state, SITE } from "./state.js";
import { show, showBlocked, showUnavailable, leavePage } from "./views.js";
import { showAuth, initAuth } from "./auth.js";
import { showJoinError } from "./join.js";
import { renderMenu } from "./menu.js";
import { loadBadges, syncThemeFromAccount } from "./badges.js";
import { loadOneOnOne } from "./oneonone.js";
import { loadQuests } from "./quests.js";
import { renderAccessBanner, renderVolPanel, promptUidIfMissing, celebrateMilestone } from "./account.js";
import { renderLivePanel } from "./live.js";
import { openList } from "./list.js";
import { locked, openLocked } from "./locked.js";
import { openWatch } from "./watch.js";
import { openCourse } from "./course.js";
import { openNotes } from "./notes.js";
import { openFeedback } from "./feedback.js";
import { finishLink, finishOAuth, openDiscordLink } from "./discord-link.js";
import { isPaidMember, openPlans } from "./plans.js";

document.querySelectorAll("[data-site-name]").forEach((n) => (n.textContent = SITE));
document.title = SITE;

function route() {
  if (!state.me) return;
  // Discord 給的一次性連結：完成連結，回首頁
  const link = location.hash.match(/^#\/link-discord\?t=([0-9a-f]{48})$/);
  if (link) {
    history.replaceState(null, "", location.pathname + location.search + "#/");
    finishLink(link[1], () => { renderMenu(); route(); });
    return;
  }
  // 一鍵連結 Discord 回來（v1.35.0）
  if (location.hash.startsWith("#/discord-oauth?")) {
    const params = new URLSearchParams(location.hash.slice(location.hash.indexOf("?") + 1));
    history.replaceState(null, "", location.pathname + location.search + "#/");
    finishOAuth(params, () => { renderMenu(); route(); });
    return;
  }
  // 剛註冊好：還沒連 Discord 的話，直接請他連（一鍵就能拿到研究員身分組）
  let justJoined = false;
  try { justJoined = sessionStorage.getItem("justJoined") === "1"; sessionStorage.removeItem("justJoined"); } catch {}
  // （只有一鍵連結設定好才跳，不然要他自己去 Discord 按按鈕，等他從選單打開就好）
  if (justJoined && state.me?.discord && !state.me.discord.linked) {
    api("/api/discord-oauth").then((o) => { if (o?.enabled) openDiscordLink(renderMenu); }).catch(() => {});
  }
  const m = location.hash.match(/^#\/v\/(\d+)(?:\?t=(\d+))?/);
  // 付費制（v1.28.0）：首頁沒有月費就是「我的方案」；系統分享、筆記、提問一直都能進（買了的集數才看得到）
  if (isPaidMember()) {
    if (location.hash.startsWith("#/plans")) return openPlans();
    if (location.hash.startsWith("#/course?paid=1")) {
      history.replaceState(null, "", location.pathname + location.search + "#/course");
      setTimeout(() => refreshMe().then(() => openCourse()), 4000); // 綠界的通知可能晚幾秒到
    }
    if (m) return openWatch(Number(m[1]), { t: m[2] !== undefined ? Number(m[2]) : null });
    if (location.hash === "#/course") return openCourse();
    if (location.hash === "#/notes") return openNotes();
    if (location.hash === "#/feedback") return openFeedback();
    return state.me.volume.paid.sub ? openList() : openPlans();
  }
  // 還沒到第二級：首頁換成升級說明；第一級還是看得到系統分享（每位主講第 1 份）、筆記；提問每一級都可以
  if (locked()) {
    const t1 = (state.me.tier ?? 0) >= 1;
    if (t1 && m) return openWatch(Number(m[1]), { t: m[2] !== undefined ? Number(m[2]) : null });
    if (t1 && location.hash === "#/course") return openCourse();
    if (t1 && location.hash === "#/notes") return openNotes();
    if (location.hash === "#/feedback") return openFeedback();
    return openLocked();
  }
  if (m) openWatch(Number(m[1]), { t: m[2] !== undefined ? Number(m[2]) : null });
  else if (location.hash === "#/notes") openNotes();
  else if (location.hash === "#/course") openCourse();
  else if (location.hash === "#/feedback") openFeedback();
  else openList();
}

// 重新抓一次自己的資料（付款完成後）
async function refreshMe() {
  try {
    state.me = await api("/api/me");
    renderMenu();
    renderAccessBanner();
    renderVolPanel();
  } catch {}
}

let routerOn = false;
async function enterApp() {
  try {
    state.me = await api("/api/me");
  } catch (e) {
    if (e.status === 401) {
      await sb.auth.signOut();
      return;
    }
    if (e.status === 403) return showBlocked(e.message);
    return showUnavailable(e);
  }
  const me = state.me;
  const next = new URLSearchParams(location.search).get("next");
  if (next === "admin" && me.isAdmin) {
    location.replace("/admin");
    return;
  }
  if (location.search) history.replaceState(null, "", location.pathname + location.hash);
  show("appView");
  renderMenu();
  renderAccessBanner();
  renderVolPanel();
  renderLivePanel();
  // 這個瀏覽器第一次進來：問要不要看使用說明（只問一次；老研究員看到的是「網站更新了」）
  const firstVisit = !store.get("seenVersion", null);
  whatsNew();
  if (firstVisit && !me.isAdmin && !store.get("tutorialOffered", false)) offerTutorial();
  promptUidIfMissing();
  celebrateMilestone();
  syncThemeFromAccount();
  loadBadges();
  loadOneOnOne();
  loadQuests();
  if (!routerOn) {
    routerOn = true;
    window.addEventListener("hashchange", route);
  }
  route();
}

async function offerTutorial() {
  store.set("tutorialOffered", true);
  const yes = await confirmDialog({
    title: "歡迎加入實驗室培訓計畫",
    message: "第一次來？花 3 分鐘看使用說明：怎麼加入、看直播紀錄、章節、筆記和提問。之後也可以在右上角選單打開。",
    confirmText: "看使用說明",
    cancelText: "之後再看",
  });
  if (yes) tutorial();
}

$("#blockedLogout").addEventListener("click", () => sb.auth.signOut());
$("#blockedRetry").addEventListener("click", () => location.reload());

initAuth(enterApp);

sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    state.me = null;
    state.videos = [];
    state.loadedList = false;
    leavePage();
    showAuth();
  }
});

(async function boot() {
  // v1.36.0：加入培訓計畫、用 Discord 登入回來：用一次性代碼登入網站，代碼用完就從網址拿掉
  if (location.hash.startsWith("#/discord-oauth?")) {
    const q = new URLSearchParams(location.hash.slice(location.hash.indexOf("?") + 1));
    const t = q.get("t");
    if (t) {
      q.delete("t");
      history.replaceState(null, "", `${location.pathname}${location.search}#/discord-oauth?${q}`);
      const { error } = await sb.auth.verifyOtp({ token_hash: t, type: "magiclink" });
      if (error) { history.replaceState(null, "", location.pathname + location.search); showAuth(); return showJoinError("登入沒有完成，請按「用 Discord 登入」再試一次", "signin"); }
    } else if (q.get("r") === "err") {
      const { data: d } = await sb.auth.getSession();
      if (!d.session) {
        history.replaceState(null, "", location.pathname + location.search);
        showAuth();
        return showJoinError(q.get("m") || "請再試一次", q.get("w") === "join" ? "join" : "signin");
      }
    }
  }
  const { data } = await sb.auth.getSession();
  if (!data.session) return showAuth();
  await enterApp();
})();
