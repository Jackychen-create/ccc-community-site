// Discord 機器人的入口：Discord 把按鈕、選單、表單的操作送到這裡
// POST /api/discord/interactions   （Discord Developer Portal 的 Interactions Endpoint URL 填這個網址）
// 每個請求都先驗 Ed25519 簽名；3 秒內要回應，要開頻道或問交易所的先回「處理中」，背景做完再改訊息
// 流程（像 Ticket Tool）：
//   報名頻道按「報名培訓計畫」→ 開一個只有他和管理員看得到的報名頻道
//   → 在報名頻道選交易所、填 UID → Bybit、BingX 自動確認；OKX、UM 由管理員在同一個頻道按通過
//   → 通過：給身分組，在頻道裡給他專用的實驗室密碼（也私訊一份）→ 按「關閉這個頻道」
import {
  supabaseAdmin, route, AUTO_EXCHANGES, EXCHANGES, PROVIDERS,
  discordConfigured, verifyDiscord, getDiscordSettings, addRole, sendMessage, editOriginal, dm, canReview, cleanExId, exIdOk, needsName, cleanAccountName, accountNameOk,
} from "../lib/index.js";
import {
  T, EPHEMERAL, uidModal, reply, reviewMessage, reviewNotice, resultText,
  approvedMessage, notInvitedMessage, rejectedMessage,
} from "../lib/discord-flow.js";
import { openTicket, ticketOf, closeTicket, personalCode } from "../lib/discord-ticket.js";

const nameOf = (u) => u?.global_name || u?.username || "";
const errText = (e) => String(e?.message || e).slice(0, 80);
export const CLOSE_DELAY_MS = { value: 4000 }; // 按關閉後幾秒刪頻道（測試會改短）

// 表單裡找某個欄位（不管外面包幾層）
function fieldValue(components, id) {
  for (const c of components || []) {
    if (c.custom_id === id && typeof c.value === "string") return c.value;
    const inner = fieldValue(c.components || (c.component ? [c.component] : []), id);
    if (inner !== null) return inner;
  }
  return null;
}

async function insertApp(row) {
  const { data, error } = await supabaseAdmin.from("discord_applications").insert(row).select("*").single();
  if (error) throw error;
  return data;
}

// 通過之後：產生這個人專用的實驗室密碼，記在申請上，私訊一份備份
async function grantCode(s, app) {
  let code = "";
  try {
    code = await personalCode({ name: app.discord_name, exchange: app.exchange, uid: app.exchange_uid });
    await supabaseAdmin.from("discord_applications").update({ invite_code: code }).eq("id", app.id);
  } catch (e) {
    console.error("discord personal code failed", e?.message);
    code = "";
  }
  if (code) await dm(app.discord_user_id, `CCC 實驗室培訓計畫審核通過 🎉\n你的實驗室密碼：${code}（只能用一次）\n加入連結：https://ccc-community-site.pages.dev/?invite=${code}`);
  return code;
}

// 按「報名培訓計畫」之後（背景）：開報名頻道，把連結回給他
async function processOpen({ i, s, user }) {
  try {
    const { channelId, created } = await openTicket({ guildId: i.guild_id, user, name: nameOf(user), s });
    await editOriginal(i.token, { content: created ? `已經幫你開好報名頻道：<#${channelId}>，請到那裡選交易所、填 UID。` : `你已經有一個報名頻道了：<#${channelId}>`, allowed_mentions: { parse: [] } });
  } catch (e) {
    console.error("discord open ticket failed", e?.status, e?.message);
    await editOriginal(i.token, { content: "開報名頻道失敗，請稍後再試，或私訊管理員。", allowed_mentions: { parse: [] } }).catch(() => {});
  }
}

