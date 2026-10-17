// Discord 審核：最近的申請、機器人設定（身分組、報名頻道、審核頻道、客服身分組、邀請連結）、張貼報名按鈕
// 研究員按報名按鈕 → 機器人開一個私人報名頻道（像 Ticket Tool），在裡面選交易所、填 UID
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
  const badge = $("#cDiscord");
  if (badge) badge.textContent = dc.applications.filter((a) => a.status === "pending").length || "";
  renderApps();
  renderSettings();
}

function renderApps() {
  const box = $("#dcAppsBox");
  const apps = dc.applications;
  if (!apps.length) {
    box.replaceChildren(el("div", { class: "empty" },
      el("h2", { text: "還沒有人申請" }),
      el("p", { class: "small", style: { marginTop: "6px" }, text: "照右邊的步驟把機器人加進伺服器、按「一鍵建立 Discord 頻道」，研究員就能在 Discord 申請。" })));
    return;
  }
  box.replaceChildren(
    el("div", { class: "table-wrap" },
      el("table", { class: "table stack dc-table" },
        el("thead", null, el("tr", null, el("th", { text: "申請人" }), el("th", { text: "交易所／UID" }), el("th", { text: "結果" }), el("th", { class: "hide-sm", text: "審核" }))),
        el("tbody", null, apps.map((a) => {
          const [label, kind] = STATUS[a.status] || [a.status, ""];
          return el("tr", null,
            el("td", { "data-label": "申請人" }, el("b", { text: a.discord_name || "—" }),
              el("div", { class: "small " + (a.site_email ? "dc-email" : "muted"), text: a.site_email ? `網站：${a.site_email}` : "網站還沒填這個 UID" }),
              el("div", { class: "small muted num", text: A.fmtRel(a.created_at) })),
            el("td", { "data-label": "交易所／UID" }, el("span", { text: exName(a.exchange) }), el("div", { class: "small muted num", text: a.exchange_uid })),
            el("td", { "data-label": "結果" }, el("span", { class: "pill " + kind }, el("span", { class: "dot" }), label),
              a.invite_code ? el("div", { class: "small muted num", text: `實驗室密碼 ${a.invite_code}` }) : null),
            el("td", { class: "small sub hide-sm", text: a.status === "pending" ? "到他的報名頻道按通過" : a.reviewed_by || "—" }));
        })))),
    el("p", { class: "small muted", style: { marginTop: "10px" }, text: "只顯示最近 30 筆。等待審核的請到 Discord 的「🔒報名審核」點通知裡的頻道，在他的報名頻道按「通過」或「不通過」。通過的人會拿到一組只能用一次的實驗室密碼。" })
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
  const post = el("button", { class: "btn block", type: "button", style: { marginTop: "10px" } }, icon("upload"), "重新張貼報名按鈕");
  const setup = el("button", { class: "btn primary block", type: "button", id: "dcSetup", style: { marginTop: "12px" } }, "一鍵建立 Discord 頻道");
  const result = el("div", { id: "dcSetupResult" });
  box.replaceChildren(
    el("h2", { text: "機器人設定" }),
    status,
    el("div", { class: "dc-quick" },
      el("p", { class: "small", text: "第 1 步：把機器人加進你的 Discord 伺服器" }),
      dc.inviteUrl
        ? el("a", { class: "btn block", href: dc.inviteUrl, target: "_blank", rel: "noopener", id: "dcInvite" }, icon("ext"), "把機器人加進伺服器")
        : el("p", { class: "small muted", text: "設定好 Cloudflare 的 DISCORD_APP_ID 後這裡會出現邀請按鈕。" }),
      el("p", { class: "small", style: { marginTop: "14px" }, text: "第 2 步：一鍵建立分類、報名頻道、審核頻道、研究員專屬公告頻道、放私人報名頻道的分類（權限都設好）。實驗室密碼不貼在頻道裡，通過的人會在自己的報名頻道拿到專用的一組。" }),
      setup,
      result),
    el("details", { class: "dc-more" }, el("summary", { class: "small", text: "進階設定（頻道 ID、身分組、邀請連結）" }),
      el("label", { class: "field" }, el("span", { class: "label", text: "通過後給的身分組 ID" }), idInput("dcRole", s.roleId, "例如 1560542923173400596")),
      el("label", { class: "field" }, el("span", { class: "label", text: "報名頻道 ID（放報名按鈕）" }), idInput("dcPanel", s.panelChannelId, "對頻道按右鍵 → 複製頻道 ID")),
      el("label", { class: "field" }, el("span", { class: "label", text: "審核頻道 ID（有人等審核時通知在這裡）" }), idInput("dcReview", s.reviewChannelId, "只有管理員看得到的頻道")),
      el("label", { class: "field" }, el("span", { class: "label", text: "客服身分組 ID（選填，看得到報名頻道、可以按通過）" }),
        el("input", { class: "input num", id: "dcStaff", type: "text", autocomplete: "off", maxlength: "120", value: (s.staffRoleIds || []).join(", "), placeholder: "多個用逗號分開" })),
      el("p", { class: "small muted", style: { marginTop: "12px" }, text: "邀請連結（選填，沒通過時會附給申請人）" }),
      ...invites,
      save,
      post),
    el("div", { class: "dc-endpoint" },
      el("span", { class: "small muted", text: "Discord Developer Portal 的 Interactions Endpoint URL：" }),
      el("button", { class: "btn sm ghost", type: "button", onclick: () => A.copyText(endpoint), title: "複製" }, icon("copy"), el("span", { class: "num", text: endpoint }))),
  );

  setup.addEventListener("click", async () => {
    A.setBusy(setup, true, "建立中…");
    try {
      const r = await api("/api/admin/discord", { method: "POST", body: { action: "setup" } });
      dc.settings = r.settings;
      A.toast(r.created.length ? `已在「${r.guildName}」建立 ${r.created.length} 個頻道` : `「${r.guildName}」的頻道和權限都已經設定好`);
      renderSettings();
      $("#dcSetupResult").replaceChildren(el("div", { class: "dc-result" + (r.hierarchyOk ? "" : " bad") },
        el("p", { class: "small", text: r.created.length ? `建立了：${r.created.join("、")}` : "頻道都在，權限已經調好。" }),
        r.hierarchyOk
          ? el("p", { class: "small dc-ok" }, icon("ok"), `機器人可以給「${r.roleName}」身分組`)
          : el("p", { class: "small warn-text", text: `還差一步：到 Discord 伺服器設定 → 身分組，把機器人的身分組拖到「${r.roleName}」上面，機器人才能給別人這個身分組。` })));
    } catch (e) {
      A.setBusy(setup, false);
      fail(e);
    }
  });
  save.addEventListener("click", async () => {
    A.setBusy(save, true, "儲存中…");
    try {
      const inv = {};
      box.querySelectorAll("input[data-ex]").forEach((i) => { if (i.value.trim()) inv[i.dataset.ex] = i.value.trim(); });
      const r = await api("/api/admin/discord", { method: "PATCH", body: {
        roleId: $("#dcRole").value.trim(), panelChannelId: $("#dcPanel").value.trim(), reviewChannelId: $("#dcReview").value.trim(), staffRoleIds: $("#dcStaff").value.trim(), invites: inv,
      } });
      dc.settings = r.settings;
      A.toast(r.synced === false ? "已儲存，但客服身分組的頻道權限沒更新成功，請按一次「一鍵建立 Discord 頻道」" : "已儲存 Discord 設定");
      renderSettings();
    } catch (e) {
      A.setBusy(save, false);
      fail(e);
    }
  });
  post.addEventListener("click", async () => {
    if (!s.panelChannelId) return A.toast("先填報名頻道 ID 並儲存", "err");
    A.setBusy(post, true, "張貼中…");
    try {
      await api("/api/admin/discord", { method: "POST", body: { action: "panel" } });
      A.toast("已經在報名頻道張貼報名按鈕");
    } catch (e) {
      fail(e);
    } finally {
      A.setBusy(post, false);
    }
  });
}
