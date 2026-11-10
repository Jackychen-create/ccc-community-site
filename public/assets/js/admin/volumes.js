// 交易量：逐筆填、貼上一整批；三級制度，那一輪達到第幾級＝下一輪的等級（規則在 shared/rules.js 的 TIERS）
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { UNIT_USDT, ONE_ON_ONE_USDT, COURSE_PARTS, fmtAmount, unitOf, idLabel, TIERS, MAX_TIER, SITE_TIER, tierOf, tierName, tierRuleText, progressTo, gapTo } from "../shared/rules.js";
import { fail, loadingBox, segTabs } from "./common.js";
import { markMembersStale } from "./members.js";

// Bybit、BingX 是自動同步的，這裡只顯示不能改
let vol = null; // 伺服器回來的這個月資料
let membership = null; // 會員制度 { unitFrom, on, today }（主要管理員才拿得到）
let sync = null; // 自動同步狀態 /api/admin/sync：{ Bybit: { configured, linked, last }, BingX: {...} }
const isAuto = (ex) => (vol?.autoExchanges || []).includes(ex);
const manualExchanges = () => vol.exchanges.filter((ex) => !isAuto(ex));
const fmtUsd = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const parseAmount = (t) => {
  const s = String(t || "").replace(/[,\s，]/g, "").replace(/usdt?$/i, "");
  if (!s) return null;
  // 支援 330萬、1.2m、500k
  const m = s.match(/^(\d+(?:\.\d+)?)(萬|w|m|k)?$/i);
  if (!m) return NaN;
  const mult = { "萬": 1e4, w: 1e4, W: 1e4, m: 1e6, M: 1e6, k: 1e3, K: 1e3 }[m[2]] || 1;
  return Math.round(Number(m[1]) * mult * 100) / 100;
};

