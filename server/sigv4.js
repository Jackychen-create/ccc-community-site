// R2（S3 相容）簽名網址：AWS Signature V4，只用 Web Crypto，
// Cloudflare 和 Node 18 以上都能跑，不需要 aws-sdk。
const enc = new TextEncoder();

async function hmac(key, data) {
  const k = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const hex = (buf) => [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256hex(s) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}
// RFC 3986 編碼（S3 規定的寫法）
function uriEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * 產生預先簽名的網址。
 * @param {object} o
 * @param {string} o.accountId  Cloudflare 帳號 ID
 * @param {string} o.accessKeyId
 * @param {string} o.secretAccessKey
 * @param {string} o.bucket
 * @param {string} o.key        物件路徑，例如 videos/2026/10/abc-live.mp4
 * @param {string} [o.method]   GET / PUT / DELETE
 * @param {number} [o.expiresIn] 秒，最多 7 天
 * @param {Record<string,string>} [o.headers] 要簽進去的標頭（PUT 用 content-type、content-length）
 * @param {Record<string,string>} [o.query]   額外的查詢參數（例如 response-content-disposition）
 * @param {Date} [o.date]       測試用，固定簽名時間
 */
export async function presign(o) {
  const method = o.method || "GET";
  const host = `${o.accountId}.r2.cloudflarestorage.com`;
  const path = "/" + uriEncode(o.bucket) + "/" + o.key.split("/").map(uriEncode).join("/");
  const now = o.date || new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;

  const headers = { host };
  for (const [k, v] of Object.entries(o.headers || {})) headers[k.toLowerCase()] = String(v).trim();
  const signedHeaders = Object.keys(headers).sort().join(";");

  const query = {
    ...(o.query || {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD", // 跟 aws-sdk 的寫法一樣（小寫）
    "X-Amz-Credential": `${o.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.min(Math.max(1, Math.floor(o.expiresIn || 3600)), 604800)),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join("&");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256hex(canonicalRequest)].join("\n");

  let key = await hmac("AWS4" + o.secretAccessKey, day);
  key = await hmac(key, "auto");
  key = await hmac(key, "s3");
  key = await hmac(key, "aws4_request");
  const signature = hex(await hmac(key, stringToSign));

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
