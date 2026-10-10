// 寄信（Brevo）
import { env } from "./env.js";

export const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const mailReady = () => !!(env.BREVO_API_KEY && env.MAIL_FROM);
// 寄給一或多人（各寄一封，看不到彼此）；沒設定或失敗就回 false，不丟錯
export async function sendMail({ to, subject, html }) {
  const list = [...new Set((to || []).filter(Boolean))];
  if (!mailReady() || !list.length) return false;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || "CCC 交易實驗室" },
        subject,
        htmlContent: `<div style="font-family:system-ui,'Noto Sans TC',sans-serif;font-size:15px;line-height:1.7;color:#1b1f1d">${html}</div>`,
        messageVersions: list.slice(0, 1000).map((email) => ({ to: [{ email }] })),
      }),
    });
    if (!r.ok) console.error("Brevo error", r.status, (await r.text().catch(() => "")).slice(0, 300));
    return r.ok;
  } catch (e) {
    console.error("Brevo failed", e?.message);
    return false;
  }
}
