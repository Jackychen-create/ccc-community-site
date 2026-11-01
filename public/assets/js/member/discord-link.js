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
  let info = {};
  try { info = await api("/api/discord-link"); } catch {}
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
