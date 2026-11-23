// 付費制（v1.28.0）：綠界信用卡。規則在 shared/rules.js 的「付費制」
//   月費：定期定額，每月自動扣 → 直播留檔、研究員專區、Discord 研究員身分組
//   系統分享單集：一次付清，第 N 集＝CCC、X 的第 N 份
// 設定在 settings 的 pay；正式特店的代號和金鑰只放在 Cloudflare 環境變數（ECPAY_MERCHANT_ID、ECPAY_HASH_KEY、ECPAY_HASH_IV）
import { env, supabaseAdmin } from "./env.js";
import { todayTW, twDate } from "./dates.js";
import { getDiscordSettings, addRole, removeRole, sendMessage, dm, isSnowflake } from "./discord.js";
import { linkedOf } from "./discord-link.js";
import { SITE_URL, LAB_URL } from "./discord-flow.js";
import {
  PAY_MONTHLY, PAY_PART, PAY_GRACE_DAYS, PAY_ITEMS, SITE_TIER, COURSE_PARTS,
  addDays, addMonths, isPaidOn, isLegacyMember, paidStatus, periodOf,
} from "../../public/assets/js/shared/rules.js";

// 綠界文件公開的測試特店（只能在測試環境用，不是祕密）
export const STAGE = { host: "https://payment-stage.ecpay.com.tw", merchant: "3002607", key: "pwFHCqoQZGmho4w6", iv: "EkRm7iFT261dpevs" };
const LIVE_HOST = "https://payment.ecpay.com.tw";
export const PAY_DEFAULTS = { mode: "off", monthly: PAY_MONTHLY, part: PAY_PART, paidFrom: null, legacyUntil: null };
// 月費的定期定額最多扣幾期（綠界月繳上限 99 期，扣完要重新訂）
export const MONTHLY_EXEC_TIMES = 99;

export async function getPay() {
  const { data, error } = await supabaseAdmin.from("settings").select("value").eq("key", "pay").maybeSingle();
  if (error) throw error;
  return { ...PAY_DEFAULTS, ...(data?.value || {}) };
}
export async function savePay(v) {
  const { error } = await supabaseAdmin.from("settings").upsert({ key: "pay", value: v });
  if (error) throw error;
  return v;
}

export const liveReady = () => Boolean(env.ECPAY_MERCHANT_ID && env.ECPAY_HASH_KEY && env.ECPAY_HASH_IV);
export function creds(mode) {
  if (mode === "test") return { ...STAGE, host: env.ECPAY_BASE_URL || STAGE.host };
  if (mode === "live" && liveReady()) return { host: env.ECPAY_BASE_URL || LIVE_HOST, merchant: env.ECPAY_MERCHANT_ID, key: env.ECPAY_HASH_KEY, iv: env.ECPAY_HASH_IV };
  return null;
}
// 哪些訂單算數：正式模式只算正式和手動給的；測試模式連測試的也算（切到正式後，測試的就不算了）
export const countedModes = (cfg) => (cfg.mode === "live" ? ["live", "grant"] : ["test", "live", "grant"]);

