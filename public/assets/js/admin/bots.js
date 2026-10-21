// 機器人：Webhook 出口、每支機器人的開關／貼到哪／討論串／選項、預覽、立即發一次、最近的執行結果
// 伺服器在 server/admin/bots.js；機器人本身跑在 Supabase Edge Function「bots」（supabase/functions/bots/）
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { fail, loadingBox } from "./common.js";

let data = null;
export async function loadBots() {
  const box = $("#botsBox");
  if (!data) box.replaceChildren(loadingBox());
  try {
    data = await api("/api/admin/bots");
  } catch (e) {
    return fail(e);
  }
  render();
}

const ago = (iso) => A.fmtRel(iso);
async function patch(body, msg) {
  const r = await api("/api/admin/bots", { method: "PATCH", body });
  if (msg) A.toast(msg);
  return r;
}

function outletsCard() {
  const name = el("input", { class: "input", type: "text", maxlength: "30", placeholder: "名字，例如「股市整合頻道」", "aria-label": "Webhook 名字" });
  const url = el("input", { class: "input num", type: "password", autocomplete: "off", placeholder: "Webhook 網址 https://discord.com/api/webhooks/…", "aria-label": "Webhook 網址" });
  const add = el("button", { class: "btn primary", type: "button" }, icon("plus"), "新增");
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  add.addEventListener("click", async () => {
    err.hidden = true;
    A.setBusy(add, true, "確認中…");
    try {
      await patch({ addOutlet: { name: name.value, url: url.value } }, "已新增 Webhook");
      loadBots();
    } catch (e) {
      A.setBusy(add, false);
      err.textContent = e.message;
      err.hidden = false;
    }
  });
  const alertSel = el("select", { class: "input", "aria-label": "出錯時通知" },
    el("option", { value: "", text: "不通知" }), ...data.outlets.map((o) => el("option", { value: o.id, text: o.name })));
  alertSel.value = data.alertOutlet || "";
  alertSel.addEventListener("change", async () => { try { await patch({ alertOutlet: alertSel.value }, alertSel.value ? "機器人出錯時會通知這個 Webhook" : "出錯不通知"); data.alertOutlet = alertSel.value; } catch (e) { A.toast(e.message, "err"); } });
  const used = (id) => data.bots.filter((b) => b.conf.outlet === id).map((b) => b.name);
  return el("section", { class: "card bot-outlets" },
    el("h2", { text: "Webhook（要貼到的頻道）" }),
    el("p", { class: "small sub", style: { marginTop: "4px" }, text: "在 Discord 頻道設定 → 整合 → Webhook → 新 Webhook，取名、換頭像，複製網址貼到這裡。同一個頻道底下的討論串可以共用一個 Webhook（每支機器人再填討論串 ID）。網址存好後不會再顯示。" }),
    data.outlets.length ? el("div", { style: { marginTop: "10px" } }, ...data.outlets.map((o) => {
      const rm = el("button", { class: "btn sm ghost", type: "button", text: "移除" });
      rm.addEventListener("click", async () => {
        const u = used(o.id);
        if (!(await A.confirmDialog({ title: `移除「${o.name}」？`, message: u.length ? `${u.join("、")} 會變成沒設定、先關掉。` : "沒有機器人用到它。", confirmText: "移除", danger: true }))) return;
        try { await patch({ removeOutlet: o.id }, "已移除"); loadBots(); } catch (e) { A.toast(e.message, "err"); }
      });
      const u = used(o.id);
      return el("div", { class: "bot-outlet" },
        el("div", { class: "grow" }, el("b", { text: o.name }), el("div", { class: "small muted", text: `${o.hookName ? `Discord 上叫「${o.hookName}」・` : ""}網址 …${o.tail}${u.length ? `・${u.length} 支機器人在用` : ""}` })),
        rm);
    })) : el("p", { class: "small muted", style: { marginTop: "10px" }, text: "還沒有 Webhook。" }),
    el("div", { class: "bot-add" }, name, url, add),
    err,
    el("label", { class: "field", style: { marginTop: "14px", maxWidth: "320px" } }, el("span", { class: "label", text: "機器人出錯時通知（建議選管理員頻道）" }), alertSel));
}

function lastRunLine(b) {
  const r = b.runs[0];
  if (!r) return el("div", { class: "bot-last", text: b.conf.enabled ? "還沒跑過" : "" });
  return el("div", { class: "bot-last" },
    el("span", { class: r.ok ? "" : "bad", text: `${r.ok ? (r.posted ? "✓ 已發" : "・") : "⚠️ 出錯"}　${ago(r.at)}` }),
    r.note ? el("span", { text: `　${r.note}` }) : null);
}

