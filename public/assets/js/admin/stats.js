// 觀看統計：每一場、每位研究員；「看分段」打開觀看曲線
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { fail, loadingBox } from "./common.js";

// 觀看統計
export async function loadStats() {
  const box = $("#statsBox");
  box.replaceChildren(loadingBox());
  let r;
  try {
    r = await api("/api/admin/stats");
  } catch (e) {
    return fail(e);
  }
  const n = r.memberCount || 0;
  $("#statsSub").textContent = `目前 ${n} 位研究員。每一場有多少研究員看、看到哪裡（不算管理員自己看的）`;
  const bar = (f) => el("span", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: Math.round(f * 100) + "%" } })));
  const vids = (r.videos || []).filter((v) => v.is_published);
  const vTable = el("div", { class: "table-wrap" },
    el("table", { class: "table stack" },
      el("thead", null, el("tr", null, el("th", { text: "場次" }), el("th", { text: "看過" }), el("th", { class: "hide-sm", text: "看完" }), el("th", { text: "平均看到" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
      el("tbody", null, vids.length ? vids.map((v) =>
        el("tr", null,
          el("td", null, el("div", { class: "t-title", text: v.title }), el("div", { class: "small muted num", text: A.fmtDate(v.published_at) })),
          el("td", null, el("div", { class: "stat-cell" }, el("span", { class: "num stat-n", text: `${v.viewers}` }), el("span", { class: "small muted", text: n ? `／${n} 人` : "人" })), bar(n ? v.viewers / n : 0)),
          el("td", { class: "hide-sm" }, el("span", { class: "num stat-n", text: `${v.completed}` }), el("span", { class: "small muted", text: " 人" })),
          el("td", null, el("span", { class: "num stat-n", text: `${v.avg_pct}%` })),
          el("td", null, el("button", { class: "btn sm", type: "button", onclick: () => openRetention(v.id) }, icon("chart"), "看分段"))
        )) : [el("tr", null, el("td", { colspan: "5", class: "muted", text: "還沒有發布的影片" }))])));
  const mTable = el("div", { class: "table-wrap" },
    el("table", { class: "table stack" },
      el("thead", null, el("tr", null, el("th", { text: "研究員" }), el("th", { text: "看過" }), el("th", { class: "hide-sm", text: "看完" }), el("th", { text: "最近觀看" }))),
      el("tbody", null, (r.members || []).length ? r.members.map((m) =>
        el("tr", null,
          el("td", null, el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: m.email }), m.banned ? el("span", { class: "pill warn", text: "已停權" }) : null),
          el("td", null, el("span", { class: "num stat-n", text: `${m.watched}` }), el("span", { class: "small muted", text: vids.length ? `／${vids.length} 場` : " 場" })),
          el("td", { class: "hide-sm" }, el("span", { class: "num stat-n", text: `${m.completed}` }), el("span", { class: "small muted", text: " 場" })),
          el("td", { class: "small", text: m.last_watched_at ? A.fmtRel(m.last_watched_at) : "還沒看過" })
        )) : [el("tr", null, el("td", { colspan: "4", class: "muted", text: "還沒有研究員" }))])));
  box.replaceChildren(
    el("h2", { class: "stats-h", text: "每一場" }), vTable,
    el("h2", { class: "stats-h", text: "每位研究員" }), mTable
  );
}

// 觀看分段：大家在哪裡停下、哪裡重看、哪裡有人提問
const mmss = (t) => A.fmtDur(Math.max(0, Math.round(t)));
async function openRetention(id) {
  const body = el("div", { class: "ret" }, loadingBox());
  const m = A.modal({ title: "觀看分段", body });
  m.box.classList.add("modal-wide");
  let r;
  try {
    r = await api(`/api/admin/stats?video=${id}`);
  } catch (e) {
    m.close();
    return fail(e);
  }
  m.box.querySelector(".modal-head h2").textContent = r.video.title;
  const B = r.bucket_sec;
  const rows = r.buckets;
  const base = Math.max(1, rows[0]?.viewers || 0, ...rows.slice(0, 4).map((x) => x.viewers));
  if (!r.tracked) {
    body.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有分段資料" }),
      el("p", { class: "small", style: { marginTop: "6px" }, text: r.viewers_total ? `已經有 ${r.viewers_total} 人看過，但分段是 v1.7 之後才開始記，之後再看的人才會出現在這裡。` : "還沒有研究員看過這一場。" })));
    return;
  }
  // 重點整理
  const half = rows.findIndex((x, i) => i > 1 && x.viewers < base / 2);
  const stopMax = rows.reduce((best, x, i) => (x.stops > (rows[best]?.stops || 0) ? i : best), 0);
  let replay = -1, replayRatio = 0;
  rows.forEach((x, i) => {
    const ratio = x.viewers >= 2 ? x.plays / x.viewers : 0;
    if (ratio > replayRatio) { replayRatio = ratio; replay = i; }
  });
  const chapAt = (t) => [...(r.video.chapters || [])].reverse().find((c) => c.t <= t)?.title;
  const where = (i) => `${mmss(i * B)}–${mmss((i + 1) * B)}${chapAt(i * B) ? `（${chapAt(i * B)}）` : ""}`;
  const facts = [
    `${r.viewers_total} 人看過，${r.completed} 人看完。`,
    half > 0 ? `看到 ${where(half)} 時，只剩不到一半的人。` : "大部分的人都看到最後。",
    rows[stopMax]?.stops >= 2 ? `最多人停下的地方：${where(stopMax)}，${rows[stopMax].stops} 人。` : null,
    replayRatio >= 1.3 ? `重看最多：${where(replay)}，平均每人看 ${replayRatio.toFixed(1)} 次，可能比較難懂或很重要。` : null,
    r.feedback.length ? `這一場有 ${r.feedback.length} 則提問。` : null,
  ].filter(Boolean);

  // 圖：每 30 秒一根，高度＝看過的人數比例；重看多的根標紅；章節與提問標在下方
  const W = 1000, H = 220, pad = 24, n = rows.length, bw = (W - pad * 2) / n;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H + 46}`);
  svg.setAttribute("class", "ret-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "每 30 秒有多少人看過");
  const add = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text) e.textContent = text;
    svg.append(e);
    return e;
  };
  for (const y of [0.25, 0.5, 0.75, 1]) {
    add("line", { x1: pad, x2: W - pad, y1: H - y * (H - 20), y2: H - y * (H - 20), class: "ret-grid" });
    add("text", { x: 0, y: H - y * (H - 20) + 4, class: "ret-axis" }, `${Math.round(y * 100)}%`);
  }
  rows.forEach((x, i) => {
    const f = Math.min(1, x.viewers / base);
    const hot = x.viewers >= 2 && x.plays / x.viewers >= 1.3;
    const rect = add("rect", { x: pad + i * bw + 0.5, y: H - f * (H - 20), width: Math.max(1, bw - 1), height: Math.max(0.5, f * (H - 20)), class: "ret-bar" + (hot ? " hot" : "") + (i === stopMax && x.stops >= 2 ? " stop" : "") });
    const t = document.createElementNS(ns, "title");
    t.textContent = `${where(i)}：${x.viewers} 人看過，共播放 ${x.plays} 次${x.stops ? `，${x.stops} 人停在這裡` : ""}`;
    rect.append(t);
  });
  for (const c of r.video.chapters || []) {
    const x = pad + (c.t / B) * bw;
    add("line", { x1: x, x2: x, y1: H + 2, y2: H + 12, class: "ret-chap" });
    add("text", { x: x + 3, y: H + 24, class: "ret-chap-t" }, c.title.slice(0, 10));
  }
  for (const fb of r.feedback) {
    if (fb.t == null) continue;
    const x = pad + (fb.t / B) * bw;
    const tri = add("path", { d: `M${x} ${H + 30} l5 9 h-10 z`, class: "ret-fb" });
    const t = document.createElementNS(ns, "title");
    t.textContent = `${mmss(fb.t)} ${fb.email}：${fb.body}`;
    tri.append(t);
  }
  add("text", { x: pad, y: H + 44, class: "ret-axis" }, "0:00");
  add("text", { x: W - pad, y: H + 44, class: "ret-axis", "text-anchor": "end" }, mmss(r.duration));

  body.replaceChildren(...[
    el("ul", { class: "ret-facts" }, ...facts.map((t) => el("li", { text: t }))),
    svg,
    el("div", { class: "ret-legend small muted" },
      el("span", null, el("i", { class: "lg lg-bar" }), "看過的人"),
      el("span", null, el("i", { class: "lg lg-hot" }), "重看比較多"),
      el("span", null, el("i", { class: "lg lg-fb" }), "有人提問（滑過看內容）")),
    r.tracked < r.viewers_total ? el("p", { class: "hint", text: `${r.viewers_total} 人裡有 ${r.tracked} 人有分段紀錄（v1.7 之後才開始記）。` }) : null,
    r.feedback.length
      ? el("div", { class: "ret-fbs" }, el("h3", { text: "這一場的提問" }),
          ...r.feedback.map((f) => el("div", { class: "ret-fbrow" },
            el("a", { class: "num", href: `/lab#/v/${r.video.id}${f.t != null ? `?t=${f.t}` : ""}`, target: "_blank", rel: "noopener", text: f.t != null ? mmss(f.t) : "—" }),
            el("span", { class: "grow" }, f.body), el("span", { class: "small muted", text: f.email.split("@")[0] }))))
      : null,
  ].filter(Boolean));
}