// 這一輪／上一輪（每個人的一輪不一樣，從加入那天起算）
let which = "current";
let volTab = "active"; // active 正常 | banned 已停權（停權的人分開放，不算進達標人數）
document.querySelectorAll("#volWhich .vol-seg-btn").forEach((b) => b.addEventListener("click", () => {
  which = b.dataset.which;
  document.querySelectorAll("#volWhich .vol-seg-btn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  loadVolumes();
}));
$("#volQualOn").addEventListener("change", () => vol && vol._refresh && vol._refresh());
$("#volQualOn").value = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const mdv = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export async function loadVolumes() {
  const box = $("#volBox");
  box.replaceChildren(loadingBox());
  try {
    [vol, sync] = await Promise.all([
      api(`/api/admin/volumes?which=${which}`),
      api("/api/admin/sync").then((r) => r.exchanges).catch(() => null),
    ]);
    membership = await api("/api/admin/membership").catch(() => null);
    renderVolumes();
  } catch (e) {
    fail(e);
  }
}

function renderVolumes() {
  const { exchanges, rows } = vol;
  $("#volThreshold").replaceChildren(icon("chart"), "三級門檻");
  const active = rows.filter((r) => !r.banned);
  const bannedCount = rows.length - active.length;
  if (!bannedCount) volTab = "active";
  const count = (t) => active.filter((r) => !r.free && r.cycle_tier === t).length; // 贈送名額不分級，不算
  $("#volSub").textContent = `每人從加入那天起算，每一輪一個月；那一輪達到第幾級，下一輪就是第幾級。${which === "previous" ? "上一輪" : "這一輪"}：${[3, 2, 1].map((t) => `${tierName(t)} ${count(t)} 位`).join("、")}、還沒到第一級 ${count(0)} 位${bannedCount ? `（不含 ${bannedCount} 位已停權）` : ""}。`;
  const box = $("#volBox");
  if (!rows.length) {
    box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: which === "previous" ? "大家都還在第一輪，沒有上一輪" : "還沒有研究員" })));
    return;
  }
  const inputs = new Map(); // user_id → {ex: input}
  const saveBtn = el("button", { class: "btn primary", type: "button", disabled: true }, which === "previous" ? "儲存上一輪的交易量" : "儲存這一輪的交易量");
  const dirty = new Set();
  const refreshers = [];
  // 結果：這一輪達到第幾級、往下一級還差多少
  const resultCell = (r, cell) => {
    const amounts = Object.fromEntries(exchanges.map((ex) => [ex, parseAmount(inputs.get(r.user_id)[ex].value) || 0]));
    const t = tierOf(amounts);
    const next = Math.min(MAX_TIER, t + 1);
    const best = progressTo(amounts, next, exchanges);
    cell.replaceChildren(
      el("span", { class: "pill" + (t >= SITE_TIER ? " good" : ""), title: t ? `下一輪（到 ${mdv(r.next_end)}）是${tierName(t)}` : "還沒到第一級" }, t >= SITE_TIER ? el("span", { class: "dot" }) : null, tierName(t)),
      t < MAX_TIER ? el("span", { class: "small muted", style: { marginLeft: "6px" } }, best.n || t ? `${tierName(next)}${gapTo(amounts, next, exchanges)}` : "未填") : null,
      el("span", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: (t >= MAX_TIER ? 100 : Math.min(100, best.ratio * 100)) + "%" } })))
    );
  };
  const accessText = (r) => (r.unit ? `累計 ${fmtAmount("", r.unit.cum)}・系統分享 ${r.unit.units}／${COURSE_PARTS}${r.unit.oneOnOne ? "・可一對一" : ""}` : r.free ? "贈送（不分級）" : `${tierName(r.tier)}${r.tier ? (r.tier_until ? `，到 ${mdv(r.tier_until)}` : "，不限") : ""}`);
  const trs = rows.map((r) => {
    const map = {};
    const result = el("td", { class: "vol-result" });
    const cells = exchanges.map((ex) => {
      const auto = isAuto(ex);
      const inp = el("input", { class: "input vol-input num" + (auto ? " auto" : ""), type: "text", inputmode: "decimal", "aria-label": `${r.email} ${ex} 交易量`, placeholder: auto ? "—" : unitOf(ex) === "手" ? "0 手" : "0",
        value: r.amounts?.[ex] ? fmtUsd(r.amounts[ex]) : "", readonly: auto, title: auto ? `${ex} 每天自動同步，不用手動填` : null });
      inp.addEventListener("input", () => {
        dirty.add(r.user_id);
        saveBtn.disabled = false;
        inp.classList.toggle("bad", Number.isNaN(parseAmount(inp.value)));
        resultCell(r, result);
      });
      inp.addEventListener("blur", () => {
        const n = parseAmount(inp.value);
        if (n !== null && !Number.isNaN(n)) inp.value = fmtUsd(n);
      });
      map[ex] = inp;
      // 填過 UID（UM 是 MT5 帳號）就顯示在下面，對交易所後台時用；自動同步的沒綁就寫「未綁定」
      const uid = r.links?.[ex];
      return el("td", { "data-label": ex }, inp, uid || auto ? el("div", { class: "small muted vol-uid", text: uid ? `${idLabel(ex)} ${uid}` : "未綁定" }) : null);
    });
    inputs.set(r.user_id, map);
    resultCell(r, result);
    refreshers.push(() => resultCell(r, result));
    return el("tr", { "data-group": r.banned ? "banned" : "active", hidden: (r.banned ? "banned" : "active") !== volTab },
      el("td", null, el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: r.email }),
        el("div", { class: "small vol-period num", text: `${which === "previous" ? "上一輪" : "這一輪"} ${mdv(r.period_start)}～${mdv(r.period_end)}` }),
        r.banned ? el("span", { class: "pill warn", style: { marginTop: "6px" } }, "已停權") : null,
        r.updated_by ? el("div", { class: "small muted", text: `${A.fmtRel(r.updated_at)} 由 ${r.updated_by.split("@")[0]} 更新` }) : null),
      ...cells,
      result,
      el("td", { class: "small hide-sm", text: accessText(r) }));
  });
  // 正常／已停權分開看（切換不會弄掉還沒存的數字）
  const empty = el("div", { class: "empty", hidden: true }, el("p", { text: "這一組沒有研究員" }));
  const showTab = () => {
    trs.forEach((tr) => (tr.hidden = tr.dataset.group !== volTab));
    empty.hidden = trs.some((tr) => !tr.hidden);
  };
  const tabs = bannedCount ? segTabs([{ key: "active", label: "正常", count: active.length }, { key: "banned", label: "已停權", count: bannedCount }], volTab, (k) => {
    volTab = k;
    tabs.querySelectorAll(".vol-seg-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === k)));
    showTab();
  }, "研究員分組") : null;
  box.replaceChildren(
    ...[membershipBar(), syncBar(), tabs].filter(Boolean),
    el("div", { class: "table-wrap" },
      el("table", { class: "table stack vol-table" },
        el("thead", null, el("tr", null, el("th", { text: "研究員" }), ...exchanges.map((ex) => el("th", { text: isAuto(ex) ? `${ex}（自動）` : `${ex}（${unitOf(ex)}）` })), el("th", { text: "這一輪達到" }), el("th", { class: "hide-sm", text: "今天的等級" }))),
        el("tbody", null, trs)), empty),
    el("div", { class: "vol-foot" },
      el("p", { class: "small muted", text: `USDT 可以打 1000000、1,000,000、100萬 或 1m；UM 填手數，例如 10 或 2.5。每個人填的是他自己那一輪（名字下面的日期）的交易量。${TIERS.map((t) => `${tierName(t.tier)}：${tierRuleText(t.tier)}`).join("；")}。升級的人會收到通知。` }),
      saveBtn)
  );
  showTab();
  vol._inputs = inputs;
  vol._dirty = dirty;
  vol._refresh = () => refreshers.forEach((f) => f());
  vol._markDirty = () => (saveBtn.disabled = false);
  saveBtn.addEventListener("click", async () => {
    const out = [];
    for (const id of dirty) {
      const amounts = {};
      for (const ex of manualExchanges()) {
        const n = parseAmount(inputs.get(id)[ex].value);
        if (Number.isNaN(n)) return A.toast("有數字看不懂（紅框），請修正後再存", "err");
        if (n !== null) amounts[ex] = n;
      }
      out.push({ userId: id, amounts });
    }
    if (!out.length) return;
    A.setBusy(saveBtn, true, "儲存中…");
    try {
      const r = await api("/api/admin/volumes", { method: "POST", body: { which, qualifiedOn: $("#volQualOn").value, rows: out } });
      vol = r;
      renderVolumes();
      A.toast(r.tierUps ? `已儲存 ${r.saved} 位，${r.tierUps} 位升級（已通知）` : `已儲存 ${r.saved} 位`);
      markMembersStale();
    } catch (e) {
      A.setBusy(saveBtn, false);
      fail(e);
    }
  });
}

