// 教學影片錄製工具：Chrome 截圖串流（screencast）→ 每格存檔 → ffmpeg 組成固定 30fps 的 mp4
// 畫面上的字幕、游標、點擊波紋、框選、標題卡都是注入到網頁裡的一層，所以會一起被錄進去
const { chromium } = require(require.resolve("playwright", { paths: [require("path").join(__dirname, "..", "..", "tests")] }));
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BASE = "http://localhost:4400";
const FONT_CSS = ["noto-sans-tc/400", "noto-sans-tc/500", "noto-sans-tc/700", "sofia-sans-semi-condensed/500", "sofia-sans-semi-condensed/600", "sofia-sans-semi-condensed/700"]
  .map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");

const OVERLAY = (mobile) => `(() => {
  const MOBILE = ${mobile};
  const css = \`
  #__tut, #__tut * { box-sizing: border-box; font-family: "Noto Sans TC", sans-serif; }
  #__tut { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
  #__tut .cap { position: absolute; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - \${MOBILE ? 24 : 160}px);
    display: flex; flex-direction: column; align-items: center; gap: \${MOBILE ? 6 : 8}px; transition: opacity .28s ease, transform .28s ease; }
  #__tut .cap.bottom { bottom: \${MOBILE ? 22 : 34}px; } #__tut .cap.top { top: \${MOBILE ? 70 : 84}px; }
  #__tut .cap.hide { opacity: 0; transform: translateX(-50%) translateY(6px); }
  #__tut .step { font: 700 \${MOBILE ? 12 : 15}px/1 "Noto Sans TC"; letter-spacing: .08em; color: #16120A; background: #CDA45E; padding: \${MOBILE ? "6px 10px" : "7px 13px"}; border-radius: 999px; }
  #__tut .step:empty { display: none; }
  #__tut .txt { font: 500 \${MOBILE ? 16.5 : 23}px/1.55 "Noto Sans TC"; color: #EEF2F0; text-align: center; text-wrap: balance;
    background: rgba(8, 11, 10, .9); border: 1px solid rgba(205, 164, 94, .45); border-radius: \${MOBILE ? 12 : 14}px; padding: \${MOBILE ? "10px 14px" : "13px 24px"};
    box-shadow: 0 12px 40px rgba(0,0,0,.45); }
  #__tut .cur { position: absolute; left: 0; top: 0; width: 26px; height: 26px; transition: transform .7s cubic-bezier(.45,.05,.25,1); opacity: \${MOBILE ? 0 : 1}; }
  #__tut .cur svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
  #__tut .rip { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 3px solid #CDA45E; animation: __rip .6s ease-out forwards; }
  #__tut .finger { position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(255,255,255,.35); border: 2px solid rgba(255,255,255,.85); animation: __fin .7s ease-out forwards; }
  @keyframes __rip { from { transform: scale(.6); opacity: 1; } to { transform: scale(3.2); opacity: 0; } }
  @keyframes __fin { 0% { transform: scale(.5); opacity: 0; } 25% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.25); opacity: 0; } }
  #__tut .hl { position: absolute; border-radius: 14px; box-shadow: 0 0 0 3px #CDA45E, 0 0 0 9999px rgba(5, 8, 7, .55); transition: all .45s cubic-bezier(.3,.1,.2,1); opacity: 0; }
  #__tut .hl.on { opacity: 1; }
  #__tut .card { position: absolute; inset: 0; background: #0F1412; display: grid; place-content: center; justify-items: center; gap: \${MOBILE ? 16 : 22}px; text-align: center;
    transition: opacity .5s ease; padding: 24px; }
  #__tut .card.hide { opacity: 0; }
  #__tut .tiles { display: flex; gap: \${MOBILE ? 8 : 12}px; perspective: 600px; }
  #__tut .tile { width: \${MOBILE ? 62 : 92}px; height: \${MOBILE ? 84 : 124}px; border-radius: \${MOBILE ? 12 : 16}px; display: grid; place-items: center; position: relative; overflow: hidden;
    background: linear-gradient(#CDA45E 0 50%, #B48F50 50% 100%); font: 700 \${MOBILE ? 64 : 96}px/1 "Sofia Sans Semi Condensed"; color: #16120A;
    animation: __flip .55s cubic-bezier(.3,.1,.2,1) both; }
  #__tut .tile::after { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 3px; margin-top: -1.5px; background: rgba(22,18,10,.4); }
  #__tut .tile:nth-child(2) { animation-delay: .12s; } #__tut .tile:nth-child(3) { animation-delay: .24s; }
  @keyframes __flip { from { transform: rotateX(-90deg); opacity: .3; } to { transform: none; opacity: 1; } }
  #__tut .ct { font: 700 \${MOBILE ? 30 : 46}px/1.3 "Noto Sans TC"; color: #DDE3E0; letter-spacing: .04em; }
  #__tut .cs { font: 500 \${MOBILE ? 16 : 22}px/1.6 "Noto Sans TC"; color: #A6B2AD; max-width: \${MOBILE ? 340 : 760}px; }
  #__tut .cs em { font-style: normal; color: #CDA45E; }
  \`;
  const ARROW = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5 L4 20 L8.6 15.6 L11.6 22 L14.6 20.6 L11.7 14.4 L18 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  function boot() {
    if (document.getElementById("__tut")) return;
    const root = document.createElement("div");
    root.id = "__tut";
    root.innerHTML = '<style>' + css + '</style><div class="hl"></div><div class="cap bottom hide"><span class="step"></span><span class="txt"></span></div><div class="cur">' + ARROW + '</div><div class="card hide" hidden></div>';
    document.documentElement.appendChild(root);
    const q = (s) => root.querySelector(s);
    const st = JSON.parse(sessionStorage.getItem("__tut") || "{}");
    const save = () => sessionStorage.setItem("__tut", JSON.stringify(st));
    const T = window.__tut = {
      say(step, text, pos) {
        const cap = q(".cap");
        Object.assign(st, { step, text, pos }); save();
        if (!text) { cap.classList.add("hide"); return; }
        cap.classList.add("hide");
        setTimeout(() => {
          q(".step").textContent = step || ""; q(".txt").textContent = text;
          cap.className = "cap " + (pos || "bottom");
        }, cap.textContent ? 180 : 0);
      },
      cursor(x, y, instant) {
        const c = q(".cur"); st.cx = x; st.cy = y; save();
        if (instant) { c.style.transition = "none"; c.offsetWidth; }
        c.style.transform = "translate(" + (x - 4) + "px," + (y - 3) + "px)";
        if (instant) requestAnimationFrame(() => (c.style.transition = ""));
      },
      tap(x, y) {
        const r = document.createElement("div"); r.className = MOBILE ? "finger" : "rip"; r.style.left = x + "px"; r.style.top = y + "px";
        root.appendChild(r); setTimeout(() => r.remove(), 800);
      },
      hl(r) {
        const h = q(".hl");
        if (!r) { h.classList.remove("on"); return; }
        const p = 6;
        Object.assign(h.style, { left: r.x - p + "px", top: r.y - p + "px", width: r.width + 2 * p + "px", height: r.height + 2 * p + "px" });
        h.classList.add("on");
      },
      card(html, instant) {
        const c = q(".card");
        if (instant && html) { c.style.transition = "none"; requestAnimationFrame(() => requestAnimationFrame(() => (c.style.transition = ""))); }
        if (!html) { c.classList.add("hide"); setTimeout(() => (c.hidden = true), 500); st.card = null; save(); return; }
        st.card = html; save();
        c.innerHTML = html; c.hidden = false; c.offsetWidth; c.classList.remove("hide");
      },
    };
    if (st.text) { q(".step").textContent = st.step || ""; q(".txt").textContent = st.text; q(".cap").className = "cap " + (st.pos || "bottom"); }
    if (st.cx != null) T.cursor(st.cx, st.cy, true); else T.cursor(innerWidth * 0.6, innerHeight * 0.6, true);
    if (st.card) { const c = q(".card"); c.innerHTML = st.card; c.hidden = false; c.classList.remove("hide"); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();`;

