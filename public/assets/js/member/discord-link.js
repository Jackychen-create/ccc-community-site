// 連結 Discord 帳號（右上角選單）：在 Discord 按「🔗 連結網站帳號」拿一次性連結，打開就連好
// 連結長這樣：#/link-discord?t=…（main.js 收到後呼叫 finishLink）
import { el, api, modal, toast, confirmDialog, setBusy } from "../core/index.js";
import { state } from "./state.js";

export async function openDiscordLink(after) {
  if (state.me?.discord?.linked) {
    const ok = await confirmDialog({ title: "解除 Discord 連結？", message: `現在連的是「${state.me.discord.name || "你的 Discord 帳號"}」。解除後，課程解鎖這些提醒會改寄信。`, confirmText: "解除", danger: true });
    if (!ok) return;
    try { await api("/api/discord-link", { method: "DELETE" }); state.me.discord = { linked: false, name: "" }; toast("已解除 Discord 連結"); after?.(); }
    catch (e) { toast(e.message, "err"); }
    return;
  }
  let info = {}, oauth = {};
  try { [info, oauth] = await Promise.all([api("/api/discord-link").catch(() => ({})), api("/api/discord-oauth").catch(() => ({}))]); } catch {}
  // 一鍵連結（v1.35.0）：Discord 授權頁按同意 → 自動加進伺服器、拿到實驗室研究員身分組
  if (oauth.enabled) {
    const one = el("button", { class: "btn primary", type: "button", text: "用 Discord 一鍵連結" });
    one.addEventListener("click", async () => {
      setBusy(one, true, "前往 Discord…");
      try { location.href = (await api("/api/discord-oauth", { method: "POST" })).url; }
      catch (e) { setBusy(one, false); toast(e.message, "err"); }
    });
    modal({
      title: "連結 Discord",
      body: el("div", null,
        el("p", { class: "sub", text: "按下去會到 Discord 的授權頁，按「授權」就好。還沒加入 CCC 的 Discord 會自動加進去，並直接拿到「實驗室研究員」身分組，看得到會員直播和研究員大廳。" }),
        el("p", { class: "small muted", text: "連好之後，課程解鎖這些提醒也會由實驗室助教私訊你。" })),
      actions: [one],
    });
    return;
  }
  const go = info.where
    ? el("a", { class: "btn primary", href: info.where, target: "_blank", rel: "noopener", text: "去 Discord 按按鈕" })
    : null;
  modal({
    title: "連結 Discord",
    body: el("div", null,
      el("p", { class: "sub", text: "連好之後，課程解鎖、升級這些提醒會由實驗室助教在 Discord 私訊你，不用再看信箱。" }),
      el("ol", { class: "link-steps" },
        el("li", { text: info.channelName ? `到 Discord 的 #${info.channelName}，按「🔗 連結網站帳號」。` : "到 CCC 的 Discord，找到「🔗 連結網站帳號」那則，按下按鈕。" }),
        el("li", { text: "實驗室助教會給你一個只有你看得到的連結（15 分鐘內有效）。" }),
        el("li", { text: "用現在這個瀏覽器打開那個連結，就連好了。" }))),
    actions: go ? [go] : [],
  });
}

// 一鍵連結回來：#/discord-oauth?r=ok|err|cancel&n=名字&j=joined|already&g=1|0&m=錯誤訊息
export function finishOAuth(params, done) {
  const r = params.get("r");
  // v1.36.0：用 Discord 加入培訓計畫（welcome）、用 Discord 登入（login）回來，已經登入網站了
  if (r === "welcome") { welcome(params); done?.(); return; }
  if (r === "login") { toast(`歡迎回來${params.get("n") ? `，${params.get("n")}` : ""}`); done?.(); return; }
  if (r === "ok") {
    state.me.discord = { linked: true, name: params.get("n") || "" };
    const joined = params.get("j") === "joined";
    const role = params.get("g") === "1";
    modal({
      title: "Discord 連好了",
      body: el("p", { class: "sub", text: (joined ? "已經把你加進 CCC 的 Discord 了" : "已經連上你的 Discord 帳號") + (role ? "，也給了你「實驗室研究員」身分組，現在就看得到會員直播和研究員大廳。" : "。") }),
      actions: [el("a", { class: "btn primary", href: "https://discord.com/channels/@me", target: "_blank", rel: "noopener", text: "打開 Discord" })],
    });
  } else if (r === "err") {
    modal({ title: "連結沒有成功", body: el("p", { class: "sub", text: params.get("m") || "請再試一次" }) });
  }
  done?.();
}

export async function finishLink(token, done) {
  try {
    const r = await api("/api/discord-link", { method: "POST", body: { token } });
    state.me.discord = { linked: true, name: r.name || "" };
    toast(`已連結 Discord${r.name ? `：${r.name}` : ""}，之後的提醒會私訊給你`);
  } catch (e) {
    modal({ title: "連結沒有成功", body: el("p", { class: "sub", text: e.message }) });
  }
  done?.();
}

// 開通完成：歡迎畫面＋研究員名單的 Email（Discord 給的，可以改）＋收不收通知＋打開 Discord 研究員頻道
async function welcome(params) {
  if (state.me) state.me.discord = { linked: true, name: params.get("n") || "" };
  const role = params.get("g") === "1";
  const channel = /^https:\/\/discord\.com\/channels\//.test(params.get("c") || "") ? params.get("c") : "https://discord.com/channels/@me";
  let c = { email: "", notify: false };
  try { c = await api("/api/join/contact"); } catch {}
  const email = el("input", { class: "input", type: "email", inputmode: "email", autocomplete: "email", value: c.email, placeholder: "你的 Email" });
  const notify = el("input", { type: "checkbox" });
  notify.checked = c.email ? c.notify : true;
  const msg = el("p", { class: "small muted", hidden: true });
  const save = el("button", { class: "btn sm", type: "button", text: "儲存" });
  const dirty = () => (save.hidden = email.value.trim().toLowerCase() === c.email && notify.checked === c.notify);
  email.addEventListener("input", dirty); notify.addEventListener("change", dirty);
  dirty();
  save.addEventListener("click", async () => {
    setBusy(save, true, "儲存中…");
    try {
      c = await api("/api/join/contact", { method: "POST", body: { email: email.value.trim(), notify: notify.checked } });
      msg.textContent = "已儲存"; msg.hidden = false; dirty();
    } catch (e) { msg.textContent = e.message; msg.hidden = false; }
    finally { setBusy(save, false); }
  });
  const go = el("a", { class: "btn primary lg block", href: channel, target: "_blank", rel: "noopener", text: "打開 Discord" });
  modal({
    title: "開通完成 🎉",
    body: el("div", { class: "welcome-box" },
      el("p", { class: "sub", text: role ? "已加入 CCC 的 Discord，拿到「實驗室研究員」身分組。" : "已加入 CCC 的 Discord。" }),
      el("label", { class: "field" }, el("span", { class: "label", text: "通知 Email" }), email),
      el("label", { class: "check-line" }, notify, el("span", { text: "同意收直播通知與活動資訊" })),
      el("div", { class: "welcome-save" }, save, msg)),
    actions: [go],
  });
}
