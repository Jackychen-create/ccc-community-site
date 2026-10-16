// Discord 審核：最近的申請、機器人設定（身分組、申請頻道、審核頻道、邀請連結）、張貼申請按鈕
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { fail, loadingBox } from "./common.js";
import { EXCHANGES } from "../shared/rules.js";

let dc = null; // { configured, settings, applications }
let loaded = false;

export async function loadDiscord() {
  if (!loaded) {
    $("#dcAppsBox").replaceChildren(loadingBox());
    $("#dcSettingsBox").replaceChildren(loadingBox());
  }
  try {
    dc = await api("/api/admin/discord");
    loaded = true;
    render();
  } catch (e) {
    fail(e);
  }
}

const STATUS = { pending: ["等待審核", "brass"], approved: ["已通過", "good"], rejected: ["不通過", "warn"] };
const exName = (ex) => (ex === "UM" ? "UM" : ex);

function render() {
  $("#cDiscord").textContent = dc.applications.filter((a) => a.status === "pending").length || "";
  renderApps();
  renderSettings();
}

function renderApps() {
  const box = $("#dcAppsBox");
  const apps = dc.applications;
  if (!apps.length) {
    box.replaceChildren(el("div", { class: "empty" },
      el("h2", { text: "還沒有人申請" }),
      el("p", { class: "small", style: { marginTop: "6px" }, text: "設定好右邊的頻道，按「張貼申請按鈕」，研究員就能在 Discord 申請。" })));
    return;
  }
  box.replaceChildren(
    el("div", { class: "table-wrap" },
      el("table", { class: "table stack dc-table" },
        el("thead", null, el("tr", null, el("th", { text: "申請人" }), el("th", { text: "交易所／UID" }), el("th", { text: "結果" }), el("th", { class: "hide-sm", text: "審核" }))),
        el("tbody", null, apps.map((a) => {
          const [label, kind] = STATUS[a.status] || [a.status, ""];
          return el("tr", null,
            el("td", { "data-label": "申請人" }, el("b", { text: a.discord_name || "—" }), el("div", { class: "small muted num", text: A.fmtRel(a.created_at) })),
            el("td", { "data-label": "交易所／UID" }, el("span", { text: exName(a.exchange) }), el("div", { class: "small muted num", text: a.exchange_uid })),
            el("td", { "data-label": "結果" }, el("span", { class: "pill " + kind }, el("span", { class: "dot" }), label)),
            el("td", { class: "small sub hide-sm", text: a.status === "pending" ? "到 Discord 審核頻道按通過" : a.reviewed_by || "—" }));
        })))),
    el("p", { class: "small muted", style: { marginTop: "10px" }, text: "只顯示最近 30 筆。等待審核的請到 Discord 的審核頻道按「通過」或「不通過」。" })
  );
}

function idInput(id, value, placeholder) {
  return el("input", { class: "input num", id, type: "text", inputmode: "numeric", autocomplete: "off", maxlength: "20", value: value || "", placeholder });
}

function renderSettings() {
  const s = dc.settings;
  const box = $("#dcSettingsBox");
  const endpoint = `${location.origin}/api/discord/interactions`;
  const status = dc.configured
    ? el("p", { class: "small dc-ok" }, icon("ok"), "機器人已連上")
    : el("p", { class: "small warn-text" }, "機器人還沒設定：要在 Cloudflare 填 DISCORD_APP_ID、DISCORD_PUBLIC_KEY、DISCORD_BOT_TOKEN（說明在 docs/部署與設定.md）。");
  const invites = EXCHANGES.map((ex) => el("label", { class: "field" }, el("span", { class: "label", text: `${ex} 邀請連結` }),
    el("input", { class: "input", type: "url", "data-ex": ex, value: s.invites?.[ex] || "", placeholder: "https://…" })));
  const save = el("button", { class: "btn primary block", type: "button", text: "儲存設定", style: { marginTop: "16px" } });
  const post = el("button", { class: "btn block", type: "button", style: { marginTop: "10px" } }, icon("upload"), "在申請頻道張貼申請按鈕");
  box.replaceChildren(
    el("h2", { text: "機器人設定" }),
    status,
    el("label", { class: "field" }, el("span", { class: "label", text: "通過後給的身分組 ID" }), idInput("dcRole", s.roleId, "例如 1560542923173400596")),
    el("label", { class: "field" }, el("span", { class: "label", text: "申請頻道 ID（放申請按鈕）" }), idInput("dcPanel", s.panelChannelId, "對頻道按右鍵 → 複製頻道 ID")),
    el("label", { class: "field" }, el("span", { class: "label", text: "審核頻道 ID（OKX、UM 送到這裡）" }), idInput("dcReview", s.reviewChannelId, "只有管理員看得到的頻道")),
    el("details", { class: "dc-more" }, el("summary", { class: "small", text: "邀請連結（選填，沒通過時會附給申請人）" }), ...invites),
    save,
    post,
    el("div", { class: "dc-endpoint" },
      el("span", { class: "small muted", text: "Discord Developer Portal 的 Interactions Endpoint URL：" }),
      el("button", { class: "btn sm ghost", type: "button", onclick: () => A.copyText(endpoint), title: "複製" }, icon("copy"), el("span", { class: "num", text: endpoint }))),
  );

  save.addEventListener("click", async () => {
    A.setBusy(save, true, "儲存中…");
    try {
      const inv = {};
      box.querySelectorAll("input[data-ex]").forEach((i) => { if (i.value.trim()) inv[i.dataset.ex] = i.value.trim(); });
      const r = await api("/api/admin/discord", { method: "PATCH", body: {
        roleId: $("#dcRole").value.trim(), panelChannelId: $("#dcPanel").value.trim(), reviewChannelId: $("#dcReview").value.trim(), invites: inv,
      } });
      dc.settings = r.settings;
      A.toast("已儲存 Discord 設定");
      renderSettings();
    } catch (e) {
      A.setBusy(save, false);
      fail(e);
    }
  });
  post.addEventListener("click", async () => {
    if (!s.panelChannelId) return A.toast("先填申請頻道 ID 並儲存", "err");
    A.setBusy(post, true, "張貼中…");
    try {
      await api("/api/admin/discord", { method: "POST", body: { action: "panel" } });
      A.toast("已經在申請頻道張貼申請按鈕");
    } catch (e) {
      fail(e);
    } finally {
      A.setBusy(post, false);
    }
  });
}