// ── 綠界的檢查碼：參數照名稱排序 → 前後加 HashKey、HashIV → .NET 風格網址編碼 → 小寫 → SHA256 → 大寫 ──
export function encodeNet(s) {
  return encodeURIComponent(s).replace(/'/g, "%27").replace(/~/g, "%7e").replace(/%20/g, "+")
    .replace(/%21/g, "!").replace(/%28/g, "(").replace(/%29/g, ")").replace(/%2a/gi, "*").toLowerCase();
}
export async function macValue(params, key, iv) {
  const keys = Object.keys(params).filter((k) => k !== "CheckMacValue").sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const raw = `HashKey=${key}&${keys.map((k) => `${k}=${params[k]}`).join("&")}&HashIV=${iv}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encodeNet(raw)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
// 台北時間 yyyy/MM/dd HH:mm:ss
export function twTime(ms) {
  const d = new Date(ms + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
export function newTradeNo(now = Date.now()) {
  const rnd = [...crypto.getRandomValues(new Uint8Array(5))].map((b) => (b % 36).toString(36)).join("");
  return `CCC${now.toString(36)}${rnd}`.toUpperCase().slice(0, 20);
}
export const itemName = (o) => (o.kind === "monthly" ? PAY_ITEMS.monthly : PAY_ITEMS.part(o.part));
export const money = (n) => `NT$${Number(n).toLocaleString("en-US")}`;

// ── 某個人的付費狀況 ──
// 月費實際能用到哪天：扣款失敗的多給寬限天數
export const subEnd = (o) => (!o.paid_until ? null : o.status === "past_due" ? addDays(o.paid_until, PAY_GRACE_DAYS) : o.paid_until);
const LIVE_SUB = ["active", "past_due", "canceled"];

export async function ordersOf(userId, cfg) {
  const { data, error } = await supabaseAdmin.from("pay_orders")
    .select("trade_no, kind, part, amount, mode, status, paid_until, times, created_at, updated_at, note")
    .eq("user_id", userId).in("mode", countedModes(cfg)).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
// 訂單 → 月費到哪天、買了哪幾集
export function summarizeOrders(orders, today = todayTW()) {
  let subUntil = null;
  let current = null; // 現在這筆月費（取消續扣、扣款失敗也算，用到期滿）
  for (const o of orders) {
    if (o.kind !== "monthly" || !LIVE_SUB.includes(o.status)) continue;
    const end = subEnd(o);
    if (end && (!subUntil || end > subUntil)) subUntil = end;
    if (end && end >= today && (!current || end > subEnd(current))) current = o;
  }
  const parts = orders.filter((o) => o.kind === "part" && o.status === "paid").map((o) => o.part);
  return { subUntil, parts, current };
}

// 這位研究員是不是付費的（不是就回 null，照原本的規則）
export async function memberPaid(member, today = todayTW(), cfg = null) {
  cfg = cfg || (await getPay().catch(() => PAY_DEFAULTS));
  if (isLegacyMember({ joined: twDate(member.created_at), free: !!member.free }, cfg, today)) return null;
  const orders = await ordersOf(member.user_id, cfg);
  return paidFromOrders(member, orders, today);
}
export function paidFromOrders(member, orders, today = todayTW()) {
  const { subUntil, parts } = summarizeOrders(orders, today);
  const override = member.min_tier && (!member.min_tier_until || member.min_tier_until >= today) ? member.min_tier : 0;
  const paid = paidStatus({ subUntil, parts, override, today });
  return { tier: paid.tier, until: paid.sub ? paid.subUntil : null, cycleTier: paid.tier, period: periodOf(twDate(member.created_at), today), paid };
}
// 很多人一次算（後台列表）：回傳 Map(user_id → 狀態)，照舊的人不在裡面
export async function paidFor(members, today = todayTW()) {
  const cfg = await getPay().catch(() => PAY_DEFAULTS);
  const out = new Map();
  const paidMembers = members.filter((m) => !isLegacyMember({ joined: twDate(m.created_at), free: !!m.free }, cfg, today));
  if (!paidMembers.length) return out;
  const { data, error } = await supabaseAdmin.from("pay_orders").select("user_id, trade_no, kind, part, status, paid_until, mode")
    .in("user_id", paidMembers.map((m) => m.user_id)).in("mode", countedModes(cfg));
  if (error) throw error;
  for (const m of paidMembers) out.set(m.user_id, paidFromOrders(m, (data || []).filter((o) => o.user_id === m.user_id), today));
  return out;
}
// 對外（登入頁、公開頁）：付費制開了沒、價格
export async function publicPay(today = todayTW()) {
  const cfg = await getPay().catch(() => PAY_DEFAULTS);
  return { on: isPaidOn(cfg.paidFrom, today), paidFrom: cfg.paidFrom || null, monthly: cfg.monthly, part: cfg.part, open: !!creds(cfg.mode), test: cfg.mode === "test" };
}

// ── 綠界表單 ──
export async function checkoutForm(cfg, order, { now = Date.now(), back = "#/plans" } = {}) {
  const c = creds(cfg.mode);
  if (!c) return null;
  const fields = {
    MerchantID: c.merchant,
    MerchantTradeNo: order.trade_no,
    MerchantTradeDate: twTime(now),
    PaymentType: "aio",
    TotalAmount: String(order.amount),
    TradeDesc: "CCC 交易實驗室",
    ItemName: `CCC ${itemName(order)}`,
    ReturnURL: `${SITE_URL}/api/pay/notify`,
    ChoosePayment: "Credit",
    EncryptType: "1",
    ClientBackURL: `${LAB_URL}${back}`,
    CustomField1: order.kind,
  };
  if (order.kind === "monthly") {
    Object.assign(fields, { PeriodAmount: String(order.amount), PeriodType: "M", Frequency: "1", ExecTimes: String(MONTHLY_EXEC_TIMES), PeriodReturnURL: `${SITE_URL}/api/pay/period` });
  }
  fields.CheckMacValue = await macValue(fields, c.key, c.iv);
  return { action: `${c.host}/Cashier/AioCheckOut/V5`, fields };
}

// 跟綠界說停掉某一筆定期定額
export async function stopRecurring(order, now = Date.now()) {
  const c = creds(order.mode) || (order.mode === "test" ? STAGE : null);
  if (!c) return { ok: false, msg: "付款設定有問題（正式特店的金鑰不見了）" };
  const body = { MerchantID: c.merchant, MerchantTradeNo: order.trade_no, Action: "Cancel", TimeStamp: String(Math.floor(now / 1000)) };
  body.CheckMacValue = await macValue(body, c.key, c.iv);
  try {
    const r = await fetch(`${c.host}/Cashier/CreditCardPeriodAction`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(15000),
    });
    const res = Object.fromEntries(new URLSearchParams(await r.text()));
    // 10100248 / 90100149：綠界那邊已經停了，一樣當成取消
    return { ok: ["1", "10100248", "90100149"].includes(String(res.RtnCode)), msg: res.RtnMsg || String(r.status) };
  } catch (e) {
    return { ok: false, msg: String(e?.message || e).slice(0, 100) };
  }
}

// ── 訂單資料 ──
export async function getOrder(tradeNo) {
  const { data, error } = await supabaseAdmin.from("pay_orders").select("*").eq("trade_no", tradeNo).maybeSingle();
  if (error) throw error;
  return data;
}
export async function setOrder(tradeNo, patch) {
  const { error } = await supabaseAdmin.from("pay_orders").update({ ...patch, updated_at: new Date().toISOString() }).eq("trade_no", tradeNo);
  if (error) throw error;
}
export async function logPayment(tradeNo, kind, p) {
  await supabaseAdmin.from("pay_logs").insert({ trade_no: tradeNo, kind, rtn_code: String(p.RtnCode ?? ""), amount: Number(p.Amount || p.TradeAmt || 0) || null, raw: p })
    .then(({ error }) => error && console.error("pay log failed", error.message));
}
export async function emailOf(userId) {
  if (!userId) return "（帳號已刪除）";
  const { data } = await supabaseAdmin.from("members").select("email").eq("user_id", userId).maybeSingle();
  return data?.email || userId;
}

// 管理員通知：發在 Discord 審核頻道（沒設定就算了）
export async function notifyStaff(text) {
  try {
    if (!env.DISCORD_BOT_TOKEN) return;
    const s = await getDiscordSettings();
    const ch = s.reviewChannelId || s.panelChannelId;
    if (ch) await sendMessage(ch, { content: text.slice(0, 1900), allowed_mentions: { parse: [] } });
  } catch (e) {
    console.error("pay notify staff failed", e?.message);
  }
}
// 私訊研究員（有連結 Discord 才發）
export async function dmMember(userId, text) {
  try {
    const l = await linkedOf(userId);
    if (l?.discord_user_id && env.DISCORD_BOT_TOKEN) await dm(l.discord_user_id, text);
  } catch (e) {
    console.error("pay dm failed", e?.message);
  }
}

// ── Discord 研究員身分組：有月費就給，沒有就拿掉（只動付費的研究員；照舊的人不動） ──
// want：true 給、false 拿掉。沒連結 Discord、Discord 沒設定好就跳過，回傳做了什麼
export async function syncRole(userId, want) {
  if (!env.DISCORD_BOT_TOKEN) return "skip";
  const l = await linkedOf(userId).catch(() => null);
  if (!l?.discord_user_id) return "unlinked";
  const s = await getDiscordSettings();
  if (!s.guildId || !isSnowflake(s.roleId)) return "skip";
  try {
    if (want) await addRole(s.guildId, l.discord_user_id, s.roleId);
    else await removeRole(s.guildId, l.discord_user_id, s.roleId);
    return want ? "added" : "removed";
  } catch (e) {
    console.error("pay role sync failed", e?.status, e?.message);
    return e?.status === 404 ? "left" : "error";
  }
}
// 這個人現在該不該有身分組（付費的才判斷；照舊的回 null＝不要動）
export async function roleWanted(userId, today = todayTW()) {
  const { data: m } = await supabaseAdmin.from("members").select("user_id, created_at, free, banned, min_tier, min_tier_until").eq("user_id", userId).maybeSingle();
  if (!m) return null;
  const st = await memberPaid(m, today);
  if (!st) return null;
  return !m.banned && st.tier >= SITE_TIER;
}

// ── 綠界通知（第一次 kind=first，之後每期 kind=period）：回傳要回給綠界的文字 ──
export async function handleNotify(p, kind, now = Date.now()) {
  const order = /^[A-Z0-9]{8,20}$/.test(String(p.MerchantTradeNo || "")) ? await getOrder(p.MerchantTradeNo) : null;
  if (!order) return "0|unknown order";
  const c = creds(order.mode) || (order.mode === "test" ? STAGE : null);
  if (!c || p.MerchantID !== c.merchant || (await macValue(p, c.key, c.iv)) !== p.CheckMacValue) return "0|CheckMacValue Error";
  await logPayment(order.trade_no, kind, p);
  // 正式環境不收綠界後台的「模擬付款」
  if (String(p.SimulatePaid) === "1" && order.mode === "live") return "1|OK";
  const paid = String(p.RtnCode) === "1";
  const today = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  const who = await emailOf(order.user_id);
  const tag = order.mode === "test" ? "【測試】" : "";
  const msg = String(p.RtnMsg || "").slice(0, 300) || null;

  // 單集：一次付清
  if (order.kind === "part") {
    if (kind !== "first" || !["pending", "failed"].includes(order.status)) return "1|OK";
    await setOrder(order.trade_no, { status: paid ? "paid" : "failed", times: paid ? 1 : 0, last_msg: msg });
    if (paid) {
      await notifyStaff(`💳 ${tag}${who} 買了系統分享第 ${order.part} 集，${money(order.amount)}`);
      await dmMember(order.user_id, `付款成功 🎉 系統分享第 ${order.part} 集（CCC、X）已經打開了，永久可以看：${LAB_URL}#/course`);
    }
    return "1|OK";
  }

  // 月費：第一次刷卡
  if (kind === "first") {
    if (!["pending", "failed"].includes(order.status)) return "1|OK";
    if (!paid) {
      await setOrder(order.trade_no, { status: "failed", last_msg: msg });
      return "1|OK";
    }
    // 之前取消續扣、還沒到期的：接在後面算，不會少掉已經付的天數
    const { data: prev } = await supabaseAdmin.from("pay_orders").select("trade_no, status, paid_until").eq("user_id", order.user_id).eq("kind", "monthly").eq("mode", order.mode).eq("status", "canceled");
    const left = (prev || []).map((o) => o.paid_until).filter((d) => d && d > today).sort().pop();
    const until = addMonths(left || today, 1);
    await setOrder(order.trade_no, { status: "active", paid_until: until, times: 1, last_msg: msg });
    const role = await syncRole(order.user_id, true);
    await notifyStaff(`💳 ${tag}${who} 訂閱月費，${money(order.amount)}${role === "unlinked" ? "（還沒連結 Discord，連結後會自動拿到研究員身分組）" : role === "error" ? "（⚠️ 給 Discord 身分組失敗，請手動給）" : ""}`);
    await dmMember(order.user_id, `訂閱成功 🎉 月費會員到 ${until}，之後每個月自動扣款。直播留檔、研究員專區都打開了：${LAB_URL}`);
    return "1|OK";
  }

  // 月費：之後每一期
  const times = Number(p.TotalSuccessTimes || 0);
  if (paid) {
    if (times && times <= order.times) return "1|OK"; // 同一期重複通知
    const from = order.paid_until && order.paid_until > today ? order.paid_until : today;
    const until = addMonths(from, 1);
    const wasOff = order.status === "past_due" || order.status === "ended";
    await setOrder(order.trade_no, { status: order.status === "canceled" ? "canceled" : "active", paid_until: until, times: times || order.times + 1, last_msg: msg });
    if (wasOff) await syncRole(order.user_id, true);
    if (order.status === "ended") await notifyStaff(`⚠️ ${tag}${who} 的月費已經結束，綠界又扣款成功了。已經把會員補回去到 ${until}，請確認要不要退款或停掉續扣（${order.trade_no}）`);
    return "1|OK";
  }
  if (order.status === "active") await setOrder(order.trade_no, { status: "past_due", last_msg: msg });
  await notifyStaff(`⚠️ ${tag}${who} 的月費扣款失敗（${p.RtnMsg || p.RtnCode}）。到期後寬限 ${PAY_GRACE_DAYS} 天，之後自動結束`);
  await dmMember(order.user_id, `提醒：這個月的月費扣款沒有成功（${p.RtnMsg || "信用卡扣款失敗"}）。${PAY_GRACE_DAYS} 天內會員照常可以用，請確認信用卡，或到網站重新訂閱：${LAB_URL}#/plans`);
  return "1|OK";
}

