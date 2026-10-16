// Discord 申請流程的訊息長相（按鈕、選單、表單、審核訊息）。只組資料，不打 API，方便測試
// 流程：申請頻道的「申請加入實驗室」按鈕 → 選交易所 → 填 UID
//       → Bybit、BingX：機器人直接問交易所是不是 CCC 邀請的，是就給身分組
//       → OKX、UM（或交易所暫時查不到）：送到審核頻道，管理員按「通過／不通過」
import { EXCHANGES } from "../../public/assets/js/shared/rules.js";

export const T = { PONG: 1, MESSAGE: 4, DEFER: 5, UPDATE: 7, MODAL: 9 }; // 回應類型
export const EPHEMERAL = 64; // 只有按的人看得到
export const APP_UID_RE = /^\d{5,20}$/; // OKX 的 UID 比較長，UM 是 MT5 帳號

const EX_HINT = {
  OKX: "OKX 的 UID（個人中心可以看到）",
  UM: "UM 的 MT5 交易帳號",
  Bybit: "Bybit 主帳號的 UID",
  BingX: "BingX 的 UID",
};
export const exLabel = (ex) => (ex === "UM" ? "UM（Ultima Markets）" : ex);
export const cleanUid = (v) => String(v || "").replace(/\s/g, "");

// 申請頻道上的固定訊息
export function panelMessage() {
  return {
    content: [
      "## 申請加入 CCC 交易實驗室",
      "用 CCC 邀請連結註冊交易所的朋友，按下面的按鈕、選交易所、填 UID 就可以申請。",
      "Bybit、BingX 會自動確認，幾秒鐘就好；OKX、UM 由管理員審核，通過後會私訊通知你。",
    ].join("\n"),
    components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: "apply", label: "申請加入實驗室", emoji: { name: "🧪" } }] }],
    allowed_mentions: { parse: [] },
  };
}

// 按了「申請」：選交易所（只有按的人看得到）
export function exchangeSelect() {
  return {
    type: T.MESSAGE,
    data: {
      flags: EPHEMERAL,
      content: "你是用哪一間交易所的 CCC 邀請連結註冊的？",
      components: [{
        type: 1,
        components: [{
          type: 3, custom_id: "apply_ex", placeholder: "選交易所",
          options: EXCHANGES.map((ex) => ({ label: exLabel(ex), value: ex, description: EX_HINT[ex] })),
        }],
      }],
    },
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

const STATUS_TEXT = { pending: "⏳ 等待審核", approved: "✅ 已通過", rejected: "❌ 不通過" };

// 審核頻道的訊息：誰、哪間、UID、為什麼要人工審，等待中就附上按鈕
export function reviewMessage(app, { reason = "", reviewer = "" } = {}) {
  const lines = [
    `**實驗室申請 #${app.id}**　${STATUS_TEXT[app.status] || app.status}`,
    `申請人：<@${app.discord_user_id}>（${app.discord_name || "?"}）`,
    `交易所：${exLabel(app.exchange)}`,
    `UID：\`${app.exchange_uid}\``,
  ];
  if (reason) lines.push(`說明：${reason}`);
  if (app.status !== "pending" && reviewer) lines.push(`審核：${reviewer}`);
  if (app.status === "pending") lines.push("請到交易所的代理後台確認這個 UID 是 CCC 邀請的，再按下面的按鈕。");
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

// 給申請人看的結果
export function resultText(kind, { ex, roleId, invite } = {}) {
  const inv = invite ? `\n邀請連結：${invite}` : "";
  switch (kind) {
    case "approved":
      return `✅ 審核通過！已經給你 <@&${roleId}> 身分組，到實驗室頻道就能拿到實驗室密碼。`;
    case "not_invited":
      return `這個 UID 不是用 CCC 的 ${ex} 邀請連結註冊的${ex === "Bybit" ? "（Bybit 要填主帳號的 UID）" : ""}。請確認 UID，或用邀請連結重新註冊後再申請。${inv}`;
    case "pending":
      return "已經送出申請，管理員確認後會私訊通知你（請打開「允許伺服器成員私訊」）。";
    case "already_pending":
      return "你已經有一筆申請在審核中了，請耐心等候。";
    case "already_member":
      return "你已經有實驗室的身分組了，不用再申請 🙂";
    case "uid_taken":
      return "這個 UID 已經被其他人用來申請過了。如果是你本人，請開工單找管理員。";
    case "bad_uid":
      return "UID 是一串數字，請再確認一次。";
    case "rejected":
      return `你的實驗室申請（${ex}）沒有通過。請確認是用 CCC 的邀請連結註冊、UID 填對，再重新申請；有問題可以開工單找管理員。${inv}`;
    default:
      return "發生錯誤，請稍後再試。";
  }
}
