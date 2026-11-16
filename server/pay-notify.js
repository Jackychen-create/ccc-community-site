// 綠界通知（不用登入，靠 CheckMacValue 驗證；server/lib/pay.js 的 handleNotify）
// POST /api/pay/notify   第一次付款（月費第一期、單集）
// POST /api/pay/period   月費之後每一期
// 綠界送的是表單（application/x-www-form-urlencoded），functions/api/[[path]].js 的 FORM_ROUTES 先解析成物件；要回純文字 1|OK
import { route, handleNotify } from "./lib/index.js";

const handler = (kind) => route({
  async POST(req, res) {
    const text = await handleNotify(req.body || {}, kind);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(text);
  },
});
export const notify = handler("first");
export const period = handler("period");