// 送出 UID 之後（背景）：Bybit、BingX 先自動確認；其他、或自動確認不了的，交給管理員
async function processApplication({ i, s, ex, uid, accountName, user, channelId }) {
  const base = { discord_user_id: user.id, discord_name: nameOf(user), exchange: ex, exchange_uid: uid, account_name: accountName || null, channel_id: channelId };
  const done = (payload) => editOriginal(i.token, payload).catch((e) => console.error("discord edit failed", e?.message));
  try {
    let reason = "";
    const p = PROVIDERS[ex];
    if (AUTO_EXCHANGES.includes(ex) && p?.configured()) {
      let check = null;
      try {
        check = await p.check(uid);
      } catch (e) {
        console.error(`${ex} check failed (discord)`, e?.code, e?.message);
        reason = `${ex} 暫時查不到（${errText(e)}），請手動確認`;
      }
      if (check && !check.invited) {
        await insertApp({ ...base, status: "rejected", auto: true, reviewed_by: `${ex} 自動確認`, reviewed_at: new Date().toISOString(), note: "不是 CCC 邀請的" });
        return done(notInvitedMessage({ ex, invite: s.invites?.[ex] }));
      }
      if (check?.invited) {
        try {
          await addRole(i.guild_id, user.id, s.roleId);
          const app = await insertApp({ ...base, status: "approved", auto: true, reviewed_by: `${ex} 自動確認`, reviewed_at: new Date().toISOString() });
          const code = await grantCode(s, app);
          return done(approvedMessage({ userId: user.id, roleId: s.roleId, code, by: `${ex} 自動確認`, labChannelId: s.labChannelId }));
        } catch (e) {
          console.error("discord addRole failed", e?.message);
          reason = `${ex} 確認是 CCC 邀請的，但機器人給身分組失敗（${errText(e)}）。請檢查機器人權限，或手動按通過`;
        }
      }
    } else if (AUTO_EXCHANGES.includes(ex)) {
      reason = `${ex} 自動確認還沒設定，請手動確認`;
    }
    const app = await insertApp({ ...base, status: "pending", note: reason || null });
    const msg = await done(reviewMessage(app, { reason }));
    await supabaseAdmin.from("discord_applications").update({ review_message_id: msg?.id || null }).eq("id", app.id);
    // 通知管理員：有審核頻道就發在那裡，不然發在報名頻道裡
    const staff = s.staffRoleIds || [];
    if (s.reviewChannelId || staff.length) {
      await sendMessage(s.reviewChannelId || channelId, reviewNotice(app, channelId, staff)).catch((e) => console.error("discord notice failed", e?.message));
    }
  } catch (e) {
    console.error("discord apply failed", e?.message);
    return done({ content: "送出申請時發生錯誤，請稍後再試，或在這裡留言給管理員。", allowed_mentions: { parse: [] } });
  }
}

