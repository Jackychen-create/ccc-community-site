// Discord 申請流程的訊息長相（按鈕、選單、表單、結果）。只組資料，不打 API，方便測試
// 流程（像 Ticket Tool）：報名頻道按「報名培訓計畫」→ 機器人開一個只有他和管理員看得到的私人頻道
//   → 在私人頻道選交易所、填 UID
//   → OKX、Bybit、BingX：機器人直接問交易所是不是 CCC 邀請的，是就給身分組，並在頻道裡給實驗室密碼
//   → 交易所暫時查不到：在同一個頻道請管理員按「通過／不通過」，通過一樣自動給身分組和實驗室密碼
//   （UM 2026-11-16 撤掉）
import { EXCHANGES, needsName } from "../../public/assets/js/shared/rules.js";

export const T = { PONG: 1, MESSAGE: 4, DEFER: 5, UPDATE: 7, MODAL: 9 }; // 回應類型
export const EPHEMERAL = 64; // 只有按的人看得到
export const SITE_URL = "https://ccc-community-site.pages.dev";
// 實驗室培訓房（研究員專區）：2026-11-23 起跟介紹網站（首頁）分開，在 /lab
export const LAB_URL = `${SITE_URL}/lab`;

const EX_HINT = {
  OKX: "OKX 的 UID（個人中心可以看到）",
  Bybit: "Bybit 主帳號的 UID",
  BingX: "BingX 的 UID",
};
export const exLabel = (ex) => ex;

const closeBtn = { type: 2, style: 2, custom_id: "close_ticket", label: "關閉這個頻道" };
const exchangeRow = () => ({
  type: 1,
  components: [{
    type: 3, custom_id: "apply_ex", placeholder: "選擇交易所",
    options: EXCHANGES.map((ex) => ({ label: exLabel(ex), value: ex, description: EX_HINT[ex] })),
  }],
});

// 報名頻道上的固定訊息
// invites：各交易所的邀請連結（後台「Discord 審核」→ 進階設定）；有填的會在下面多一排註冊按鈕
const SIGNUP_LABEL = { OKX: "OKX 註冊", Bybit: "Bybit 註冊", BingX: "BingX 註冊" };
export function signupRow(invites = {}) {
  const btns = EXCHANGES.filter((ex) => /^https:\/\//.test(invites?.[ex] || "")).map((ex) => ({ type: 2, style: 5, label: SIGNUP_LABEL[ex] || ex, url: invites[ex] }));
  return btns.length ? { type: 1, components: btns.slice(0, 5) } : null;
}

export function panelMessage(invites = {}) {
  const signup = signupRow(invites);
  return {
    content: [
      "## 報名 CCC 實驗室培訓計畫 🧪",
      "按下面的按鈕，機器人會幫你開一個**只有你和管理員看得到的報名頻道**。",
      "在頻道裡選你用 CCC 邀請連結註冊的交易所（OKX、Bybit、BingX）、填 UID：",
      "• 幾秒鐘自動確認，通過就給你研究員身分組和實驗室密碼",
      "• 交易所暫時查不到的話，由管理員確認後通過，一樣在頻道裡給你",
      signup ? "\n還沒有交易所帳號？先用下面的 CCC 邀請連結註冊：" : "",
    ].filter(Boolean).join("\n"),
    components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: "apply", label: "報名培訓計畫", emoji: { name: "🧪" } }] }, ...(signup ? [signup] : [])],
    allowed_mentions: { parse: [] },
  };
}

// 私人頻道開好後的第一則：歡迎、選交易所、關閉
export function ticketWelcome(userId) {
  return {
    content: [
      `<@${userId}> 歡迎報名實驗室培訓計畫！這個頻道只有你和管理員看得到。`,
      "請在下面選你用 **CCC 邀請連結**註冊的交易所，接著填 UID。",
    ].join("\n"),
    components: [exchangeRow(), { type: 1, components: [closeBtn] }],
    allowed_mentions: { users: [userId] },
  };
}

// 選好交易所：填 UID 的表單
export function uidModal(ex) {
  return {
    type: T.MODAL,
    data: {
      custom_id: `apply_uid:${ex}`,
      title: `報名培訓計畫：${ex}`,
      components: [
        { type: 1, components: [{ type: 4, custom_id: "uid", style: 1, label: EX_HINT[ex] || `${ex} UID`, min_length: 5, max_length: 24, required: true, placeholder: "例如 12345678" }] },
        // 要另外填開戶姓名的交易所（目前沒有；原本是 UM）
        ...(needsName(ex) ? [{ type: 1, components: [{ type: 4, custom_id: "account_name", style: 1, label: "開戶的英文姓名（跟護照一樣）", min_length: 2, max_length: 60, required: true, placeholder: "例如 WANG XIAO MING" }] }] : []),
      ],
    },
  };
}

export const reply = (content, extra = {}) => ({ type: T.MESSAGE, data: { flags: EPHEMERAL, content, allowed_mentions: { parse: [] }, ...extra } });

