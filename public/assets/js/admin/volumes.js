// 每月交易量：逐筆填、貼上一整批、改門檻；新達標的人資格自動延長（規則在 shared/rules.js）
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { cycleEnd } from "../shared/rules.js";
import { fail, loadingBox } from "./common.js";
import { markMembersStale } from "./members.js";

// 每月交易量（OKX、Bybit、UM 任一間達標 → 從達標日起看一個月）
let vol = null; // 伺服器回來的這個月資料
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
    vol = await api(`/api/admin/volumes?month=${encodeURIComponent($("#volMonth").value)}`);
    renderVolumes();
  } catch (e) {
    fail(e);
  }
}

function renderVolumes() {
  const { exchanges, threshold, rows } = vol;
  $("#volThreshold").replaceChildren(icon("edit"), `門檻 ${shortUsd(threshold)} USDT`);
  const passed = rows.filter((r) => r.qualified).length;
  $("#volSub").textContent = `${exchanges.join("、")} 任一間當月成交金額達 ${fmtUsd(threshold)} USDT，達標那天起可以看一個月（例如 10/15 達標，看到 11/14）。這個月 ${passed}／${rows.length} 位達標。`;
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
    const vals = exchanges.map((ex) => parseAmount(inputs.get(r.user_id)[ex].value) || 0);
    const best = Math.max(0, ...vals);
    const ok = vals.some((v) => v >= threshold);
    const qualOn = r.qualified_at || $("#volQualOn").value;
    cell.replaceChildren(
      ok ? el("span", { class: "pill good", title: `${mdv(qualOn)} 達標，看到 ${mdv(cycleEnd(qualOn))}` }, el("span", { class: "dot" }), `達標 ${mdv(qualOn)}→${mdv(cycleEnd(qualOn))}`)
         : el("span", { class: "small muted" }, best ? `還差 ${shortUsd(threshold - best)}` : "未填"),
      el("span", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: Math.min(100, (best / threshold) * 100) + "%" } })))
    );
  };
  const accessText = (r) => (!r.access_until ? "不限" : r.access_until < new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) ? `已過期 ${r.access_until}` : `到 ${r.access_until}`);
  const trs = rows.map((r) => {
    const map = {};
    const result = el("td", { class: "vol-result" });
    const cells = exchanges.map((ex) => {
      const inp = el("input", { class: "input vol-input num", type: "text", inputmode: "decimal", "aria-label": `${r.email} ${ex} 交易量`, placeholder: "0",
        value: r.amounts?.[ex] ? fmtUsd(r.amounts[ex]) : "" });
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
    el("div", { class: "table-wrap" },
      el("table", { class: "table stack vol-table" },
        el("thead", null, el("tr", null, el("th", { text: "研究員" }), ...exchanges.map((ex) => el("th", { text: `${ex}（USDT）` })), el("th", { text: "結果" }), el("th", { class: "hide-sm", text: "觀看資格" }))),
        el("tbody", null, trs))),
    el("div", { class: "vol-foot" },
      el("p", { class: "small muted", text: "可以打 3300000、3,300,000、330萬 或 3.3m。這次新達標的人，資格延長到「達標日」起一個月；這個月已經達標過的不會再延；「不限」的研究員不會被改。" }),
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
      for (const ex of exchanges) {
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

// 修改門檻
$("#volThreshold").addEventListener("click", () => {
  if (!vol) return;
  const inp = el("input", { class: "input num", type: "text", inputmode: "decimal", value: fmtUsd(vol.threshold) });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: "儲存門檻" });
  const m = A.modal({
    title: "交易量門檻",
    body: el("div", null,
      el("label", { class: "field" }, el("span", { class: "label", text: "任一間交易所當月成交金額（USDT）達到" }), inp),
      el("p", { class: "hint", text: "改了之後，這個月已經填過的交易量會照新門檻重新判斷，但已經延長的資格不會被收回。" }),
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

// 貼上一整批：每行「Email 交易所 金額」或「Email OKX Bybit UM」
$("#volPaste").addEventListener("click", () => {
  if (!vol || !vol._inputs) return;
  const ta = el("textarea", { class: "textarea mono-ish", rows: "8", placeholder: "每行一位，例如：\namy@example.com OKX 3,500,000\nbob@gmail.com Bybit 120萬\n或照順序填三間：\namy@example.com 0 3500000 0" });
  const out = el("div", { class: "hint" });
  const apply = el("button", { class: "btn primary", type: "button", text: "填進表格" });
  const m = A.modal({
    title: "貼上一整批交易量",
    body: el("div", null, el("p", { class: "small sub", style: { marginTop: "14px" }, text: `從交易所後台或試算表複製，順序是 ${vol.exchanges.join("、")}。填進表格後檢查一下，再按「儲存這個月的交易量」。` }), el("div", { class: "field" }, ta), out),
    actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), apply],
  });
  let done = false;
  apply.addEventListener("click", () => {
    if (done) return m.close();
    const byEmail = new Map(vol.rows.map((r) => [r.email.toLowerCase(), r.user_id]));
    const exLower = new Map(vol.exchanges.map((e) => [e.toLowerCase(), e]));
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
      } else if (parts.length === vol.exchanges.length + 1) {
        const nums = parts.slice(1).map(parseAmount);
        if (nums.some((n) => n === null || Number.isNaN(n))) return bad.push(i + 1);
        vol.exchanges.forEach((ex, k) => (map[ex].value = fmtUsd(nums[k])));
      } else return bad.push(i + 1);
      map[vol.exchanges[0]].dispatchEvent(new Event("input"));
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
