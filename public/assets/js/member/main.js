// 研究員前台的進入點（index.html 載入這一支）：開機、登入後進主畫面、網址分頁
//
//   #/            直播留檔列表   list.js
//   #/v/:id?t=秒  播放頁         watch.js（章節 chapters.js、筆記 notes.js）
//   #/course      教學課程       course.js
//   #/notes       我的筆記       notes.js
//   #/feedback    我的提問       feedback.js
import { $, api, sb, store, whatsNew, confirmDialog, tutorial } from "../core/index.js";
import { state, SITE } from "./state.js";
import { show, showBlocked, showUnavailable, leavePage } from "./views.js";
import { showAuth, initAuth } from "./auth.js";
import { renderMenu } from "./menu.js";
import { renderAccessBanner, renderVolPanel, promptUidIfMissing } from "./account.js";
import { openList } from "./list.js";
import { openWatch } from "./watch.js";
import { openCourse } from "./course.js";
import { openNotes } from "./notes.js";
import { openFeedback } from "./feedback.js";

document.querySelectorAll("[data-site-name]").forEach((n) => (n.textContent = SITE));
document.title = SITE;

function route() {
  if (!state.me) return;
  const m = location.hash.match(/^#\/v\/(\d+)(?:\?t=(\d+))?/);
  if (m) openWatch(Number(m[1]), { t: m[2] !== undefined ? Number(m[2]) : null });
  else if (location.hash === "#/notes") openNotes();
  else if (location.hash === "#/course") openCourse();
  else if (location.hash === "#/feedback") openFeedback();
  else openList();
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
  // 這個瀏覽器第一次進來：問要不要看使用教學（只問一次；老研究員看到的是「網站更新了」）
  const firstVisit = !store.get("seenVersion", null);
  whatsNew();
  if (firstVisit && !me.isAdmin && !store.get("tutorialOffered", false)) offerTutorial();
  promptUidIfMissing();
  if (!routerOn) {
    routerOn = true;
    window.addEventListener("hashchange", route);
  }
  route();
}

async function offerTutorial() {
  store.set("tutorialOffered", true);
  const yes = await confirmDialog({
    title: "歡迎加入交易實驗室",
    message: "第一次來？花 2 分鐘看使用教學：怎麼找影片、接著看、章節、筆記和每月交易量。之後也可以在右上角選單打開。",
    confirmText: "看使用教學",
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
  const { data } = await sb.auth.getSession();
  if (!data.session) return showAuth();
  await enterApp();
})();
