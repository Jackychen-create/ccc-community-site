// Discord 申請流程的訊息長相（按鈕、選單、表單、結果）。只組資料，不打 API，方便測試
// 流程（像 Ticket Tool）：申請頻道按「申請加入實驗室」→ 機器人開一個只有他和管理員看得到的私人頻道
//   → 在私人頻道選交易所、填 UID
//   → Bybit、BingX：機器人直接問交易所是不是 CCC 邀請的，是就給身分組，並在頻道裡給實驗室密碼
//   → OKX、UM（或交易所暫時查不到）：在同一個頻道請管理員按「通過／不通過」，通過一樣自動給身分組和實驗室密碼
import { EXCHANGES } from "../../public/assets/js/shared/rules.js";

export const T = { PONG: 1, MESSAGE: 4, DEFER: 5, UPDATE: 7, MODAL: 9 }; // 回應類型
export const EPHEMERAL = 64; // 只有按的人看得到
export const APP_UID_RE = /^\d{5,20}$/; // OKX 的 UID 比較長，UM 是 MT5 帳號
export const SITE_URL = "https://ccc-community-site.pages.dev";

const EX_HINT = {
  OKX: "OKX 的 UID（個人中心可以看到）",
  UM: "UM 的 MT5 交易帳號",
  Bybit: "Bybit 主帳號的 UID",
  BingX: "BingX 的 UID",
};
export const exLabel = (ex) => (ex === "UM" ? "UM（Ultima Markets）" : ex);
export const cleanUid = (v) => String(v || "").replace(/\s/g, "");

const closeBtn = { type: 2, style: 2, custom_id: "close_ticket", label: "關閉這個頻道" };
const exchangeRow = () => ({
  type: 1,
  components: [{
    type: 3, custom_id: "apply_ex", placeholder: "選擇交易所",
    options: EXCHANGES.map((ex) => ({ label: exLabel(ex), value: ex, description: EX_HINT[ex] })),
  }],
});

// 申請頻道上的固定訊息
export function panelMessage() {
  return {
    content: [
      "## 申請加入 CCC 交易實驗室 🧪",
      "按下面的按鈕，機器人會幫你開一個**只有你和管理員看得到的申請頻道**。",
      "在頻道裡選你用 CCC 邀請連結註冊的交易所、填 UID：",
      "• Bybit、BingX：幾秒鐘自動確認，通過就給你實驗室身分組和實驗室密碼",
      "• OKX、UM：管理員確認後通過，一樣在頻道裡給你",
    ].join("\n"),
    components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: "apply", label: "申請加入實驗室", emoji: { name: "🧪" } }] }],
    allowed_mentions: { parse: [] },
  };
}

// 私人頻道開好後的第一則：歡迎、選交易所、關閉
export function ticketWelcome(userId) {
  return {
    content: [
      `<@${userId}> 歡迎！這個頻道只有你和管理員看得到。`,
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
      title: `申請加入實驗室：${ex}`,
      components: [{ type: 1, components: [{ type: 4, custom_id: "uid", style: 1, label: EX_HINT[ex] || `${ex} UID`, min_length: 5, max_length: 24, required: true, placeholder: "例如 12345678" }] }],
    },
  };
}

export const reply = (content, extra = {}) => ({ type: T.MESSAGE, data: { flags: EPHEMERAL, content, allowed_mentions: { parse: [] }, ...extra } });

// 通過：身分組＋實驗室密碼＋加入連結
// code：這個人專用的實驗室密碼（只能用一次）
export function approvedMessage({ userId, roleId, code, by = "", labChannelId = "" }) {
  const lines = [
    `✅ <@${userId}> 審核通過！已經給你 <@&${roleId}> 身分組。${by ? `（${by}）` : ""}`,
  ];
  if (code) {
    lines.push(
      "", "接著到網站註冊研究員專區（註冊時選同一間交易所、填同一個 UID）：",
      `你的實驗室密碼：**${code}**（只能用一次，請不要給別人）`,
      `加入連結：${SITE_URL}/?invite=${code}`,
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
      `<@${userId}> 你的 ${exLabel(ex)} 申請沒有通過。請確認是用 CCC 的邀請連結註冊、UID 填對，再在下面重新選一次。`,
      invite ? `邀請連結：${invite}` : "",
    ].filter(Boolean).join("\n"),
    components: [exchangeRow(), { type: 1, components: [closeBtn] }],
    allowed_mentions: { users: [userId] },
  };
}

const STATUS_TEXT = { pending: "⏳ 等待管理員審核", approved: "✅ 已通過", rejected: "❌ 不通過" };

// 要管理員看的申請（OKX、UM，或自動確認不了的）：在私人頻道裡，附「通過／不通過」
export function reviewMessage(app, { reason = "", reviewer = "" } = {}) {
  const lines = [
    `**實驗室申請 #${app.id}**　${STATUS_TEXT[app.status] || app.status}`,
    `申請人：<@${app.discord_user_id}>（${app.discord_name || "?"}）`,
    `交易所：${exLabel(app.exchange)}`,
    `UID：\`${app.exchange_uid}\``,
  ];
  if (reason) lines.push(`說明：${reason}`);
  if (app.status !== "pending" && reviewer) lines.push(`審核：${reviewer}`);
  if (app.status === "pending") lines.push("", "管理員請到交易所的代理後台確認這個 UID 是 CCC 邀請的，再按下面的按鈕。申請人請稍等，通過後會在這裡給你實驗室密碼。");
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

// 通知管理員有人在等（審核頻道，沒設定就發在申請頻道裡）；有設定客服身分組就提及他們
export function reviewNotice(app, channelId, staffRoleIds = []) {
  const ping = staffRoleIds.length ? staffRoleIds.map((r) => `<@&${r}>`).join(" ") + " " : "";
  return {
    content: `${ping}🔔 新的 ${exLabel(app.exchange)} 申請等待審核：<@${app.discord_user_id}> → <#${channelId}>`,
    allowed_mentions: { roles: staffRoleIds },
  };
}

// 給申請人看的簡短結果（只有自己看得到的那種）
export function resultText(kind, { ex, invite } = {}) {
  const inv = invite ? `\n邀請連結：${invite}` : "";
  switch (kind) {
    case "already_pending":
      return "你已經有一筆申請在審核中了，請耐心等候。";
    case "already_member":
      return "你已經有實驗室的身分組了，不用再申請 🙂";
    case "uid_taken":
      return "這個 UID 已經被其他人用來申請過了。如果是你本人，請在頻道裡告訴管理員。";
    case "bad_uid":
      return "UID 是一串數字，請再確認一次。";
    case "not_owner":
      return "這是別人的申請頻道，只有申請人可以操作。";
    case "no_ticket":
      return "請先到申請頻道按「申請加入實驗室」，機器人會幫你開一個申請頻道。";
    case "rejected":
      return `你的實驗室申請（${ex}）沒有通過。請確認是用 CCC 的邀請連結註冊、UID 填對，再重新申請。${inv}`;
    default:
      return "發生錯誤，請稍後再試。";
  }
}
