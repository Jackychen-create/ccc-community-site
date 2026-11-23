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
