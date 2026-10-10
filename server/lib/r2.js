// Cloudflare R2：簽名網址（讀取、上傳）、刪除檔案
import { presign } from "../sigv4.js";
import { env } from "./env.js";

function r2(o) {
  return presign({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    ...o,
  });
}

// 讀取用的簽名網址（預設 1 小時；過期時播放器會自動換新連結，從原位置繼續）
export function signGet(key, { expiresIn = 60 * 60, downloadName } = {}) {
  const query = downloadName
    ? { "response-content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` }
    : undefined;
  return r2({ method: "GET", key, expiresIn, query });
}

// 上傳用的簽名網址（後台瀏覽器直傳 R2，不經過伺服器）
// 簽進檔案大小和格式，上傳的檔案必須跟申請時一樣
export function signPut(key, contentType, size, { expiresIn = 2 * 60 * 60 } = {}) {
  return r2({ method: "PUT", key, expiresIn, headers: { "content-type": contentType, "content-length": String(size) } });
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
    const url = await r2({ method: "DELETE", key, expiresIn: 60 });
    const r = await fetch(url, { method: "DELETE" });
    if (!r.ok && r.status !== 404) console.error("R2 delete failed", key, r.status);
  } catch (err) {
    console.error("R2 delete failed", key, err?.message);
  }
}
