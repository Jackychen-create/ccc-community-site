// v1.36.0：加入培訓計畫改成兩步（網站登入頁）
//   1. 選交易所、貼 UID → 網站跟交易所確認是用 CCC 連結註冊的（verifyUid）
//   2. 按「進入 Discord 實驗室研究員專區」→ Discord 授權 → 建研究員帳號（createFromDiscord）、加進伺服器、給身分組、登入網站
// 之後回網站：「用 Discord 登入」（sessionFor）。沒有網站密碼。
// 網站帳號（Supabase Auth）用一個不收信的代號 Email（discordAuthEmail）；研究員名單、寄信用的 Email 記在 members.email（Discord 驗證過的 Email，研究員可以改）
import { supabaseAdmin } from "./env.js";
import { EXCHANGES, AUTO_EXCHANGES, cleanExId, exIdOk, idLabel } from "../../public/assets/js/shared/rules.js";
import { PROVIDERS } from "./autosync.js";

export const DISCORD_AUTH_DOMAIN = "users.ccc-community-site.pages.dev";
export const discordAuthEmail = (discordId) => `discord-${discordId}@${DISCORD_AUTH_DOMAIN}`;
export const isDiscordAuthEmail = (email) => String(email || "").endsWith(`@${DISCORD_AUTH_DOMAIN}`);

// 三間交易所的 CCC 註冊連結（UID 不是用 CCC 連結註冊的時候給他重新註冊）
export const JOIN_LINKS = {
  OKX: "https://okx.com/join/99357363",
  Bybit: "https://partner.bybit.com/b/CCCX",
  BingX: "https://bingx.com/zh-tc/activity/task/5225173484?themeType=2&ref=GTUTWZ",
};

// 同一個 IP 一小時最多試 10 次（uid_join_attempts，存 IP 的雜湊、不存原始 IP），避免有人一個一個 UID 試
export const UID_TRIES_PER_HOUR = 10;
async function ipHash(req) {
  const ip = String(req.headers?.["cf-connecting-ip"] || req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ccc-uid-join:" + ip));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
export async function tooManyTries(req) {
  const h = await ipHash(req);
  const since = new Date(Date.now() - 3600e3).toISOString();
  const { count } = await supabaseAdmin.from("uid_join_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", h).gte("at", since);
  if ((count || 0) >= UID_TRIES_PER_HOUR) return true;
  await supabaseAdmin.from("uid_join_attempts").insert({ ip_hash: h });
  return false;
}

const uidTaken = async (exchange, uid) => {
  const { data } = await supabaseAdmin.from("exchange_links").select("user_id").eq("exchange", exchange).eq("exchange_uid", uid).maybeSingle();
  return data?.user_id || null;
};

// 第一步：確認 UID。回 { ok: true, exchange, uid, verified } 或 { ok: false, status, error, code }
//   code：bad_input／taken／not_invited（不是 CCC 邀請，可能是剛註冊、資料還沒更新）／other_code（用別人的邀請碼）／unavailable／too_many
export async function verifyUid(req, exchangeIn, uidIn) {
  const exchange = String(exchangeIn || "");
  const uid = cleanExId(exchange, uidIn);
  if (!EXCHANGES.includes(exchange)) return { ok: false, status: 400, code: "bad_input", error: "請選擇你用 CCC 連結註冊的交易所" };
  if (!exIdOk(exchange, uid)) return { ok: false, status: 400, code: "bad_input", error: "UID 是一串數字，請再確認一次" };
  const p = PROVIDERS[exchange];
  if (!AUTO_EXCHANGES.includes(exchange) || !p?.configured()) return { ok: false, status: 503, code: "unavailable", error: `${exchange} 暫時確認不到，請過幾分鐘再試` };
  if (await uidTaken(exchange, uid)) return { ok: false, status: 409, code: "taken", error: `這個 ${idLabel(exchange)}已經加入過了，請到「登入」用 Discord 登入` };
  if (await tooManyTries(req)) return { ok: false, status: 429, code: "too_many", error: "試太多次了，請一小時後再試" };
  let check;
  try { check = await p.check(uid); } catch (e) {
    console.error(`${exchange} check failed (join)`, e?.code, e?.message);
    return { ok: false, status: 503, code: "unavailable", error: `${exchange} 暫時確認不到，請過幾分鐘再試` };
  }
  if (!check?.invited) {
    if (check?.otherCode) return { ok: false, status: 400, code: "other_code", error: "這個帳號用的是別人的邀請碼，請用下面的 CCC 連結重新註冊" };
    const extra = exchange === "Bybit" ? "（Bybit 填主帳號的 UID）" : "";
    return { ok: false, status: 400, code: "not_invited", error: `查不到這個 UID${extra}。剛註冊的話請幾分鐘後再試，或用下面的 CCC 連結註冊` };
  }
  return { ok: true, exchange, uid, verified: check };
}

// 第二步（Discord 授權回來）：建研究員帳號、記下 UID 和 Discord
//   d：discordUserFromCode 的結果（user、name、email）
export async function createFromDiscord({ exchange, uid }, d) {
  if (await uidTaken(exchange, uid)) return { ok: false, error: `這個 ${exchange} UID 已經加入過了，請用 Discord 登入` };
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: discordAuthEmail(d.user.id),
    email_confirm: true,
    user_metadata: { discord_id: d.user.id, discord_name: d.name },
  });
  if (createError || !created?.user) {
    console.error("join create user failed", createError?.message);
    return { ok: false, error: "建立帳號失敗，請再試一次" };
  }
  const userId = created.user.id;
  const now = new Date().toISOString();
  const { error: memberError } = await supabaseAdmin.from("members").insert({
    user_id: userId,
    // 研究員名單、寄信用：Discord 驗證過的 Email；Discord 沒給的話先放代號，成功頁請他填
    email: d.email || discordAuthEmail(d.user.id),
    invite_code: null,
    access_until: null,
    free: false,
    notify: !!d.email,
  });
  if (memberError) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    throw memberError;
  }
  // 新欄位分開寫：schema 還沒套用 v1.36.0 的話也不影響開通
  const { error: extraError } = await supabaseAdmin.from("members").update({ notify_consent_at: d.email ? now : null, joined_via: "discord" }).eq("user_id", userId);
  if (extraError) console.error("join extra columns failed（schema.sql v1.36.0 套用了嗎？）", extraError.message);
  const { error: linkError } = await supabaseAdmin.from("exchange_links").insert({ user_id: userId, exchange, exchange_uid: uid, direct: null, bound_at: now });
  if (linkError) console.error("join link failed", linkError.message);
  else {
    try { await PROVIDERS[exchange]?.sync({ uid }); } catch (e) { console.error("join first sync failed", e?.message); }
  }
  const { error: dcError } = await supabaseAdmin.from("member_discord").upsert({ user_id: userId, discord_user_id: d.user.id, discord_name: d.name, linked_at: now });
  if (dcError) console.error("join discord link failed", dcError.message);
  return { ok: true, userId };
}

// 登入網站用的一次性代碼（Supabase 的 magic link token；網站拿去 verifyOtp 換登入狀態，不會寄信）
export async function sessionFor(userId) {
  const { data: u, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !u?.user?.email) throw error || new Error("no auth email");
  const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (linkError || !data?.properties?.hashed_token) throw linkError || new Error("no token");
  return data.properties.hashed_token;
}
