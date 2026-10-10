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
