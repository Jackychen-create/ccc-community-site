// 登入／註冊（用實驗室密碼加入）
import { $, el, api, sb, icons, store, setBusy, countUp, tutorial } from "../core/index.js";
import { SITE } from "./state.js";
import { show } from "./views.js";
import { shortDate } from "./format.js";

let mode = "login";
let onLogin = async () => {};

export function showAuth() {
  show("authView");
  document.title = SITE;
  const params = new URLSearchParams(location.search);
  const invite = params.get("invite");
  if (invite) {
    $("#invite").value = invite.toUpperCase();
    setMode("register");
  } else {
    setMode(mode);
  }
  const remembered = store.get("lastEmail", "");
  if (remembered && !$("#email").value) $("#email").value = remembered;
  loadBoard();
}

// 登入頁上方的小看板：最新一場的日期、累計場次（不含任何影片內容）
let boardLoaded = false;
async function loadBoard() {
  if (boardLoaded) return;
  try {
    const r = await api("/api/stats");
    boardLoaded = true;
    if (r.latest) {
      $("#statLatest").textContent = shortDate(r.latest);
    }
    const n = document.createTextNode("0");
    $("#statCount").replaceChildren(n, el("span", { text: "場" }));
    countUp(n, r.count || 0);
    $("#authBoard").classList.add("tick");
  } catch {}
}

function setMode(m) {
  mode = m;
  const reg = m === "register";
  $("#tabLogin").setAttribute("aria-selected", String(!reg));
  $("#tabRegister").setAttribute("aria-selected", String(reg));
  $("#inviteRow").hidden = !reg;
  $("#uidRow").hidden = !reg;
  $("#invite").required = reg;
  $("#authTitle").textContent = reg ? "加入培訓計畫" : "歡迎回來";
  $("#authSub").textContent = reg ? "輸入實驗室密碼，建立你的帳號" : "用你的 Email 和密碼登入";
  $("#pwLabel").textContent = reg ? "設定你的登入密碼（至少 8 個字元）" : "密碼";
  $("#password").autocomplete = reg ? "new-password" : "current-password";
  $("#authSubmit").textContent = reg ? "建立帳號並登入" : "登入";
  setAuthError("");
}

function setAuthError(msg) {
  const box = $("#authError");
  box.textContent = msg;
  box.hidden = !msg;
}

function loginErrorText(err) {
  const m = String(err?.message || "");
  if (/invalid login credentials/i.test(m)) return "Email 或密碼錯誤";
  if (/banned/i.test(m)) return "這個帳號已被停用，請聯絡管理員";
  if (/email not confirmed/i.test(m)) return "這個帳號還沒完成驗證，請聯絡管理員";
  if (/rate limit|too many/i.test(m)) return "嘗試次數太多，請稍等幾分鐘再試";
  return "登入失敗，請稍後再試";
}

const UID_HINT = {
  OKX: "OKX 的 UID 在個人中心。",
  UM: "UM 請填 MT5 交易帳號。",
  Bybit: "Bybit 請填主帳號的 UID。網站會跟 Bybit 確認是不是用 CCC 邀請連結註冊的。",
  BingX: "BingX 的 UID 在個人頁面。網站會跟 BingX 確認是不是用 CCC 邀請連結註冊的。",
};

// 掛上表單事件；登入成功後呼叫 afterLogin
export function initAuth(afterLogin) {
  onLogin = afterLogin;
  $("#tabLogin").addEventListener("click", () => setMode("login"));
  $("#tabRegister").addEventListener("click", () => setMode("register"));
  $("#regEx").addEventListener("change", () => {
    setAuthError("");
    $("#regUidHint").textContent = UID_HINT[$("#regEx").value] || "管理員要靠 UID 對到你的交易量。用好幾間的話，登入後可以再加。";
  });
  $("#authTutorial").addEventListener("click", (e) => {
    e.preventDefault();
    tutorial();
  });

  const reveal = $("#revealPw");
  reveal.innerHTML = icons.eyeOff; // 預設密碼是隱藏的：顯示斜線眼睛
  reveal.addEventListener("click", () => {
    const pw = $("#password");
    const showing = pw.type === "text";
    pw.type = showing ? "password" : "text";
    reveal.innerHTML = showing ? icons.eyeOff : icons.eye; // 看得到密碼 = 張開的眼睛
    reveal.setAttribute("aria-pressed", String(!showing));
    reveal.setAttribute("aria-label", showing ? "顯示密碼" : "隱藏密碼");
  });

  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim().toLowerCase();
    const password = $("#password").value;
    const invite = $("#invite").value.trim().toUpperCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setAuthError("請輸入正確的 Email");
    // 登入不檢查長度（管理員在 Supabase 建的帳號密碼可能比較短）；註冊才要求至少 8 個字元
    if (!password) return setAuthError("請輸入密碼");
    if (mode === "register" && password.length < 8) return setAuthError("密碼至少需要 8 個字元");
    if (mode === "register" && !invite) return setAuthError("請輸入實驗室密碼");
    const exchange = $("#regEx").value;
    const uid = $("#regUid").value.replace(/\s/g, "");
    if (mode === "register" && !exchange) return setAuthError("請選擇你用 CCC 邀請連結註冊的交易所");
    if (mode === "register" && !/^\d{5,20}$/.test(uid)) return setAuthError("請填交易所 UID（一串數字）");

    const btn = $("#authSubmit");
    setBusy(btn, true, mode === "register" ? "建立帳號中…" : "登入中…");
    setAuthError("");
    try {
      if (mode === "register") {
        await api("/api/register", { method: "POST", body: { email, password, inviteCode: invite, exchange, uid } });
      }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(loginErrorText(error));
      store.set("lastEmail", email);
      $("#password").value = "";
      await onLogin();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setBusy(btn, false);
    }
  });
}
