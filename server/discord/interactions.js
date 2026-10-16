// Discord 機器人的入口：Discord 把按鈕、選單、表單的操作送到這裡
// POST /api/discord/interactions   （Discord Developer Portal 的 Interactions Endpoint URL 填這個網址）
// 每個請求都先驗 Ed25519 簽名；3 秒內要回應，需要問交易所的先回「處理中」，背景做完再改訊息
import {
  supabaseAdmin, route, AUTO_EXCHANGES, EXCHANGES, PROVIDERS,
  discordConfigured, verifyDiscord, getDiscordSettings, addRole, sendMessage, editOriginal, dm, canReview,
} from "../lib/index.js";
import { T, EPHEMERAL, APP_UID_RE, cleanUid, exchangeSelect, uidModal, reply, reviewMessage, resultText } from "../lib/discord-flow.js";

const nameOf = (u) => u?.global_name || u?.username || "";

// 表單裡找某個欄位（不管外面包幾層）
function fieldValue(components, id) {
  for (const c of components || []) {
    if (c.custom_id === id && typeof c.value === "string") return c.value;
    const inner = fieldValue(c.components || (c.component ? [c.component] : []), id);
    if (inner !== null) return inner;
  }
  return null;
}

async function postReview(s, app, reason) {
  if (!s.reviewChannelId) throw new Error("還沒設定審核頻道");
  const msg = await sendMessage(s.reviewChannelId, reviewMessage(app, { reason }));
  await supabaseAdmin.from("discord_applications").update({ review_message_id: msg?.id || null, note: reason || null }).eq("id", app.id);
}

async function insertApp(row) {
  const { data, error } = await supabaseAdmin.from("discord_applications").insert(row).select("*").single();
  if (error) throw error;
  return data;
}

// 送出 UID 之後（背景）：Bybit、BingX 先自動確認；其他、或自動確認不了的，交給管理員
async function processApplication({ i, s, ex, uid, user }) {
  const base = { discord_user_id: user.id, discord_name: nameOf(user), exchange: ex, exchange_uid: uid };
  const done = (content) => editOriginal(i.token, { content, allowed_mentions: { parse: [] } }).catch((e) => console.error("discord edit failed", e?.message));
  try {
    let reason = "";
    const p = PROVIDERS[ex];
    if (AUTO_EXCHANGES.includes(ex) && p?.configured()) {
      let check = null;
      try {
        check = await p.check(uid);
      } catch (e) {
        console.error(`${ex} check failed (discord)`, e?.code, e?.message);
        reason = `${ex} 暫時查不到（${String(e?.message || e).slice(0, 80)}），請手動確認`;
      }
      if (check && !check.invited) {
        await insertApp({ ...base, status: "rejected", auto: true, reviewed_by: `${ex} 自動確認`, reviewed_at: new Date().toISOString(), note: "不是 CCC 邀請的" });
        return done(resultText("not_invited", { ex, invite: s.invites?.[ex] }));
      }
      if (check?.invited) {
        try {
          await addRole(i.guild_id, user.id, s.roleId);
          await insertApp({ ...base, status: "approved", auto: true, reviewed_by: `${ex} 自動確認`, reviewed_at: new Date().toISOString() });
          return done(resultText("approved", { roleId: s.roleId }));
        } catch (e) {
          console.error("discord addRole failed", e?.message);
          reason = `${ex} 確認是 CCC 邀請的，但機器人給身分組失敗（${String(e?.message || e).slice(0, 80)}）。請檢查機器人權限，或手動按通過`;
        }
      }
    } else if (AUTO_EXCHANGES.includes(ex)) {
      reason = `${ex} 自動確認還沒設定，請手動確認`;
    }
    const app = await insertApp({ ...base, status: "pending" });
    await postReview(s, app, reason);
    return done(resultText("pending"));
  } catch (e) {
    console.error("discord apply failed", e?.message);
    return done("送出申請時發生錯誤，請稍後再試，或開工單找管理員。");
  }
}

// 管理員按「通過／不通過」
async function review(req, res, i, s, action, id) {
  if (!canReview(i.member)) return res.status(200).json(reply("只有管理員可以審核。"));
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
  const row = updated || { ...app, status, reviewed_by: reviewer };
  req.waitUntil?.(dm(app.discord_user_id, action === "approve"
    ? resultText("approved", { roleId: s.roleId }).replace(`<@&${s.roleId}>`, "實驗室")
    : resultText("rejected", { ex: app.exchange, invite: s.invites?.[app.exchange] })));
  return res.status(200).json({ type: T.UPDATE, data: reviewMessage(row, { reviewer, reason: app.note }) });
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

    // 按鈕、選單
    if (i.type === 3) {
      const id = i.data?.custom_id || "";
      if (id === "apply") return res.status(200).json(hasRole ? reply(resultText("already_member")) : exchangeSelect());
      if (id === "apply_ex") {
        const ex = i.data?.values?.[0];
        if (!EXCHANGES.includes(ex)) return res.status(200).json(reply("請重新選一次交易所。"));
        return res.status(200).json(uidModal(ex));
      }
      const m = /^(approve|reject):(\d+)$/.exec(id);
      if (m) return review(req, res, i, s, m[1], Number(m[2]));
    }

    // 填完 UID 送出
    if (i.type === 5 && /^apply_uid:/.test(i.data?.custom_id || "")) {
      const ex = i.data.custom_id.split(":")[1];
      if (!EXCHANGES.includes(ex)) return res.status(200).json(reply("請重新申請一次。"));
      const uid = cleanUid(fieldValue(i.data.components, "uid"));
      if (!APP_UID_RE.test(uid)) return res.status(200).json(reply(resultText("bad_uid")));
      if (hasRole) return res.status(200).json(reply(resultText("already_member")));
      const [{ data: mine }, { data: taken }] = await Promise.all([
        supabaseAdmin.from("discord_applications").select("id").eq("discord_user_id", user.id).eq("status", "pending").limit(1),
        supabaseAdmin.from("discord_applications").select("discord_user_id").eq("exchange", ex).eq("exchange_uid", uid).eq("status", "approved").neq("discord_user_id", user.id).limit(1),
      ]);
      if (mine?.length) return res.status(200).json(reply(resultText("already_pending")));
      if (taken?.length) return res.status(200).json(reply(resultText("uid_taken")));
      req.waitUntil?.(processApplication({ i, s, ex, uid, user }));
      return res.status(200).json({ type: T.DEFER, data: { flags: EPHEMERAL } });
    }

    return res.status(200).json(reply("這個按鈕已經失效了，請重新按一次「申請加入實驗室」。"));
  },
});
