// Cloudflare Pages Functions：所有 /api/* 都進到這裡，再依路徑交給 server/ 裡對應的程式。
// server/ 的程式沿用 (req, res) 的寫法，這裡負責把 Cloudflare 的 Request 轉過去、把結果轉回 Response。
import { setEnv } from "../../server/lib/index.js";
import me from "../../server/me.js";
import progress from "../../server/progress.js";
import register from "../../server/register.js";
import stats from "../../server/stats.js";
import videos from "../../server/videos.js";
import notes from "../../server/notes.js";
import course from "../../server/course.js";
import feedback from "../../server/feedback.js";
import report from "../../server/report.js";
import exchangeLink from "../../server/exchange-link.js";
import adminSync from "../../server/admin/sync.js";
import adminDiscord from "../../server/admin/discord.js";
import discordInteractions from "../../server/discord/interactions.js";
import cronSync from "../../server/cron/sync.js";
import adminFeedback from "../../server/admin/feedback.js";
import adminErrors from "../../server/admin/errors.js";
import adminFollowup from "../../server/admin/followup.js";
import adminStats from "../../server/admin/stats.js";
import adminNotify from "../../server/admin/notify.js";
import adminVolumes from "../../server/admin/volumes.js";
import adminAttachments from "../../server/admin/attachments.js";
import adminInvites from "../../server/admin/invites.js";
import adminMembers from "../../server/admin/members.js";
import adminUploadUrl from "../../server/admin/upload-url.js";
import adminVideos from "../../server/admin/videos.js";

const ROUTES = {
  "me": me,
  "progress": progress,
  "register": register,
  "stats": stats,
  "videos": videos,
  "notes": notes,
  "course": course,
  "feedback": feedback,
  "report": report,
  "exchange-link": exchangeLink,
  "admin/sync": adminSync,
  "cron/sync": cronSync,
  "discord/interactions": discordInteractions,
  "admin/discord": adminDiscord,
  "cron/bingx": cronSync, // 舊網址，保留給還沒更新的排程
  "admin/feedback": adminFeedback,
  "admin/errors": adminErrors,
  "admin/followup": adminFollowup,
  "admin/stats": adminStats,
  "admin/notify": adminNotify,
  "admin/volumes": adminVolumes,
  "admin/attachments": adminAttachments,
  "admin/invites": adminInvites,
  "admin/members": adminMembers,
  "admin/upload-url": adminUploadUrl,
  "admin/videos": adminVideos,
};

const MAX_BODY = 64 * 1024; // API 只收小小的 JSON，檔案一律直傳 R2

function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

// 模擬 Node 的 res：status().json()、status().end()、setHeader()
function makeRes() {
  const r = { statusCode: 200, headers: {}, body: null, headersSent: false };
  r.status = (c) => {
    r.statusCode = c;
    return r;
  };
  r.setHeader = (k, v) => {
    r.headers[k] = String(v);
    return r;
  };
  r.json = (data) => {
    r.headers["Content-Type"] = "application/json; charset=utf-8";
    r.body = JSON.stringify(data);
    r.headersSent = true;
    return r;
  };
  r.end = () => {
    r.headersSent = true;
    return r;
  };
  return r;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean).join("/");
  const handler = ROUTES[path];
  if (!handler) return json(404, { error: "找不到這個 API" });

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("缺少環境變數 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
    return json(500, { error: "網站設定還沒完成，請聯絡管理員" });
  }
  setEnv(env);

  const url = new URL(request.url);
  let body = {};
  let rawText = "";
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "DELETE") {
    const text = await request.text();
    rawText = text;
    if (text.length > MAX_BODY) return json(413, { error: "資料太大" });
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return json(400, { error: "資料格式不正確" });
      }
    }
  }

  const headers = {};
  request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const req = {
    method: request.method,
    headers,
    query: Object.fromEntries(url.searchParams),
    body,
    rawBody: rawText, // Discord 驗簽要用原始內容
    route: path, // 例如 admin/videos；管理員權限用
    waitUntil: (p) => context.waitUntil(p), // 先回應、背景繼續做（Discord 3 秒內要回）
  };
  const res = makeRes();
  await handler(req, res);
  const status = res.statusCode;
  const nobody = status === 204 || status === 304;
  return new Response(nobody ? null : res.body ?? "", { status, headers: res.headers });
}
