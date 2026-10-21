// 請求與回應：讀 body、包一層 route（只接受指定 method、錯誤統一回 500）
// 請求內容已在 functions/api/[[path]].js 解析成物件
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

// 包一層：只接受指定的 method，未預期的錯誤統一回 500
// 500 的原因分類：資料庫（附 Postgres 錯誤代碼）、逾時、連不上外部服務、程式本身
export function errorKind(err) {
  const msg = `${err?.name || ""} ${err?.message || ""}`;
  if (/^[0-9A-Z]{5}$/.test(String(err?.code || ""))) return `db_${err.code}`;
  if (/abort|timeout|timed out/i.test(msg)) return "timeout";
  if (/fetch failed|network|ECONN|socket|503|502/i.test(msg)) return "upstream";
  return "app";
}
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
      // 只回大概是哪一類出錯（不回錯誤內容），研究員那邊自動回報到後台「網站狀況」時看得出原因
      if (!res.headersSent) res.status(500).json({ error: "系統錯誤，請稍後再試", code: errorKind(err) });
    }
  };
}