// 管理員按「通過／不通過」
async function review(req, res, i, s, action, id) {
  if (!canReview(i.member, s.staffRoleIds || [])) return res.status(200).json(reply("只有管理員可以審核。"));
  const reviewer = nameOf(i.member?.user);
  const { data: app } = await supabaseAdmin.from("discord_applications").select("*").eq("id", id).maybeSingle();
  if (!app) return res.status(200).json(reply("找不到這筆申請。"));
  if (app.status !== "pending") return res.status(200).json({ type: T.UPDATE, data: reviewMessage(app, { reviewer: app.reviewed_by, reason: app.note }) });

  if (action === "approve") {
    try {
      await addRole(i.guild_id, app.discord_user_id, s.roleId);
    } catch (e) {
      return res.status(200).json(reply(`給身分組失敗：${String(e?.message || e).slice(0, 150)}\n請確認機器人有「管理身分組」權限，而且機器人的身分組排在 <@&${s.roleId}> 上面。`));
    }
  }
  const status = action === "approve" ? "approved" : "rejected";
  const { data: updated } = await supabaseAdmin.from("discord_applications")
    .update({ status, reviewed_by: reviewer, reviewed_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").select("*").maybeSingle();
  if (!updated) { // 另一位管理員剛好同時按了
    const { data: now } = await supabaseAdmin.from("discord_applications").select("*").eq("id", id).maybeSingle();
    return res.status(200).json({ type: T.UPDATE, data: reviewMessage(now || app, { reviewer: now?.reviewed_by, reason: app.note }) });
  }
  // 結果發在報名頻道裡（舊的申請沒有頻道就私訊）
  const target = app.channel_id || i.channel_id;
  req.waitUntil?.((async () => {
    try {
      if (status === "approved") {
        const code = await grantCode(s, updated);
        const msg = approvedMessage({ userId: app.discord_user_id, roleId: s.roleId, code, by: `審核：${reviewer}`, labChannelId: s.labChannelId });
        if (target) await sendMessage(target, msg); else await dm(app.discord_user_id, msg.content);
      } else {
        const msg = rejectedMessage({ userId: app.discord_user_id, ex: app.exchange, invite: s.invites?.[app.exchange] });
        if (target) await sendMessage(target, msg); else await dm(app.discord_user_id, resultText("rejected", { ex: app.exchange, invite: s.invites?.[app.exchange] }));
      }
    } catch (e) {
      console.error("discord review notify failed", e?.message);
    }
  })());
  return res.status(200).json({ type: T.UPDATE, data: reviewMessage(updated, { reviewer, reason: app.note }) });
}

export default route({
  async POST(req, res) {
    if (!discordConfigured()) return res.status(503).json({ error: "Discord 機器人還沒設定" });
    const ok = await verifyDiscord(req.rawBody || "", req.headers["x-signature-ed25519"], req.headers["x-signature-timestamp"]);
    if (!ok) return res.status(401).json({ error: "invalid request signature" });
    const i = req.body || {};
    if (i.type === 1) return res.status(200).json({ type: T.PONG });

    const s = await getDiscordSettings();
    const user = i.member?.user || i.user;
    if (!i.guild_id || !user) return res.status(200).json(reply("請在 CCC 的 Discord 伺服器裡使用。"));
    const hasRole = (i.member?.roles || []).includes(s.roleId);
    const channelId = i.channel_id || i.channel?.id || "";
    const id = i.data?.custom_id || "";

    // 報名頻道裡的操作：只有申請人可以（管理員也可以關頻道）
    const ownTicket = async () => {
      const t = await ticketOf(channelId);
      if (!t || t.status !== "open") return { error: reply(resultText("no_ticket")) };
      if (t.discord_user_id !== user.id) return { error: reply(resultText("not_owner")) };
      return { ticket: t };
    };

    // 按鈕、選單
    if (i.type === 3) {
      if (id === "apply") {
        if (hasRole) return res.status(200).json(reply(resultText("already_member")));
        req.waitUntil?.(processOpen({ i, s, user }));
        return res.status(200).json({ type: T.DEFER, data: { flags: EPHEMERAL } });
      }
      if (id === "apply_ex") {
        const ex = i.data?.values?.[0];
        if (!EXCHANGES.includes(ex)) return res.status(200).json(reply("請重新選一次交易所。"));
        const { error } = await ownTicket();
        if (error) return res.status(200).json(error);
        return res.status(200).json(uidModal(ex));
      }
      if (id === "close_ticket") {
        const t = await ticketOf(channelId);
        if (!t || t.status !== "open") return res.status(200).json(reply("這個頻道已經關閉了。"));
        if (t.discord_user_id !== user.id && !canReview(i.member, s.staffRoleIds || [])) return res.status(200).json(reply(resultText("not_owner")));
        req.waitUntil?.(new Promise((r) => setTimeout(r, CLOSE_DELAY_MS.value))
          .then(() => closeTicket(channelId, nameOf(user)))
          .catch((e) => console.error("discord close failed", e?.message)));
        return res.status(200).json({ type: T.MESSAGE, data: { content: `🔒 ${nameOf(user)} 關閉了這個報名頻道，幾秒後會刪除。`, allowed_mentions: { parse: [] } } });
      }
      const m = /^(approve|reject):(\d+)$/.exec(id);
      if (m) return review(req, res, i, s, m[1], Number(m[2]));
    }

    // 填完 UID 送出
    if (i.type === 5 && /^apply_uid:/.test(id)) {
      const ex = id.split(":")[1];
      if (!EXCHANGES.includes(ex)) return res.status(200).json(reply("請重新選一次交易所。"));
      const { error } = await ownTicket();
      if (error) return res.status(200).json(error);
      const uid = cleanExId(ex, fieldValue(i.data.components, "uid"));
      if (!exIdOk(ex, uid)) return res.status(200).json(reply(resultText("bad_uid")));
      const accountName = needsName(ex) ? cleanAccountName(fieldValue(i.data.components, "account_name")) : null;
      if (needsName(ex) && !accountNameOk(accountName)) return res.status(200).json(reply(resultText("bad_name")));
      if (hasRole) return res.status(200).json(reply(resultText("already_member")));
      const [{ data: mine }, { data: taken }] = await Promise.all([
        supabaseAdmin.from("discord_applications").select("id").eq("discord_user_id", user.id).eq("status", "pending").limit(1),
        supabaseAdmin.from("discord_applications").select("discord_user_id").eq("exchange", ex).eq("exchange_uid", uid).eq("status", "approved").neq("discord_user_id", user.id).limit(1),
      ]);
      if (mine?.length) return res.status(200).json(reply(resultText("already_pending")));
      if (taken?.length) return res.status(200).json(reply(resultText("uid_taken")));
      req.waitUntil?.(processApplication({ i, s, ex, uid, accountName, user, channelId }));
      return res.status(200).json({ type: T.DEFER }); // 大家都看得到的「處理中」，結果直接留在報名頻道
    }

    return res.status(200).json(reply("這個按鈕已經失效了，請重新按一次「報名培訓計畫」。"));
  },
});