// ── 期滿的月費：改成結束、拿掉 Discord 身分組、扣款失敗的順便停掉綠界續扣（排程每小時一次） ──
export async function sweep(today = todayTW()) {
  const { data, error } = await supabaseAdmin.from("pay_orders").select("*").eq("kind", "monthly").in("status", LIVE_SUB).lt("paid_until", today);
  if (error) throw error;
  const due = (data || []).filter((o) => subEnd(o) < today);
  const out = { ended: 0, removed: 0, pending: 0 };
  for (const o of due) {
    await setOrder(o.trade_no, { status: "ended", last_msg: o.status === "past_due" ? "扣款失敗，寬限期過了" : "期滿" });
    out.ended++;
    if (o.status === "past_due") {
      const r = await stopRecurring(o);
      if (!r.ok) await notifyStaff(`⚠️ ${await emailOf(o.user_id)} 的月費寬限期過了，但綠界的定期扣款沒停成功（${r.msg}），請到綠界後台手動停掉 ${o.trade_no}`);
    }
    if (o.user_id && (await roleWanted(o.user_id, today)) === false) {
      if ((await syncRole(o.user_id, false)) === "removed") out.removed++;
      await dmMember(o.user_id, `你的 CCC 月費會員到期了（${o.paid_until}），研究員身分組先收回。想繼續看直播和留檔，可以到網站重新訂閱：${LAB_URL}#/plans`);
    }
  }
  // 一天以上還沒付的訂單：當作放棄（不影響任何人）
  const { data: stale } = await supabaseAdmin.from("pay_orders").update({ status: "failed", last_msg: "沒有完成付款" })
    .eq("status", "pending").lt("created_at", new Date(Date.now() - 86400e3).toISOString()).select("trade_no");
  out.pending = (stale || []).length;
  return out;
}

export const COURSE_PART_LIST = Array.from({ length: COURSE_PARTS }, (_, i) => i + 1);
