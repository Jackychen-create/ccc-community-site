// 每月交易量：逐筆填、貼上一整批、改門檻；新達標的人資格自動延長（規則在 shared/rules.js）
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { cycleEnd, goalOf, unitOf, bestProgress, gapText, ruleText } from "../shared/rules.js";
import { fail, loadingBox } from "./common.js";
import { markMembersStale } from "./members.js";

// 每月交易量（任一間達標 → 從達標日起看一個月）；Bybit、BingX 是自動同步的，這裡只顯示不能改
let vol = null; // 伺服器回來的這個月資料
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
const shortUsd = (n) => (n >= 1e4 ? `${Math.round((n / 1e4) * 10) / 10} 萬` : fmtUsd(n));

$("#volMonth").value = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
$("#volMonth").addEventListener("change", () => loadVolumes());
$("#volQualOn").addEventListener("change", () => vol && vol._refresh && vol._refresh());
$("#volQualOn").value = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const mdv = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export async function loadVolumes() {
  const box = $("#volBox");
  box.replaceChildren(loadingBox());
  try {
    [vol, sync] = await Promise.all([
      api(`/api/admin/volumes?month=${encodeURIComponent($("#volMonth").value)}`),
      api("/api/admin/sync").then((r) => r.exchanges).catch(() => null),
    ]);
    renderVolumes();
  } catch (e) {
    fail(e);
  }
}

function renderVolumes() {
  const { exchanges, threshold, rows } = vol;
  $("#volThreshold").replaceChildren(icon("edit"), `門檻 ${shortUsd(threshold)} USDT`);
  const passed = rows.filter((r) => r.qualified).length;
  $("#volSub").textContent = `${ruleText(threshold, exchanges)}，達標那天起可以看一個月（例如 10/15 達標，看到 11/14）。這個月 ${passed}／${rows.length} 位達標。`;
  const box = $("#volBox");
  if (!rows.length) {
    box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有研究員" })));
    return;
  }
  const inputs = new Map(); // user_id → {ex: input}
  const saveBtn = el("button", { class: "btn primary", type: "button", disabled: true }, "儲存這個月的交易量");
  const dirty = new Set();
  const refreshers = [];
  const resultCell = (r, cell) => {
    const amounts = Object.fromEntries(exchanges.map((ex) => [ex, parseAmount(inputs.get(r.user_id)[ex].value) || 0]));
    const best = bestProgress(amounts, threshold, exchanges);
    const ok = best.ratio >= 1;
    const qualOn = r.qualified_at || $("#volQualOn").value;
    cell.replaceChildren(
      ok ? el("span", { class: "pill good", title: `${mdv(qualOn)} 達標，看到 ${mdv(cycleEnd(qualOn))}` }, el("span", { class: "dot" }), `達標 ${mdv(qualOn)}→${mdv(cycleEnd(qualOn))}`)
         : el("span", { class: "small muted" }, best.n ? gapText(amounts, threshold, exchanges) : "未填"),
      el("span", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: Math.min(100, best.ratio * 100) + "%" } })))
    );
  };
  const accessText = (r) => (!r.access_until ? "不限" : r.access_until < new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) ? `已過期 ${r.access_until}` : `到 ${r.access_until}`);
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
      if (auto) return el("td", { "data-label": ex }, inp, el("div", { class: "small muted vol-uid", text: r.links?.[ex] ? `UID ${r.links[ex]}` : "未綁定" }));
      return el("td", { "data-label": ex }, inp);
    });
    inputs.set(r.user_id, map);
    resultCell(r, result);
    refreshers.push(() => resultCell(r, result));
    return el("tr", null,
      el("td", null, el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: r.email }),
        r.banned ? el("span", { class: "pill warn", style: { marginTop: "6px" } }, "已停權") : null,
        r.updated_by ? el("div", { class: "small muted", text: `${A.fmtRel(r.updated_at)} 由 ${r.updated_by.split("@")[0]} 更新` }) : null),
      ...cells,
      result,
      el("td", { class: "small hide-sm", text: accessText(r) }));
  });
  box.replaceChildren(
    syncBar(),
    el("div", { class: "table-wrap" },
      el("table", { class: "table stack vol-table" },
        el("thead", null, el("tr", null, el("th", { text: "研究員" }), ...exchanges.map((ex) => el("th", { text: isAuto(ex) ? `${ex}（自動）` : `${ex}（${unitOf(ex)}）` })), el("th", { text: "結果" }), el("th", { class: "hide-sm", text: "觀看資格" }))),
        el("tbody", null, trs))),
    el("div", { class: "vol-foot" },
      el("p", { class: "small muted", text: "USDT 可以打 1000000、1,000,000、100萬 或 1m；UM 填手數，例如 10 或 2.5。這次新達標的人，資格延長到「達標日」起一個月；這個月已經達標過的不會再延；「不限」的研究員不會被改。" }),
      saveBtn)
  );
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
      const r = await api("/api/admin/volumes", { method: "POST", body: { month: vol.month, qualifiedOn: $("#volQualOn").value, rows: out } });
      vol = r;
      renderVolumes();
      A.toast(r.extended ? `已儲存 ${r.saved} 位，${r.extended} 位的資格延長到 ${r.until}` : `已儲存 ${r.saved} 位`);
      markMembersStale();
    } catch (e) {
      A.setBusy(saveBtn, false);
      fail(e);
    }
  });
}

// 自動同步狀態：每間交易所一列（設定好了沒、綁定幾位、上次同步）、一顆「立即同步」
function syncBar() {
  if (!sync) return null;
  const list = vol.autoExchanges.filter((ex) => sync[ex]);
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

// 修改門檻
$("#volThreshold").addEventListener("click", () => {
  if (!vol) return;
  const inp = el("input", { class: "input num", type: "text", inputmode: "decimal", value: fmtUsd(vol.threshold) });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: "儲存門檻" });
  const m = A.modal({
    title: "交易量門檻",
    body: el("div", null,
      el("label", { class: "field" }, el("span", { class: "label", text: `${vol.exchanges.filter((ex) => unitOf(ex) === "USDT").join("、")} 任一間當月成交金額（USDT）達到` }), inp),
      el("p", { class: "hint", text: "UM 固定是一個月 10 手，不在這裡改。改了之後，這個月已經填過的交易量會照新門檻重新判斷，但已經延長的資格不會被收回。" }),
      err),
    actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), save],
  });
  save.addEventListener("click", async () => {
    const n = parseAmount(inp.value);
    if (!n || Number.isNaN(n)) {
      err.textContent = "請輸入大於 0 的數字";
      err.hidden = false;
      return;
    }
    A.setBusy(save, true, "儲存中…");
    try {
      await api("/api/admin/volumes", { method: "PATCH", body: { threshold: n } });
      m.close();
      A.toast(`門檻改成 ${fmtUsd(n)} USDT`);
      loadVolumes();
    } catch (e) {
      A.setBusy(save, false);
      err.textContent = e.message;
      err.hidden = false;
    }
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
    body: el("div", null, el("p", { class: "small sub", style: { marginTop: "14px" }, text: `從交易所後台或試算表複製${manual.length > 1 ? `，順序是 ${manual.join("、")}` : `，填的是 ${manual[0]} 的交易量`}（${vol.autoExchanges.join("、")} 會自動同步，不用填）。填進表格後檢查一下，再按「儲存這個月的交易量」。` }), el("div", { class: "field" }, ta), out),
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
    A.toast(`已填進 ${filled} 位，檢查後按「儲存這個月的交易量」`);
  });
});
