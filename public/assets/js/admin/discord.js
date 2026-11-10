// Discord 審核：最近的申請、機器人設定（身分組、報名頻道、審核頻道、客服身分組、邀請連結）、張貼報名按鈕
// 研究員按報名按鈕 → 機器人開一個私人報名頻道（像 Ticket Tool），在裡面選交易所、填 UID
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { fail, loadingBox } from "./common.js";
import { EXCHANGES, ONE_ON_ONE_HOSTS } from "../shared/rules.js";

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
        el("thead", null, el("tr", null, el("th", { text: "申請人" }), el("th", { text: "交易所／UID（UM 是帳號）" }), el("th", { text: "結果" }), el("th", { class: "hide-sm", text: "審核" }))),
        el("tbody", null, apps.map((a) => {
          const [label, kind] = STATUS[a.status] || [a.status, ""];
          return el("tr", null,
            el("td", { "data-label": "申請人" }, el("b", { text: a.discord_name || "—" }),
              el("div", { class: "small " + (a.site_email ? "dc-email" : "muted"), text: a.site_email ? `網站：${a.site_email}` : "網站還沒填這個 UID" }),
              el("div", { class: "small muted num", text: A.fmtRel(a.created_at) })),
            el("td", { "data-label": "交易所／UID（UM 是帳號）" }, el("span", { text: exName(a.exchange) }), el("div", { class: "small muted num", text: a.exchange_uid })),
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
    channelsCard(s),
    el("details", { class: "dc-more" }, el("summary", { class: "small", text: "進階設定（頻道 ID、身分組、一對一主講、邀請連結）" }),
      el("label", { class: "field" }, el("span", { class: "label", text: "通過後給的身分組 ID" }), idInput("dcRole", s.roleId, "例如 1560542923173400596")),
      el("label", { class: "field" }, el("span", { class: "label", text: "報名頻道 ID（放報名按鈕）" }), idInput("dcPanel", s.panelChannelId, "對頻道按右鍵 → 複製頻道 ID")),
      el("label", { class: "field" }, el("span", { class: "label", text: "審核頻道 ID（有人等審核時通知在這裡）" }), idInput("dcReview", s.reviewChannelId, "只有管理員看得到的頻道")),
      el("label", { class: "field" }, el("span", { class: "label", text: "客服身分組 ID（選填，看得到報名頻道、可以按通過）" }),
        el("input", { class: "input num", id: "dcStaff", type: "text", autocomplete: "off", maxlength: "120", value: (s.staffRoleIds || []).join(", "), placeholder: "多個用逗號分開" })),
      el("p", { class: "small muted", style: { marginTop: "12px" }, text: "一對一主講的 Discord 使用者 ID（選填）：有人選、改選、取消一對一時，在審核頻道 @ 他。對他的名字按右鍵 →「複製使用者 ID」。" }),
      ...ONE_ON_ONE_HOSTS.map((h) => el("label", { class: "field" }, el("span", { class: "label", text: h }), el("input", { class: "input num", type: "text", autocomplete: "off", maxlength: "20", "data-host": h, value: s.hostIds?.[h] || "", placeholder: "例如 1012345678901234567" }))),
      el("p", { class: "small muted", style: { marginTop: "12px" }, text: "邀請連結（選填）：會變成報名頻道下面的註冊按鈕，沒通過時也會附給報名的人" }),
      ...invites,
      save,
      post),
    supportCard(),
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
      const hostIds = {};
      box.querySelectorAll("input[data-host]").forEach((i) => { if (i.value.trim()) hostIds[i.dataset.host] = i.value.trim(); });
      const r = await api("/api/admin/discord", { method: "PATCH", body: {
        roleId: $("#dcRole").value.trim(), panelChannelId: $("#dcPanel").value.trim(), reviewChannelId: $("#dcReview").value.trim(), staffRoleIds: $("#dcStaff").value.trim(), invites: inv, hostIds,
      } });
      dc.settings = r.settings;
      A.toast(r.synced === false ? "已儲存，但客服身分組的頻道權限沒更新成功，請按一次「一鍵建立 Discord 頻道」" : r.panelUpdated === false ? "已儲存，但報名按鈕那則沒更新成功，請按「重新張貼報名按鈕」" : r.panelUpdated ? "已儲存，報名頻道的註冊按鈕也更新了" : "已儲存 Discord 設定");
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

// 客服中心（取代 Ticket Tool）：一鍵建立、最近的客服單
const TOPIC = { member: "🧪 培訓計畫", exchange: "💱 交易所", site: "💻 網站", biz: "🤝 合作", other: "💬 其他" };
function supportCard() {
  const s = dc.settings;
  const btn = el("button", { class: "btn primary block", type: "button", id: "dcSupport", style: { marginTop: "10px" } }, s.supportPanelChannelId ? "重新設定客服中心" : "一鍵建立客服中心");
  btn.addEventListener("click", async () => {
    A.setBusy(btn, true, "建立中…");
    try {
      const r = await api("/api/admin/discord", { method: "POST", body: { action: "support" } });
      dc.settings = r.settings;
      A.toast(r.created.length ? `建立了：${r.created.join("、")}` : "客服中心的頻道和權限都設定好了，開單選單也更新了");
      renderSettings();
    } catch (e) {
      A.setBusy(btn, false);
      fail(e);
    }
  });
  const link = (ch) => (s.guildId ? `https://discord.com/channels/${s.guildId}/${ch}` : null);
  const rows = (dc.support || []).map((t) => el("div", { class: "dc-ticket" },
    el("div", { class: "grow" },
      el("b", { text: `#${String(t.no || 0).padStart(4, "0")} ${t.subject || ""}` }),
      el("div", { class: "small muted", text: `${TOPIC[t.topic] || "💬"}・${t.discord_name || "—"}・${A.fmtRel(t.created_at)}${t.claimed_by ? `・${t.claimed_by} 處理` : ""}` })),
    t.status === "open"
      ? (link(t.channel_id) ? el("a", { class: "pill brass", href: link(t.channel_id), target: "_blank", rel: "noopener" }, el("span", { class: "dot" }), "處理中") : el("span", { class: "pill brass" }, el("span", { class: "dot" }), "處理中"))
      : el("span", { class: "pill" }, el("span", { class: "dot" }), "已結案")));
  return el("div", { class: "dc-support" },
    el("h3", { text: "客服中心（取代 Ticket Tool）" }),
    el("p", { class: "small sub", text: "研究員在「🎫客服中心」選要問的類型、填主旨和說明，機器人開一個只有他和客服身分組看得到的私人頻道。客服按「我來處理」接手，處理完按「關閉客服單」，完整對話會存到「📋客服紀錄」並私訊給他。" }),
    btn,
    s.supportPanelChannelId ? el("p", { class: "small dc-ok", style: { marginTop: "8px" } }, icon("ok"), "客服中心已經建立；確認沒問題後可以把 Ticket Tool 移出伺服器。") : null,
    rows.length ? el("div", { class: "dc-tickets" }, el("p", { class: "small muted", text: "最近的客服單" }), ...rows) : null);
}

// 機器人要貼到哪：直播精華、升級慶祝（獨立一塊，不用打開進階設定）
function channelsCard(s) {
  const hl = idInput("dcHighlight", s.highlightChannelId, "對頻道按右鍵 → 複製頻道 ID");
  const cel = idInput("dcCelebrate", s.celebrateChannelId, "對頻道按右鍵 → 複製頻道 ID");
  const save = el("button", { class: "btn primary", type: "button", text: "儲存這兩個頻道" });
  save.addEventListener("click", async () => {
    A.setBusy(save, true, "儲存中…");
    try {
      const r = await api("/api/admin/discord", { method: "PATCH", body: { highlightChannelId: hl.value.trim(), celebrateChannelId: cel.value.trim() } });
      dc.settings = r.settings;
      A.toast("已儲存");
    } catch (e) {
      fail(e);
    }
    A.setBusy(save, false);
  });
  return el("div", { class: "dc-channels", id: "dcChannels" },
    el("h3", { text: "機器人貼文的頻道" }),
    el("label", { class: "field" }, el("span", { class: "label", text: "✨ 直播精華頻道 ID" }), hl,
      el("span", { class: "hint", text: "直播上架後，自動整理的摘要、重點、章節貼在這裡。建議用只有研究員看得到的頻道。空白＝不貼。" })),
    el("label", { class: "field" }, el("span", { class: "label", text: "🎉 升級慶祝頻道 ID" }), cel,
      el("span", { class: "hint", text: "研究員升級後按「分享到 Discord」貼在這裡（例如研究員大廳）。空白＝升級畫面不出現分享按鈕。" })),
    save);
}
