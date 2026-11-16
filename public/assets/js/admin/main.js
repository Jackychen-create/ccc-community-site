// 後台的進入點（admin.html 載入這一支）：開機確認管理員、側欄分頁（#videos、#invites…）
//
//   #videos   影片        videos.js、editor.js、upload.js
//   #lives    直播預告    lives.js
//   #invites  實驗室密碼  invites.js
//   #discord  Discord 審核  discord.js
//   #members  研究員      members.js
//   #volumes  交易量      volumes.js
//   #pay      付費        pay.js（月費、單集、綠界）
//   #oneonone 一對一      oneonone.js
//   #stats    觀看統計    stats.js
//   #feedback 提問回報    feedback.js
//   #followup 待跟進      followup.js
//   #chat     聊天統計    chat.js
//   #bots     機器人      bots.js
//   #health   網站狀況    health.js
import * as A from "../core/index.js";
const { $, api, sb, icon } = A;
import { state } from "./state.js";
import { show } from "./common.js";
import { loadVideos } from "./videos.js";
import { activeUploads } from "./upload.js";
import { loadInvites } from "./invites.js";
import { loadDiscord } from "./discord.js";
import { loadOneOnOne } from "./oneonone.js";
import { loadLives } from "./lives.js";
import { loadMembers } from "./members.js";
import { loadVolumes } from "./volumes.js";
import { loadPay } from "./pay.js";
import { loadStats } from "./stats.js";
import { loadFeedback, refreshFeedbackCount } from "./feedback.js";
import { loadFollowup } from "./followup.js";
import { loadHealth } from "./health.js";
import { loadChat } from "./chat.js";
import { loadBots } from "./bots.js";
import { canSeeView, ROLE_LABEL } from "../shared/roles.js";

document.querySelectorAll("[data-ico]").forEach((n) => {
  n.replaceWith(icon(n.dataset.ico));
});

(async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return location.replace("/?next=admin");
  try {
    state.me = await api("/api/me");
  } catch (e) {
    if (e.status === 401) {
      await sb.auth.signOut();
      return location.replace("/?next=admin");
    }
    show("noAccess");
    if (e.status !== 403) {
      $("#noAccessTitle").textContent = "網站暫時無法使用";
      $("#noAccessMsg").textContent = e.status === 0 ? "連線失敗，請檢查網路後再試一次。" : e.message;
    }
    return;
  }
  if (!state.me.isAdmin) return show("noAccess");
  $("#whoami").textContent = state.me.adminRole === "editor" ? `${state.me.email}（${ROLE_LABEL.editor}）` : state.me.email;
  // 協作管理員看不到的頁面，側欄直接拿掉
  document.querySelectorAll(".nav a[data-view]").forEach((a) => { if (!canSeeView(state.me.adminRole, a.dataset.view)) a.remove(); });
  // 「機器人」這一組都看不到（協作管理員）就連標題一起拿掉
  if (!document.querySelector(".nav a[data-group=bots]")) document.getElementById("navBotsHead")?.remove();
  show("shell");
  window.addEventListener("hashchange", route);
  route();
  // 先把三個清單都抓回來，側欄數字才有東西
  if (canSeeView(state.me.adminRole, "invites")) loadInvites(true);
  loadMembers(true);
  A.whatsNew();
})();

async function logout(e) {
  e && e.preventDefault();
  if (activeUploads.size && !(await A.confirmDialog({ title: "還有影片在上傳", message: "現在登出會中斷上傳，確定要登出嗎？", confirmText: "登出", danger: true }))) return;
  await sb.auth.signOut();
  location.href = "/";
}
$("#logout").addEventListener("click", logout);
$("#changelogLink").addEventListener("click", (e) => {
  e.preventDefault();
  A.whatsNew({ all: true });
});
$("#tutorialLink").addEventListener("click", (e) => {
  e.preventDefault();
  A.tutorial("admin");
});
$("#noAccessLogout").addEventListener("click", logout);

// 側欄數字：待回覆的提問
let badgesLoaded = false;
function loadBadges() {
  if (badgesLoaded) return;
  badgesLoaded = true;
  refreshFeedbackCount();
}

function route() {
  loadBadges();
  const VIEWS = ["videos", "lives", "invites", "discord", "members", "volumes", "pay", "oneonone", "stats", "feedback", "followup", "chat", "bots", "health"];
  const want = location.hash.slice(1);
  const view = VIEWS.includes(want) && canSeeView(state.me?.adminRole, want) ? want : "videos";
  document.querySelectorAll("[data-view-panel]").forEach((p) => (p.hidden = p.dataset.viewPanel !== view));
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.view === view) {
      a.setAttribute("aria-current", "page");
      // 手機上導覽是橫向捲動，切過去時把目前這頁捲進畫面
      if (matchMedia("(max-width: 900px)").matches) a.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    else a.removeAttribute("aria-current");
  });
  document.title = { videos: "影片", lives: "直播預告", invites: "實驗室密碼", discord: "Discord 審核", members: "研究員", volumes: "交易量", pay: "付費", oneonone: "一對一", stats: "觀看統計", feedback: "提問回報", followup: "待跟進", chat: "聊天統計", bots: "機器人", health: "網站狀況" }[view] + "｜後台管理";
  if (view === "videos") loadVideos();
  if (view === "lives") loadLives();
  if (view === "invites") loadInvites();
  if (view === "discord") loadDiscord();
  if (view === "members") loadMembers();
  if (view === "stats") loadStats();
  if (view === "volumes") loadVolumes();
  if (view === "pay") loadPay();
  if (view === "oneonone") loadOneOnOne();
  if (view === "feedback") loadFeedback();
  if (view === "followup") loadFollowup();
  if (view === "health") loadHealth();
  if (view === "chat") loadChat();
  if (view === "bots") loadBots();
}
