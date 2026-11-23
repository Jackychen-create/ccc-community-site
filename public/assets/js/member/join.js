// 加入培訓計畫（v1.36.0）：登入頁兩步
//   1. 選交易所、貼 UID → /api/join 跟交易所確認
//   2. 「進入 Discord 實驗室研究員專區」→ Discord 授權 → 回網站（#/discord-oauth?r=welcome&t=…）自動登入
// 登入：「用 Discord 登入」。舊帳號的 Email＋密碼、實驗室密碼收在下面的「用 Email 登入」裡
import { $, api, setBusy } from "../core/index.js";
import { cleanExId, exIdOk } from "../shared/rules.js";

const UID_HINT = {
  OKX: "OKX App →左上角頭像→ UID 在名字下面。",
  Bybit: "Bybit 請填主帳號的 UID：App 左上角頭像→ UID 在名字下面。",
  BingX: "BingX App →「我的」→ UID 在名字下面。",
};
const DEFAULT_HINT = "UID 在交易所 App 的個人頁面，是一串數字。";
let links = {};

function setError(id, msg) {
  const box = $(id);
  box.textContent = msg || "";
  box.hidden = !msg;
}
export function setTab(t) {
  $("#tabJoin").setAttribute("aria-selected", String(t === "join"));
  $("#tabSignin").setAttribute("aria-selected", String(t === "signin"));
  $("#joinPane").hidden = t !== "join";
  $("#signinPane").hidden = t !== "signin";
}
function showLinks(show) {
  const box = $("#joinLinks");
  for (const a of box.querySelectorAll("a[data-ex]")) { if (links[a.dataset.ex]) a.href = links[a.dataset.ex]; }
  box.hidden = !show;
}
function step(n) {
  $("#joinForm").hidden = n !== 1;
  $("#joinStep2").hidden = n !== 2;
}

// Discord 授權回來但沒成功（還沒登入）：在對的分頁顯示原因
export function showJoinError(msg, where = "join") {
  setTab(where);
  step(1);
  setError(where === "join" ? "#joinError" : "#signinError", msg);
}

// 新流程設定好了沒（伺服器沒設定 Discord OAuth 的話，退回舊的 Email 登入）
export async function checkJoin() {
  try {
    const r = await api("/api/join");
    links = r.links || {};
    if (r.enabled) return true;
  } catch {}
  $("#mainTabs").hidden = true;
  $("#joinPane").hidden = true;
  $("#signinPane").hidden = true;
  $("#legacyAuth").open = true;
  return false;
}

export function initJoin() {
  $("#tabJoin").addEventListener("click", () => setTab("join"));
  $("#tabSignin").addEventListener("click", () => setTab("signin"));
  $("#joinEx").addEventListener("change", () => {
    setError("#joinError", "");
    showLinks(false);
    $("#joinUidHint").textContent = UID_HINT[$("#joinEx").value] || DEFAULT_HINT;
  });
  $("#joinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const exchange = $("#joinEx").value;
    const uid = cleanExId(exchange, $("#joinUid").value);
    setError("#joinError", "");
    showLinks(false);
    if (!exchange) return setError("#joinError", "請選擇你用 CCC 連結註冊的交易所");
    if (!exIdOk(exchange, uid)) return setError("#joinError", "UID 是一串數字，請再確認一次");
    const btn = $("#joinSubmit");
    setBusy(btn, true, "跟交易所確認中…");
    try {
      const r = await api("/api/join", { method: "POST", body: { exchange, uid } });
      $("#joinOk").textContent = `✓ 已確認：${r.exchange} UID ${r.uid} 是用 CCC 連結註冊的`;
      $("#joinDiscord").href = r.url;
      step(2);
    } catch (err) {
      setError("#joinError", err.message);
      if (["not_invited", "other_code"].includes(err.data?.code || err.code)) showLinks(true);
    } finally {
      setBusy(btn, false);
    }
  });
  $("#joinBack").addEventListener("click", () => { step(1); $("#joinUid").focus(); });
  $("#discordLogin").addEventListener("click", async () => {
    const btn = $("#discordLogin");
    setBusy(btn, true, "前往 Discord…");
    setError("#signinError", "");
    try { location.href = (await api("/api/join/login", { method: "POST" })).url; }
    catch (err) { setBusy(btn, false); setError("#signinError", err.message); }
  });
}