async function start({ mobile, name }) {
  const outDir = path.join(__dirname, "rec", name); // 錄影的每一格暫存在這裡（不進 git）
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const vp = mobile ? { width: 432, height: 768 } : { width: 1280, height: 720 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2.5 : 1.5, isMobile: mobile, hasTouch: mobile, bypassCSP: true, locale: "zh-TW", timezoneId: "Asia/Taipei" });
  await ctx.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  await ctx.addInitScript(OVERLAY(mobile));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  const frames = [];
  let n = 0;
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(outDir, `f${String(n++).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ ts: f.metadata.timestamp, file, recv: Date.now() / 1000 });
    try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
  });
  const recStart = async () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 2000, maxHeight: 2000, everyNthFrame: 1 });

  const wait = (ms) => page.waitForTimeout(ms);
  const T = (fn, ...a) => page.evaluate(([f, a]) => window.__tut && window.__tut[f](...a), [fn, a]);
  const readMs = (t) => Math.max(2400, Math.min(6500, 900 + t.length * 150));

  const api = {
    page, ctx, mobile, errs, wait,
    async rec() { await recStart(); },
    async say(step, text, opts = {}) {
      await T("say", step, text, opts.pos || "bottom");
      await wait(opts.ms ?? readMs(text || ""));
    },
    async quiet(ms = 400) { await T("say", "", "", "bottom"); await wait(ms); },
    async moveTo(locOrSel, ms = 750) {
      const loc = typeof locOrSel === "string" ? page.locator(locOrSel).first() : locOrSel;
      await loc.scrollIntoViewIfNeeded();
      const b = await loc.boundingBox();
      const x = b.x + Math.min(b.width / 2, 60 + b.width * 0.15), y = b.y + b.height / 2;
      if (!mobile) { await T("cursor", x, y); await wait(ms); }
      return { x, y };
    },
    async click(sel, after = 700) {
      const loc = typeof sel === "string" ? page.locator(sel).first() : sel;
      const { x, y } = await api.moveTo(loc);
      await T("tap", x, y);
      await wait(mobile ? 260 : 120);
      await loc.click();
      await wait(after);
    },
    // 點按鈕的動畫，但不真的點（避免開出系統的選檔視窗），用在上傳檔案
    async fakeTap(sel, after = 400) {
      const { x, y } = await api.moveTo(sel);
      await T("tap", x, y);
      await wait(after);
    },
    async type(sel, text, delay = 85) {
      await api.click(sel, 200);
      await page.locator(sel).first().fill("");
      await page.keyboard.type(text, { delay });
      await wait(400);
    },
    async hl(sel, ms = 0) {
      const loc = typeof sel === "string" ? page.locator(sel).first() : sel;
      await loc.scrollIntoViewIfNeeded();
      await wait(250);
      await T("hl", await loc.boundingBox());
      if (ms) await wait(ms);
    },
    async unhl(ms = 350) { await T("hl", null); await wait(ms); },
    async scrollTo(sel, block = "center") {
      await page.locator(sel).first().evaluate((e, b) => e.scrollIntoView({ behavior: "smooth", block: b }), block);
      await wait(900);
    },
    async scrollTop() { await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await wait(800); },
    async card(title, sub, ms = 3200) {
      const html = `<div class="tiles"><span class="tile">C</span><span class="tile">C</span><span class="tile">C</span></div><div class="ct">${title}</div>${sub ? `<div class="cs">${sub}</div>` : ""}`;
      await T("card", html, ms === 0);
      await wait(ms);
    },
    async uncard(ms = 600) { await T("card", null); await wait(ms); },
    async finish(outFile) {
      await wait(600);
      const endAt = Date.now() / 1000;
      try { await cdp.send("Page.stopScreencast"); } catch {}
      await wait(300);
      await browser.close();
      const W = mobile ? 1080 : 1920, H = mobile ? 1920 : 1080;
      const list = frames.map((f, i) => {
        const dur = i < frames.length - 1 ? Math.max(0.001, frames[i + 1].ts - f.ts) : Math.max(0.5, endAt - f.recv);
        return `file '${f.file}'\nduration ${dur.toFixed(4)}`;
      });
      list.push(`file '${frames[frames.length - 1].file}'`);
      const listFile = path.join(outDir, "list.txt");
      fs.writeFileSync(listFile, list.join("\n"));
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
        "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0F1412,fps=30,format=yuv420p`,
        "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-movflags", "+faststart", outFile], { stdio: "inherit" });
      const total = frames[frames.length - 1].ts - frames[0].ts;
      console.log(`${outFile}: ${frames.length} frames, ${total.toFixed(1)}s, errors: ${errs.length ? errs.join(" | ") : "none"}`);
    },
  };
  return api;
}

module.exports = { start, BASE };
