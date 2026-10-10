// POST /api/admin/upload-url  { filename, contentType, kind, size }
// 回傳 R2 的上傳簽名網址，瀏覽器直接 PUT 上去（大檔不經過 Vercel）
import { requireAdmin, signPut, readBody, randomHex, route } from "../lib/index.js";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const KINDS = {
  video: { prefix: "videos", max: 5 * GB, ok: (t) => t.startsWith("video/") },
  thumb: { prefix: "thumbs", max: 5 * MB, ok: (t) => t === "image/jpeg" || t === "image/webp" },
  attachment: {
    prefix: "files",
    max: 500 * MB,
    ok: (t) =>
      t === "application/pdf" ||
      t.startsWith("image/") ||
      t === "application/zip" ||
      t === "text/plain" ||
      t === "text/csv" ||
      t.startsWith("application/vnd.openxmlformats-officedocument") ||
      t === "application/msword" ||
      t === "application/vnd.ms-excel" ||
      t === "application/vnd.ms-powerpoint",
  },
};

export default route({
  async POST(req, res) {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const body = readBody(req);
    const kind = KINDS[body.kind];
    const contentType = String(body.contentType || "").toLowerCase();
    const size = Number(body.size);
    const filename = String(body.filename || "file");

    if (!kind) return res.status(400).json({ error: "不支援的檔案種類" });
    if (!kind.ok(contentType)) return res.status(400).json({ error: "不支援這種檔案格式" });
    if (!Number.isInteger(size) || size <= 0) return res.status(400).json({ error: "檔案大小不正確" });
    if (size > kind.max) {
      return res.status(400).json({
        error: kind.max >= GB ? "單一影片最大 5 GB，請先壓縮再上傳" : "檔案太大了",
      });
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const key = `${kind.prefix}/${yyyy}/${mm}/${randomHex(6)}-${safeName(filename)}`;

    const url = await signPut(key, contentType, size);
    return res.status(200).json({ key, url, contentType });
  },
});

function safeName(name) {
  const m = name.match(/\.([a-z0-9]{1,8})$/i);
  const ext = m ? "." + m[1].toLowerCase() : "";
  const base = name
    .slice(0, m ? -m[0].length : undefined)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return (base || "file") + ext;
}