function renderEmbed(e) {
  return el("div", { class: "bot-embed", style: e.color ? { borderLeftColor: `#${Number(e.color).toString(16).padStart(6, "0")}` } : null },
    e.title ? el("h4", { text: e.title }) : null,
    e.description ? el("div", { class: "d", text: e.description.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/\*\*/g, "") }) : null,
    ...(e.fields || []).map((f) => el("div", { class: "f" }, el("b", { text: f.name }), el("div", { text: String(f.value).replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1") }))),
    e.footer?.text ? el("div", { class: "ft", text: e.footer.text }) : null);
}

function botCard(b) {
  const c = b.conf;
  const sw = el("input", { type: "checkbox", "aria-label": `開關 ${b.name}` });
  sw.checked = !!c.enabled;
  const outlet = el("select", { class: "input", "aria-label": `${b.name} 貼到哪個 Webhook` },
    el("option", { value: "", text: "選 Webhook" }), ...data.outlets.map((o) => el("option", { value: o.id, text: o.name })));
  outlet.value = c.outlet || "";
  const thread = el("input", { class: "input num", type: "text", placeholder: "討論串 ID（不用就空白）", value: c.thread || "", "aria-label": `${b.name} 的討論串 ID` });
  const optInputs = (b.opts || []).map((o) => {
    const i = el("input", { class: "input", type: "text", placeholder: String(o.def), value: c.opts?.[o.k] ?? "", "aria-label": o.label });
    i.dataset.k = o.k;
    return el("label", { class: "field" }, el("span", { class: "label", text: `${o.label}（空白＝${o.def}）` }), i);
  });
  const save = el("button", { class: "btn sm", type: "button", text: "儲存設定" });
  const preview = el("button", { class: "btn sm", type: "button" }, icon("eye"), "預覽");
  const run = el("button", { class: "btn sm", type: "button", disabled: !c.outlet }, icon("upload"), "立即發一次");
  const out = el("div", { class: "bot-preview", hidden: true });
  const collect = () => ({ bot: b.key, outlet: outlet.value, thread: thread.value, opts: Object.fromEntries(optInputs.map((l) => l.querySelector("input")).map((i) => [i.dataset.k, i.value])) });
  save.addEventListener("click", async () => {
    A.setBusy(save, true, "儲存中…");
    try { await patch(collect(), "已儲存"); await loadBots(); } catch (e) { A.setBusy(save, false); A.toast(e.message, "err"); }
  });
  sw.addEventListener("change", async () => {
    try {
      await patch({ ...collect(), enabled: sw.checked }, sw.checked ? `已打開「${b.name}」：${b.when}` : `已關掉「${b.name}」`);
      loadBots();
    } catch (e) { sw.checked = !sw.checked; A.toast(e.message, "err"); }
  });
  const go = async (dryRun, btn) => {
    A.setBusy(btn, true, dryRun ? "抓資料中…" : "發送中…");
    try {
      const r = await api("/api/admin/bots", { method: "POST", body: { run: b.key, dryRun } });
      A.setBusy(btn, false);
      if (!r.ok) return A.toast(`出錯：${r.note}`, "err");
      if (dryRun) {
        out.hidden = false;
        out.replaceChildren(...(r.preview?.length ? r.preview.map(renderEmbed) : [el("p", { class: "small muted", text: r.note || "這次沒有內容（例如沒有新的公告）" })]),
          el("button", { class: "btn sm ghost", type: "button", text: "收起預覽", onclick: () => (out.hidden = true) }));
      } else {
        A.toast(r.posted ? `已發到 Discord${r.note ? `：${r.note}` : ""}` : r.note || "這次沒有內容可發");
        loadBots();
      }
    } catch (e) {
      A.setBusy(btn, false);
      A.toast(e.message, "err");
    }
  };
  preview.addEventListener("click", () => go(true, preview));
  run.addEventListener("click", () => go(false, run));
  return el("section", { class: "card bot-card" },
    el("div", { class: "bot-head" },
      el("div", { class: "grow" }, el("h3", { text: b.name }), el("div", { class: "bot-desc", text: b.desc }), el("div", { class: "bot-when", text: `⏰ ${b.when}` })),
      el("label", { class: "switch" }, sw, el("span", { class: "track" }), el("span", { class: "state", text: c.enabled ? "開" : "關" }))),
    el("div", { class: "bot-cfg" },
      el("label", { class: "field" }, el("span", { class: "label", text: "貼到" }), outlet),
      el("label", { class: "field" }, el("span", { class: "label", text: "討論串" }), thread),
      ...optInputs),
    el("div", { class: "bot-actions" }, save, preview, run),
    lastRunLine(b),
    out);
}

function render() {
  const on = data.bots.filter((b) => b.conf.enabled).length;
  const bad = data.bots.filter((b) => b.conf.enabled && b.runs[0] && !b.runs[0].ok).length;
  $("#cBots").textContent = bad ? `⚠️${bad}` : on || "";
  $("#botsSub").textContent = `${on} 支開著${bad ? `，${bad} 支最近一次出錯` : ""}。在雲端跑，電腦關掉也照常；用 Discord Webhook 貼到你指定的頻道和討論串。資訊整理，不是投資建議。`;
  $("#botsBox").replaceChildren(
    !data.engineReady ? el("p", { class: "form-error", text: "還沒設定機器人引擎（Cloudflare 的 CRON_SECRET），預覽和立即發一次不能用。" }) : null,
    outletsCard(),
    ...data.groups.flatMap((g) => {
      const list = data.bots.filter((b) => b.group === g);
      return list.length ? [el("div", { class: "bot-group" }, el("h2", { text: g }), ...list.map(botCard))] : [];
    }));
}
