// 規則：前台、後台、伺服器、測試用的假伺服器都讀這一份，改一次就全部一致。
// 規則改了要一起更新 docs/功能說明.md 和 PRODUCT.md。

// ── 日期（YYYY-MM-DD）──
export function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 從這天起一個月（含當天），例如 10/15 → 11/14；1/31 → 2/27（2 月沒有 31 號就用月底）
export function cycleEnd(date) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const next = new Date(Date.UTC(y, m, Math.min(d, last)));
  return addDays(next.toISOString().slice(0, 10), -1);
}

// ── 每人的一輪（2026-10-17 起）──
// 從加入那天起算，每一輪剛好一個月：10/16 加入 → 第一輪 10/16～11/15、第二輪 11/16～12/15…
// 這一輪達到第幾級 → 下一輪就是第幾級（三級制度在下面 TIERS）
// 1/31 加入：1/31～2/27、2/28～3/30、3/31～4/29…（沒有 31 號的月份用月底，之後回到 31 號）
export function addMonths(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
// anchor（加入那天）＋某一天 → 那天所在的一輪 { index, start, end }（加入之前的日子算第一輪）
export function periodOf(anchor, date) {
  const [ay, am] = anchor.split("-").map(Number);
  const [y, m] = date.split("-").map(Number);
  let k = Math.max(0, (y - ay) * 12 + (m - am));
  while (k > 0 && addMonths(anchor, k) > date) k--;
  return { index: k, start: addMonths(anchor, k), end: addDays(addMonths(anchor, k + 1), -1) };
}
// 下一輪
export const nextPeriod = (anchor, period) => periodOf(anchor, addDays(period.end, 1));
// 上一輪（第一輪就沒有上一輪，回傳 null）
export const prevPeriod = (anchor, period) => (period.index > 0 ? periodOf(anchor, addDays(period.start, -1)) : null);

// ── 交易量 ──
// 合作交易所：OKX、UM 由管理員填；Bybit、BingX 由網站每天自動抓（研究員綁定 UID 後）
// UM（Ultima Markets，MT5）用「手」算，其他用 USDT 成交金額
export const EXCHANGES = ["OKX", "UM", "Bybit", "BingX"];
export const AUTO_EXCHANGES = ["Bybit", "BingX"];
export const LOT_EXCHANGES = ["UM"];
export const isLots = (ex) => LOT_EXCHANGES.includes(ex);
// 交易所帳號：OKX、Bybit、BingX 填 UID；UM 填 MT5 帳號（一樣是一串數字），另外填在 UM 開戶的英文姓名，
// 跟 UM 代理後台「近期新開戶」的帳號、姓名對得起來（2026-10-17）
export const idLabel = (ex) => (ex === "UM" ? "MT5 帳號" : "UID");
export const cleanExId = (ex, v) => String(v ?? "").normalize("NFKC").replace(/\s/g, "");
export const exIdOk = (ex, v) => /^\d{5,20}$/.test(v);
export const exIdError = (ex) => (ex === "UM" ? "MT5 帳號是一串數字，請再確認一次" : "UID 是一串數字，請再確認一次");
export const NEEDS_NAME = ["UM"];
export const needsName = (ex) => NEEDS_NAME.includes(ex);
// 姓名：去掉前後空白、多個空白變一個，英文轉大寫（UM 後台大小寫不一，比對比較準）
export const cleanAccountName = (v) => String(v ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
export const accountNameOk = (v) => /^[^\r\n`<>@]{2,60}$/u.test(v);
export const ACCOUNT_NAME_ERROR = "請填你在 UM 開戶的英文姓名（跟護照一樣，例如 WANG XIAO MING）";
// Bybit 的 TradFi（黃金、股票等）交易量打一折算：100 萬 TradFi ≈ 10 萬加密貨幣（2026-10-17 確定）
export const TRADFI_WEIGHT = 0.1;
export const TRADFI_NOTE = "Bybit 的 TradFi（黃金、股票等）交易量以十分之一計算。";
export const unitOf = (ex) => (isLots(ex) ? "手" : "USDT");

// ── 三級制度（2026-10-18，取代原本的單一門檻 100 萬／10 手）──
// 每人從加入那天起算，一輪一個月（periodOf）。這一輪內任一間交易所達到某一級 → 這一輪剩下的時間和「下一輪」都是那一級
// 下一輪的等級＝這一輪達到的等級（可升可降）；不到第一級 → 下一輪沒有等級
// 新研究員的第一輪先給第一級；管理員可以手動給「至少第幾級到哪天」（members.min_tier、min_tier_until）
export const TIERS = [
  { tier: 1, usdt: 10000, lots: 0.1, perks: ["Discord 研究員身分組", "會員直播（不提供留檔）"] },
  { tier: 2, usdt: 200000, lots: 2, perks: ["全部交易系統分享影音", "直播留檔", "研究員專屬網站"] },
  { tier: 3, usdt: 1500000, lots: 15, perks: ["每個月一次一對一交流（CCC、OC、X 三選一）"] },
];
export const MAX_TIER = TIERS.length;
export const SITE_TIER = 2; // 網站內容（直播留檔、教學課程、教材、筆記）要第二級
export const tierName = (t) => (t ? `第${"零一二三"[t]}級` : "沒有等級");
export const tierInfo = (t) => TIERS.find((x) => x.tier === t) || null;
export const goalFor = (ex, tier) => (isLots(ex) ? tierInfo(tier).lots : tierInfo(tier).usdt);
// 這些交易量達到第幾級（任一間交易所達到就算；0 ＝ 不到第一級）
export function tierOf(amounts) {
  let t = 0;
  for (const x of TIERS) if (EXCHANGES.some((ex) => Number(amounts?.[ex] || 0) >= goalFor(ex, x.tier))) t = x.tier;
  return t;
}
// 往某一級的進度：各交易所「交易量 ÷ 那一級的門檻」最高的那間，回傳 { ex, n, goal, ratio }
export function progressTo(amounts, tier, exchanges = EXCHANGES) {
  let best = { ex: exchanges[0], n: 0, goal: goalFor(exchanges[0], tier), ratio: 0 };
  for (const ex of exchanges) {
    const n = Number(amounts?.[ex] || 0);
    const goal = goalFor(ex, tier);
    if (n / goal > best.ratio) best = { ex, n, goal, ratio: n / goal };
  }
  return best;
}
// 顯示用：UM「3.5 手」；USDT「120 萬」（不到 1 萬就直接寫數字）
export function fmtAmount(ex, n) {
  n = Number(n) || 0;
  if (isLots(ex)) return `${Math.round(n * 100) / 100} 手`;
  return n >= 1e4 ? `${Math.round((n / 1e4) * 10) / 10} 萬` : n.toLocaleString("en-US");
}
// 到某一級「還差 18 萬」；最接近的是 UM 的話寫「UM 還差 1.5 手」
export function gapTo(amounts, tier, exchanges = EXCHANGES) {
  const b = progressTo(amounts, tier, exchanges);
  return `${isLots(b.ex) ? b.ex + " " : ""}還差 ${fmtAmount(b.ex, Math.max(0, b.goal - b.n))}`;
}
// 「OKX、Bybit、BingX 任一間 20 萬 USDT，或 UM 2 手」
export function tierRuleText(tier, exchanges = EXCHANGES) {
  const usdt = exchanges.filter((ex) => !isLots(ex));
  const lots = exchanges.filter(isLots);
  const t = tierInfo(tier);
  const parts = [];
  if (usdt.length) parts.push(`${usdt.join("、")}${usdt.length > 1 ? " 任一間" : ""} ${fmtAmount("", t.usdt)} USDT`);
  for (const ex of lots) parts.push(`${ex} ${t.lots} 手`);
  return parts.join("，或 ");
}
// 某位研究員今天的等級
//   anchor：加入那天；amountsOf(periodStart) → 那一輪的交易量；override：{ tier, until }（until 空白＝不限）
//   回傳 { tier, until, cycleTier, period }：tier 今天的等級、until 這個等級至少到哪天、cycleTier 這一輪自己達到的等級（＝下一輪的等級）
export function tierStatus({ anchor, today, amountsOf, override = null }) {
  const period = periodOf(anchor, today);
  const prev = prevPeriod(anchor, period);
  const next = nextPeriod(anchor, period);
  const cycleTier = tierOf(amountsOf(period.start));
  const carried = prev ? tierOf(amountsOf(prev.start)) : 1; // 第一輪先給第一級
  const ov = override?.tier && (!override.until || override.until >= today) ? override.tier : 0;
  const tier = Math.max(cycleTier, carried, ov);
  // 至少到哪天：這一輪自己達到的撐到下一輪結束；上一輪帶來的撐到這一輪結束；管理員給的撐到他設的日期
  const ends = [];
  if (cycleTier >= tier && tier) ends.push(next.end);
  if (carried >= tier && tier) ends.push(period.end);
  if (ov >= tier && tier) ends.push(override.until || null);
  const until = ends.includes(null) ? null : ends.sort().pop() || null;
  return { tier, until, cycleTier, period };
}

// ── 一對一交流（第三級，2026-10-18）──
// 第三級的研究員每個月（台灣時間的月份）從三位講師選一位；每位講師一個月最多 5 位
// 選同一位的超過 5 位 → 照這一輪的交易量排（換算成「到第三級門檻的幾倍」，UM 和 USDT 才比得了），前 5 位確定、其他候補（可以改選別位）
// 管理員按「已約好」的人一定算確定，不會被擠掉
export const ONE_ON_ONE_HOSTS = ["CCC", "OC", "X"];
export const ONE_ON_ONE_CAP = 5;
export const oneOnOneScore = (amounts) => progressTo(amounts || {}, MAX_TIER).ratio;
// entries: [{ user_id, host, score, booked, created_at }] → 同一位講師的排好順序，加上 rank（第幾位）、confirmed（確定）
export function rankOneOnOne(entries, host) {
  const list = entries.filter((e) => e.host === host)
    .sort((a, b) => (b.booked === true) - (a.booked === true) || b.score - a.score || String(a.created_at).localeCompare(String(b.created_at)));
  return list.map((e, i) => ({ ...e, rank: i + 1, confirmed: e.booked === true || i < ONE_ON_ONE_CAP }));
}

// ── 教學課程 ──
// CCC、OC、X 的教學影片各 6 份，共 18 份。每位研究員從加入那天起：
// 每 4 週為一輪，前 3 週依序解鎖 CCC、OC、X 各一份，第 4 週休息。
export const COURSE_HOSTS = ["CCC", "OC", "X"]; // 解鎖順序
export const COURSE_PARTS = 6;
export const COURSE_CYCLE_WEEKS = 4;
export function courseWeek(host, part) {
  return (part - 1) * COURSE_CYCLE_WEEKS + COURSE_HOSTS.indexOf(host); // 從 0 起算：第 0 週＝加入當天
}
export function courseUnlockDate(startDate, host, part) {
  return addDays(startDate, courseWeek(host, part) * 7);
}

// ── 觀看分段：每 30 秒一格（後台「觀看曲線」用）──
export const BUCKET_SEC = 30;

// ── 徽章（2026-10-18）──
// 伺服器整理每位研究員的「事實」（facts），用 earnedBadges 算出拿到哪些徽章；拿到的記在 badges 表，第一次拿到會跳恭喜
// facts：traded 有交易量、bestPct 單輪往第二級的最高進度（%）、qualified 幾輪到第二級以上、maxTier 單輪最高等級、
//        streak 最多連續幾輪第二級以上、hostsDone 看完全部 6 份的主講（陣列）、courseDone 看完幾份課程、
//        liveDone 看完幾場直播留檔、notes 寫了幾則筆記、questions 提問幾次
// 「看完」＝看到片長的 95%（跟後台觀看統計一樣）
export const BADGES = [
  { id: "first_trade", icon: "🌱", name: "第一筆", desc: "第一次有交易量", test: (f) => f.traded },
  { id: "half", icon: "⛰️", name: "半山腰", desc: "單輪交易量到第二級的一半", test: (f) => f.bestPct >= 50 },
  { id: "qualified", icon: "🏅", name: "第二級", desc: "第一次在一輪內升到第二級", test: (f) => f.qualified >= 1 },
  { id: "tier3", icon: "🏆", name: "第三級", desc: "第一次在一輪內升到第三級", test: (f) => f.maxTier >= 3 },
  { id: "streak3", icon: "🔥", name: "連續三輪", desc: "連續 3 輪第二級以上", test: (f) => f.streak >= 3 },
  { id: "live10", icon: "📺", name: "全勤觀眾", desc: "看完 10 場直播留檔", test: (f) => f.liveDone >= 10 },
  { id: "host6", icon: "🎓", name: "學完一位", desc: "看完任一位主講的 6 份課程", test: (f) => f.hostsDone.length >= 1 },
  { id: "course18", icon: "🧠", name: "全部修完", desc: "看完 18 份教學課程", test: (f) => f.courseDone >= 18 },
  { id: "notes10", icon: "✍️", name: "筆記達人", desc: "寫了 10 則筆記", test: (f) => f.notes >= 10 },
  { id: "question", icon: "🙋", name: "勇於發問", desc: "第一次提問", test: (f) => f.questions >= 1 },
];
export const badgeById = (id) => BADGES.find((b) => b.id === id) || null;
export const earnedBadges = (f) => BADGES.filter((b) => b.test(f)).map((b) => b.id);

// ── 外觀主題（2026-10-18）──
// 前三個大家都能用；後面三個要先拿到對應的徽章（unlock）。管理員全部都能用
export const THEMES = [
  { id: "board", name: "營業廳", desc: "墨綠灰底、琥珀數字（預設）", swatch: ["#0F1412", "#141B18", "#CDA45E"] },
  { id: "night", name: "夜盤", desc: "深藍底、冷藍數字", swatch: ["#0E121A", "#131925", "#7FB2E5"] },
  { id: "paper", name: "晨報", desc: "米白紙色的淺色主題", swatch: ["#F4F1EA", "#FFFDF8", "#875B14"] },
  { id: "vault", name: "金庫", desc: "黑金", unlock: "qualified", swatch: ["#0D0C0A", "#15130F", "#E2B65C"] },
  { id: "aurora", name: "極光", desc: "深紫底、青綠數字", unlock: "streak3", swatch: ["#100F1A", "#161524", "#8FD3C1"] },
  { id: "chalk", name: "黑板", desc: "教室黑板綠、粉筆黃", unlock: "course18", swatch: ["#17241F", "#1C2C26", "#F0D27A"] },
];
export const DEFAULT_THEME = "board";
export const themeById = (id) => THEMES.find((t) => t.id === id) || null;
// 這個人能不能用這個主題：earned = 已經拿到的徽章 id
export const themeUnlocked = (id, earned = [], isAdmin = false) => {
  const t = themeById(id);
  return !!t && (isAdmin || !t.unlock || earned.includes(t.unlock));
};
