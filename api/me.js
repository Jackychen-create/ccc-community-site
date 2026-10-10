// GET /api/me  目前登入者的身分（前端用來決定要不要顯示後台入口）
import { requireMember, route } from "./_lib.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    return res.status(200).json({ email: ctx.user.email, isAdmin: ctx.isAdmin });
  },
});
