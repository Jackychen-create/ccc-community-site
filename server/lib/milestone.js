// 升級通知（三級制度）：這一輪的交易量升到第一級、第二級、第三級時通知研究員一次（規則在 shared/rules.js 的 TIERS）
// 交易量存檔（自動同步、管理員手動填）都走 saveVolumes → 這裡；記在 milestones 表（level ＝ 第幾級）
// 通知：有 Discord（報名時審核通過的那個帳號）就私訊；網站首頁下次打開會跳一次恭喜
import { supabaseAdmin } from "./env.js";
import { twDate, todayTW } from "./dates.js";
import { getPay } from "./pay.js";
import { isLegacyMember } from "../../public/assets/js/shared/rules.js";
import { discordConfigured, dm } from "./discord.js";
import { progressTo, fmtAmount, gapTo, isLots, tierName, tierInfo, MAX_TIER, EXCHANGES } from "../../public/assets/js/shared/rules.js";

const SITE = "https://ccc-community-site.pages.dev";
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const withUnit = (ex, n) => `${fmtAmount(ex, n)}${isLots(ex) ? "" : " USDT"}`;

// 私訊內容
export function milestoneText({ level, amounts, period, nextEnd }) {
  const b = progressTo(amounts, level, EXCHANGES);
  const icon = { 1: "✅", 2: "🎉", 3: "🏆" }[level] || "🎉";
  const lines = [
    `${icon} **升上${tierName(level)}！** 你這一輪（${md(period.start)}～${md(period.end)}）的交易量：${b.ex} ${withUnit(b.ex, b.n)}`,
    `${tierInfo(level).perks.join("、")}，至少到 **${md(nextEnd)}**。`,
  ];
  if (level < MAX_TIER) lines.push(`再往上：${tierName(level + 1)}${gapTo(amounts, level + 1, EXCHANGES)}（${tierInfo(level + 1).perks.join("、")}）。`);
  if (level >= 3) lines.push("到網站右邊「一對一交流」選這個月的主講（CCC、X 二選一，每位最多 5 位）。");
  lines.push(SITE);
  return lines.join("\n");
}

// hits: [{ user_id, period: { start, end }, level（第幾級）, amounts, nextEnd }]
// 同一輪同一級只記一次、只通知一次（金額被改小再改回來也不會重複）
export async function notifyMilestones(hits) {
  if (!hits.length) return { recorded: 0, sent: 0 };
  const ids = [...new Set(hits.map((h) => h.user_id))];
  const [{ data: done }, { data: mems }] = await Promise.all([
    supabaseAdmin.from("milestones").select("user_id, period_start, level").in("user_id", ids),
    supabaseAdmin.from("members").select("user_id, invite_code, free, created_at").in("user_id", ids),
  ]);
  const seen = new Set((done || []).map((r) => `${r.user_id}:${r.period_start}:${r.level}`));
  const memBy = new Map((mems || []).map((m) => [m.user_id, m]));
  // 贈送名額沒有交易量條件，不用通知；付費的研究員（v1.28.0）等級看月費，不是交易量，也不通知
  const pay = await getPay().catch(() => null);
  const isPaid = (m) => !!pay && !!m && !isLegacyMember({ joined: twDate(m.created_at), free: !!m.free }, pay, todayTW());
  const fresh = hits.filter((h) => !memBy.get(h.user_id)?.free && !isPaid(memBy.get(h.user_id)) && !seen.has(`${h.user_id}:${h.period.start}:${h.level}`));
  if (!fresh.length) return { recorded: 0, sent: 0 };
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("milestones").insert(fresh.map((h) => ({ user_id: h.user_id, period_start: h.period.start, level: h.level, reached_at: now, dm_sent: false, seen: false })));
  if (error) throw error;

  let sent = 0;
  if (discordConfigured()) {
    const discordOf = await discordIds(fresh.map((h) => h.user_id), memBy);
    for (const h of fresh) {
      const uid = discordOf.get(h.user_id);
      if (!uid) continue;
      if (await dm(uid, milestoneText(h))) {
        sent++;
        await supabaseAdmin.from("milestones").update({ dm_sent: true }).eq("user_id", h.user_id).eq("period_start", h.period.start).eq("level", h.level);
      }
    }
  }
  return { recorded: fresh.length, sent };
}

// 研究員 → Discord 帳號：在 Discord 報名通過時拿到的專用實驗室密碼，或填的交易所 UID 跟通過的報名一樣
export async function discordIds(userIds, memBy) {
  const out = new Map();
  // 研究員自己在網站連結的（v1.26.21）最準，先用
  if (userIds.length) {
    const { data: own } = await supabaseAdmin.from("member_discord").select("user_id, discord_user_id").in("user_id", userIds);
    for (const r of own || []) out.set(r.user_id, r.discord_user_id);
  }
  const codes = userIds.map((id) => memBy.get(id)?.invite_code).filter(Boolean);
  const [{ data: byCode }, { data: links }] = await Promise.all([
    codes.length ? supabaseAdmin.from("discord_applications").select("discord_user_id, invite_code").eq("status", "approved").in("invite_code", codes) : { data: [] },
    supabaseAdmin.from("exchange_links").select("user_id, exchange, exchange_uid").in("user_id", userIds),
  ]);
  const codeTo = new Map((byCode || []).map((a) => [a.invite_code, a.discord_user_id]));
  for (const id of userIds) {
    const d = codeTo.get(memBy.get(id)?.invite_code);
    if (d && !out.has(id)) out.set(id, d);
  }
  const rest = (links || []).filter((l) => !out.has(l.user_id));
  if (rest.length) {
    const { data: byUid } = await supabaseAdmin.from("discord_applications").select("discord_user_id, exchange, exchange_uid").eq("status", "approved").in("exchange_uid", [...new Set(rest.map((l) => l.exchange_uid))]);
    const uidTo = new Map((byUid || []).map((a) => [`${a.exchange}:${a.exchange_uid}`, a.discord_user_id]));
    for (const l of rest) {
      const d = uidTo.get(`${l.exchange}:${l.exchange_uid}`);
      if (d && !out.has(l.user_id)) out.set(l.user_id, d);
    }
  }
  return out;
}

// 研究員首頁：這一輪還沒看過的最高升級（看過就不再跳）
export async function unseenMilestone(userId, periodStart) {
  const { data } = await supabaseAdmin.from("milestones").select("level, reached_at, shared_at").eq("user_id", userId).eq("period_start", periodStart).eq("seen", false).order("level", { ascending: false }).limit(1);
  return data?.[0] || null;
}
export async function markMilestonesSeen(userId) {
  await supabaseAdmin.from("milestones").update({ seen: true }).eq("user_id", userId).eq("seen", false);
}