// 會員制度：設定哪一天起改成單位制（累計每 20 萬解鎖一份系統分享）
function membershipBar() {
  if (!membership) return null;
  const input = el("input", { type: "date", class: "input", value: membership.unitFrom || "", "aria-label": "單位制開始日期", style: { width: "170px" } });
  const status = membership.on
    ? `現在是單位制（${membership.unitFrom} 起）：累計交易量每 ${UNIT_USDT / 1e4} 萬解鎖一份系統分享、${ONE_ON_ONE_USDT / 1e4} 萬可以一對一，直播留檔加入就能看。`
    : membership.unitFrom
    ? `${membership.unitFrom} 起改成單位制，在那之前照三級制度。`
    : "現在是三級制度。設定日期後，那天起改成單位制（累計每 20 萬解鎖一份系統分享）。";
  const save = async (v, btn) => {
    A.setBusy(btn, true);
    try {
      membership = await api("/api/admin/membership", { method: "PUT", body: { unitFrom: v } });
      A.toast(v ? `已設定：${v} 起改成單位制` : "已取消，維持三級制度");
      markMembersStale();
      loadVolumes();
    } catch (e) { fail(e); } finally { A.setBusy(btn, false); }
  };
  const setBtn = el("button", { class: "btn sm", type: "button", text: "儲存日期", onclick: () => save(input.value, setBtn) });
  const clearBtn = membership.unitFrom ? el("button", { class: "btn sm ghost", type: "button", text: "取消", onclick: () => save("", clearBtn) }) : null;
  return el("div", { class: "vol-mship", style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 12px", marginBottom: "12px", padding: "10px 14px", border: "1px solid var(--line)", borderRadius: "10px" } },
    el("b", { text: "會員制度" }), el("span", { class: "muted small", text: status, style: { flex: "1 1 320px" } }),
    input, setBtn, clearBtn);
}

// 自動同步狀態：每間交易所一列（設定好了沒、綁定幾位、上次同步）、一顆「立即同步」
function syncBar() {
  if (!sync) return null;
  const list = (vol.syncExchanges || vol.autoExchanges).filter((ex) => sync[ex]);
  if (!list.length) return null;
  const ready = list.filter((ex) => sync[ex].configured);
  const line = (ex) => {
    const s = sync[ex];
    if (!s.configured) return el("div", { class: "bx-line" }, el("b", { text: ex }), el("span", { class: "muted", text: `還沒設定：要在 Cloudflare 填 ${ex.toUpperCase()}_API_KEY、${ex.toUpperCase()}_SECRET_KEY（說明在 docs/部署與設定.md）` }));
    const last = s.last;
    const text = !last ? "還沒同步過" : last.ok ? `上次同步 ${A.fmtRel(last.at)}` : `上次同步失敗（${A.fmtRel(last.at)}）：${last.error || ""}`;
    return el("div", { class: "bx-line" }, el("b", { text: ex }), el("span", null, `已綁定 ${s.linked} 位・每天自動同步・`, el("span", { class: last && !last.ok ? "warn-text" : "muted", text })));
  };
  const btn = ready.length ? el("button", { class: "btn sm", type: "button", text: "立即同步" }) : null;
  btn?.addEventListener("click", async () => {
    A.setBusy(btn, true, "同步中…");
    try {
      await api("/api/admin/sync", { method: "POST", body: {} });
      A.toast(`已同步 ${ready.join("、")} 交易量`);
      markMembersStale();
      loadVolumes();
    } catch (e) {
      A.setBusy(btn, false);
      fail(e);
    }
  });
  const bad = list.some((ex) => sync[ex].last && !sync[ex].last.ok);
  return el("div", { class: "bx-bar" + (bad ? " bad" : "") }, el("div", { class: "bx-lines small" }, ...list.map(line)), btn);
}

// 三級門檻（固定在 shared/rules.js，後台只能看）
$("#volThreshold").addEventListener("click", () => {
  const m = A.modal({
    title: "三級門檻",
    body: el("div", null,
      el("p", { class: "small sub", style: { marginTop: "12px" }, text: "每人從加入那天起算，一輪一個月。那一輪任一間交易所達到某一級 → 那一輪剩下的時間和下一輪都是那一級；沒達到第一級，下一輪就沒有等級。新研究員第一輪先是第二級。" }),
      el("ol", { class: "tier-table", style: { marginTop: "12px" } }, ...TIERS.map((t) => el("li", { class: "tier-card" },
        el("b", { text: tierName(t.tier) }), el("div", { class: "tier-goal num", text: tierRuleText(t.tier) }),
        el("ul", null, ...t.perks.map((x) => el("li", { text: x })))))),
      el("p", { class: "hint", text: "要改門檻請跟工程這邊說（改 shared/rules.js 的 TIERS），全站會一起改。研究員要特別處理，用「研究員」頁的「等級」按鈕手動給。" })),
    actions: [el("button", { class: "btn", type: "button", text: "關閉", onclick: () => m.close() })],
  });
});

// 貼上一整批：每行「Email 交易所 金額」或「Email OKX Bybit」（照手動填的交易所順序）
$("#volPaste").addEventListener("click", () => {
  if (!vol || !vol._inputs) return;
  const manual = manualExchanges();
  const sample = (ex, big) => (unitOf(ex) === "手" ? (big ? "12" : "2.5") : big ? "3,500,000" : "120萬");
  const ta = el("textarea", { class: "textarea mono-ish", rows: "8", placeholder: manual.length > 1
    ? `每行一位，例如：\namy@example.com ${manual[0]} ${sample(manual[0], true)}\nbob@gmail.com ${manual[1]} ${sample(manual[1], false)}\n或照順序填 ${manual.join("、")}：\namy@example.com ${manual.map((ex, i) => (i === 1 ? sample(ex, true).replace(/,/g, "") : "0")).join(" ")}`
    : `每行一位，例如：\namy@example.com ${sample(manual[0], true)}\nbob@gmail.com ${manual[0]} ${sample(manual[0], false)}` });
  const out = el("div", { class: "hint" });
  const apply = el("button", { class: "btn primary", type: "button", text: "填進表格" });
  const m = A.modal({
    title: "貼上一整批交易量",
    body: el("div", null, el("p", { class: "small sub", style: { marginTop: "14px" }, text: `從交易所後台或試算表複製${manual.length > 1 ? `，順序是 ${manual.join("、")}` : `，填的是 ${manual[0]} 的交易量`}（${vol.autoExchanges.join("、")} 會自動同步，不用填）。填進表格後檢查一下，再按「儲存這一輪的交易量」。` }), el("div", { class: "field" }, ta), out),
    actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), apply],
  });
  let done = false;
  apply.addEventListener("click", () => {
    if (done) return m.close();
    const byEmail = new Map(vol.rows.map((r) => [r.email.toLowerCase(), r.user_id]));
    const exLower = new Map(manualExchanges().map((e) => [e.toLowerCase(), e]));
    let filled = 0;
    const missing = [];
    const bad = [];
    ta.value.split(/\r?\n/).forEach((line, i) => {
      // 試算表複製是 Tab 分隔；手打是空白分隔（數字裡的千分位逗號保留）；都沒有才當成 CSV 逗號分隔
      const t = line.trim();
      let parts = t.includes("\t") ? t.split(/\t+/) : t.split(/\s+/);
      if (parts.length === 1) parts = t.split(/[,，]/);
      parts = parts.map((x) => x.trim()).filter(Boolean);
      if (!parts.length) return;
      const email = (parts[0] || "").toLowerCase();
      const id = byEmail.get(email);
      if (!id) return missing.push(parts[0]);
      const map = vol._inputs.get(id);
      if (parts.length >= 3 && exLower.has(parts[1].toLowerCase())) {
        const n = parseAmount(parts.slice(2).join(""));
        if (n === null || Number.isNaN(n)) return bad.push(i + 1);
        map[exLower.get(parts[1].toLowerCase())].value = fmtUsd(n);
      } else if (parts.length === manualExchanges().length + 1) {
        const nums = parts.slice(1).map(parseAmount);
        if (nums.some((n) => n === null || Number.isNaN(n))) return bad.push(i + 1);
        vol.exchanges.forEach((ex, k) => (map[ex].value = fmtUsd(nums[k])));
      } else return bad.push(i + 1);
      map[manualExchanges()[0]].dispatchEvent(new Event("input"));
      filled++;
    });
    if (bad.length || missing.length) {
      out.textContent = [
        filled ? `已填進 ${filled} 行。` : "",
        missing.length ? `找不到這些研究員：${missing.slice(0, 5).join("、")}${missing.length > 5 ? " 等" : ""}。` : "",
        bad.length ? `第 ${bad.slice(0, 8).join("、")} 行看不懂。` : "",
      ].join(" ");
      out.classList.add("warn-text");
      if (!filled) return;
      apply.textContent = "知道了";
      done = true;
      return;
    }
    m.close();
    A.toast(`已填進 ${filled} 位，檢查後按儲存`);
  });
});