// 通過：身分組＋實驗室密碼＋加入連結
// code：這個人專用的實驗室密碼（只能用一次）
export function approvedMessage({ userId, roleId, code, by = "", labChannelId = "" }) {
  const lines = [
    `✅ <@${userId}> 審核通過，歡迎加入實驗室培訓計畫！已經給你 <@&${roleId}> 身分組。${by ? `（${by}）` : ""}`,
  ];
  if (code) {
    lines.push(
      "", "接著到網站註冊研究員專區（註冊時選同一間交易所、填同一個 UID）：",
      `你的實驗室密碼：**${code}**（只能用一次，請不要給別人）`,
      `加入連結：${LAB_URL}?invite=${code}`,
    );
  } else {
    lines.push("實驗室密碼管理員會再給你，請稍等。");
  }
  if (labChannelId) lines.push("", `之後的公告在 <#${labChannelId}>。`);
  lines.push("", "註冊好之後可以按下面的按鈕關閉這個頻道（實驗室密碼也會私訊給你一份）。");
  return { content: lines.join("\n"), components: [{ type: 1, components: [closeBtn] }], allowed_mentions: { users: [userId] } };
}

// 不是 CCC 邀請的：說明、附邀請連結、可以重選
export function notInvitedMessage({ ex, invite }) {
  return {
    content: [
      `❌ 這個 UID 不是用 CCC 的 ${ex} 邀請連結註冊的${ex === "Bybit" ? "（Bybit 要填主帳號的 UID）" : ""}。`,
      "請確認 UID，或用邀請連結重新註冊後，在下面重新選一次。",
      invite ? `邀請連結：${invite}` : "",
    ].filter(Boolean).join("\n"),
    components: [exchangeRow(), { type: 1, components: [closeBtn] }],
    allowed_mentions: { parse: [] },
  };
}

// 管理員按「不通過」：告訴申請人，可以重選
export function rejectedMessage({ userId, ex, invite }) {
  return {
    content: [
      `<@${userId}> 你的培訓計畫報名（${exLabel(ex)}）沒有通過。請確認是用 CCC 的邀請連結註冊、UID 填對，再在下面重新選一次。`,
      invite ? `邀請連結：${invite}` : "",
    ].filter(Boolean).join("\n"),
    components: [exchangeRow(), { type: 1, components: [closeBtn] }],
    allowed_mentions: { users: [userId] },
  };
}

const STATUS_TEXT = { pending: "⏳ 等待管理員審核", approved: "✅ 已通過", rejected: "❌ 不通過" };

// 要管理員看的申請（自動確認不了的）：在私人頻道裡，附「通過／不通過」
export function reviewMessage(app, { reason = "", reviewer = "" } = {}) {
  const lines = [
    `**培訓計畫報名 #${app.id}**　${STATUS_TEXT[app.status] || app.status}`,
    `報名者：<@${app.discord_user_id}>（${app.discord_name || "?"}）`,
    `交易所：${exLabel(app.exchange)}`,
    `UID：\`${app.exchange_uid}\``,
  ];
  if (app.account_name) lines.push(`姓名：\`${app.account_name}\``);
  if (reason) lines.push(`說明：${reason}`);
  if (app.status !== "pending" && reviewer) lines.push(`審核：${reviewer}`);
  if (app.status === "pending") lines.push("", "管理員請到交易所的代理後台確認這個 UID 是 CCC 邀請的，再按下面的按鈕。報名的人請稍等，通過後會在這裡給你實驗室密碼。");
  return {
    content: lines.join("\n"),
    components: app.status === "pending"
      ? [{ type: 1, components: [
          { type: 2, style: 3, custom_id: `approve:${app.id}`, label: "通過，給身分組" },
          { type: 2, style: 4, custom_id: `reject:${app.id}`, label: "不通過" },
        ] }]
      : [],
    allowed_mentions: { parse: [] },
  };
}

// 通知管理員有人在等（審核頻道，沒設定就發在報名頻道裡）；有設定客服身分組就提及他們
export function reviewNotice(app, channelId, staffRoleIds = []) {
  const ping = staffRoleIds.length ? staffRoleIds.map((r) => `<@&${r}>`).join(" ") + " " : "";
  return {
    content: `${ping}🔔 新的 ${exLabel(app.exchange)} 報名等待審核：<@${app.discord_user_id}> → <#${channelId}>`,
    allowed_mentions: { roles: staffRoleIds },
  };
}

// 給申請人看的簡短結果（只有自己看得到的那種）
export function resultText(kind, { ex, invite } = {}) {
  const inv = invite ? `\n邀請連結：${invite}` : "";
  switch (kind) {
    case "already_pending":
      return "你已經有一筆報名在審核中了，請耐心等候。";
    case "already_member":
      return "你已經加入培訓計畫了，不用再報名 🙂";
    case "uid_taken":
      return "這個 UID 已經被其他人用來報名過了。如果是你本人，請在頻道裡告訴管理員。";
    case "bad_name":
      return "請填開戶的英文姓名（跟護照一樣，例如 WANG XIAO MING）。";
    case "bad_uid":
      return "UID 是一串數字，請再確認一次。";
    case "not_owner":
      return "這是別人的報名頻道，只有報名的人可以操作。";
    case "no_ticket":
      return "請先到報名頻道按「報名培訓計畫」，機器人會幫你開一個報名頻道。";
    case "rejected":
      return `你的培訓計畫報名（${ex}）沒有通過。請確認是用 CCC 的邀請連結註冊、UID 填對，再重新報名。${inv}`;
    default:
      return "發生錯誤，請稍後再試。";
  }
}
