// 共用工具：Supabase、R2、登入驗證、權限。
// 檔名以底線開頭，Vercel 不會把它當成 API。
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  // R2 不支援 SDK 新版預設的 checksum，不關掉的話瀏覽器直傳會失敗
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const BUCKET = process.env.R2_BUCKET;

// ── R2 ─────────────────────────────────────────

// 讀取用的簽名網址（預設 1 小時；過期時播放器會自動換新連結，從原位置繼續）
export function signGet(key, { expiresIn = 60 * 60, downloadName } = {}) {
  const params = { Bucket: BUCKET, Key: key };
  if (downloadName) {
    params.ResponseContentDisposition =
      `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  }
  return getSignedUrl(r2, new GetObjectCommand(params), { expiresIn });
}

// 上傳用的簽名網址（後台瀏覽器直傳 R2，不經過 Vercel）
// 簽進檔案大小，上傳的檔案必須跟申請時一樣大
export function signPut(key, contentType, size, { expiresIn = 2 * 60 * 60 } = {}) {
  return getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType, ContentLength: size }),
    { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) }
  );
}

// 只接受 upload-url 產生的格式，例如 videos/2026/10/0a1b2c3d4e5f-live.mp4
export function isIssuedKey(key, prefix) {
  return (
    typeof key === "string" &&
    !key.includes("..") &&
    new RegExp(`^${prefix}/\\d{4}/\\d{2}/[0-9a-f]{12}-[A-Za-z0-9._-]{1,80}$`).test(key)
  );
}

export async function deleteObject(key) {
  if (!key) return;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.error("R2 delete failed", key, err?.message);
  }
}

// ── 權限 ────────────────────────────────────────

export function adminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return !!email && adminEmails().includes(String(email).trim().toLowerCase());
}

// 管理員：Email 在名單內、Email 已驗證，而且「不是」用邀請碼註冊的會員帳號。
// 會員註冊時 Email 沒有經過收信驗證，所以會員帳號永遠不能變成管理員，
// 就算之後把同一個 Email 加進 ADMIN_EMAILS 也一樣。
function adminEligible(user) {
  return isAdminEmail(user?.email) && !!user?.email_confirmed_at;
}

async function memberRow(userId) {
  const { data, error } = await supabaseAdmin
    .from("members")
    .select("user_id, banned")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getUser(req) {
  const auth = req.headers?.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// 會員或管理員才放行；失敗時直接回應錯誤並回傳 null
export async function requireMember(req, res) {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: "請先登入" });
    return null;
  }
  const member = await memberRow(user.id);
  if (!member && adminEligible(user)) return { user, isAdmin: true };
  if (!member || member.banned) {
    res.status(403).json({ error: "這個帳號目前沒有觀看權限，請聯絡管理員" });
    return null;
  }
  return { user, isAdmin: false };
}

export async function requireAdmin(req, res) {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: "請先登入" });
    return null;
  }
  if (!adminEligible(user) || (await memberRow(user.id))) {
    res.status(403).json({ error: "只有管理員可以使用後台" });
    return null;
  }
  return { user };
}

// ── 小工具 ──────────────────────────────────────

export function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return b;
}

export function toInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function cleanText(v, max = 500) {
  if (v === undefined || v === null) return null;
  return String(v).trim().slice(0, max);
}

export function isDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
}

// 產生不易猜的字串，排除容易看錯的 0/O/1/I/L
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function randomCode(groups = 2, size = 4) {
  const out = [];
  for (let g = 0; g < groups; g++) {
    let s = "";
    for (let i = 0; i < size; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    out.push(s);
  }
  return out.join("-");
}

export function randomPassword(len = 12) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

// 包一層：只接受指定的 method，未預期的錯誤統一回 500
export function route(methods) {
  return async function handler(req, res) {
    const fn = methods[req.method];
    if (!fn) {
      res.setHeader("Allow", Object.keys(methods).join(", "));
      return res.status(405).json({ error: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      return await fn(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: "系統錯誤，請稍後再試" });
    }
  };
}
