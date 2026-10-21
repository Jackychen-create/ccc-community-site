// 直播精華（GitHub Actions 跑，.github/workflows/highlights.yml）
// 1. 跟網站拿下一支要做的直播 → 2. 下載影片、ffmpeg 把聲音切成每 10 分鐘一段 mp3
// 3. 一段一段送給網站轉文字 → 4. 通知網站「送完了」，網站用 AI 整理、貼到 Discord
// 驗證：GitHub Actions 的 OIDC 身分證明；本機測試可以設 CRON_SECRET
// 環境變數：SITE（預設正式網站）、MAX_JOBS（一次最多做幾支，預設 2）
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SITE = (process.env.SITE || "https://ccc-community-site.pages.dev").replace(/\/$/, "");
const API = `${SITE}/api/cron/highlights`;
const MAX_JOBS = Number(process.env.MAX_JOBS || 2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function authHeaders() {
  if (process.env.CRON_SECRET) return { "X-Cron-Secret": process.env.CRON_SECRET };
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !tok) throw new Error("沒有 GitHub OIDC（workflow 要有 permissions: id-token: write）");
  const r = await fetch(`${url}&audience=ccc-highlights`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`拿不到 GitHub 身分證明：${r.status}`);
  return { Authorization: `Bearer ${(await r.json()).value}` };
}
async function call(method, path, body, { tries = 3, type = "application/json" } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(API + path, { method, headers: { ...(await authHeaders()), ...(body !== undefined ? { "Content-Type": type } : {}) }, body: body === undefined ? undefined : type === "application/json" ? JSON.stringify(body) : body, signal: AbortSignal.timeout(300000) });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return data;
      last = new Error(`${method} ${path || "/"} → ${r.status} ${data.error || ""}`);
      if (r.status < 500) throw Object.assign(last, { fatal: true });
    } catch (e) {
      if (e.fatal) throw e;
      last = e;
    }
    await new Promise((ok) => setTimeout(ok, 5000 * (i + 1)));
  }
  throw last;
}
const run = (cmd, args) => new Promise((ok, bad) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  p.on("close", (code) => (code === 0 ? ok() : bad(new Error(`${cmd} 失敗（${code}）：${err.split("\n").slice(-4).join(" ")}`))));
});

async function doJob(job) {
  const dir = await mkdtemp(join(tmpdir(), "hl-"));
  try {
    log(`#${job.videoId} ${job.title}：下載影片`);
    const r = await fetch(job.url, { signal: AbortSignal.timeout(30 * 60000) });
    if (!r.ok) throw new Error(`影片下載失敗：${r.status}`);
    const video = join(dir, "video");
    await pipeline(Readable.fromWeb(r.body), createWriteStream(video));
    log(`  ${((await stat(video)).size / 1e6).toFixed(0)} MB，抽聲音`);
    // 單聲道、16kHz、32kbps：10 分鐘大約 2.4 MB；只留人聲的頻段
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-af", "highpass=f=80,lowpass=f=7000", "-c:a", "libmp3lame", "-b:a", "32k", "-f", "segment", "-segment_time", String(job.chunkSec || 600), "-reset_timestamps", "1", join(dir, "a_%03d.mp3")]);
    await rm(video);
    const parts = (await readdir(dir)).filter((f) => /^a_\d{3}\.mp3$/.test(f)).sort().slice(0, job.maxChunks || 36);
    if (!parts.length) throw new Error("影片裡沒有聲音");
    for (const [i, f] of parts.entries()) {
      const buf = await readFile(join(dir, f));
      const out = await call("PUT", `?video=${job.videoId}&chunk=${i}`, buf, { type: "audio/mpeg" });
      log(`  第 ${i + 1}/${parts.length} 段：${out.segments} 句`);
    }
    const done = await call("POST", "", { video: job.videoId, done: true }, { tries: 2 });
    log(`  完成：${done.points ?? 0} 個重點、${done.chapters ?? 0} 個章節${done.posted ? "，已貼到 Discord" : ""}${done.skipped ? "（沒有內容，略過）" : ""}`);
  } catch (e) {
    log(`  出錯：${e.message}`);
    await call("POST", "", { video: job.videoId, error: String(e.message).slice(0, 400) }, { tries: 2 }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (let n = 0; n < MAX_JOBS; n++) {
  const { job } = await call("GET", "");
  if (!job) { log(n ? "沒有其他要做的了" : "沒有要做的直播"); break; }
  await doJob(job);
}
