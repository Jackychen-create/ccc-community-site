// 後台：新人試用週（Discord 報名通過後 7 天，每天晚上 8 點助教私訊一則）
// GET   /api/admin/onboarding           開了沒、這 7 天內的新人（第幾天、收到第幾天）、7 天內容預覽
// PATCH /api/admin/onboarding { on }    打開／關掉（打開的那一刻之後通過的人才會收到）
// GET   /api/admin/onboarding?nudge=1   補發名單：通過沒註冊、註冊了沒看過影片
// POST  /api/admin/onboarding { nudge: "unregistered" | "unwatched" }   補發一次（30 天內不重複）
import { requireAdmin, readBody, route, getDiscordSettings, saveDiscordSettings, discordConfigured } from "../lib/index.js";
import { onboardingDue, onboardingStep, ONBOARD_DAYS } from "../lib/onboarding.js";
import { nudgeLists, runNudge } from "../lib/nudge.js";

const preview = (s) => Array.from({ length: ONBOARD_DAYS }, (_, i) => onboardingStep(i + 1, s, {}));

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    if (req.query?.nudge) {
      const { unregistered, unwatched } = await nudgeLists();
      return res.status(200).json({ unregistered: unregistered.map(({ code, ...p }) => p), unwatched });
    }
    const s = await getDiscordSettings();
    const { people } = await onboardingDue(Date.now(), s);
    return res.status(200).json({
      on: !!s.onboardingOn, since: s.onboardingSince || null,
      people: people.map((p) => ({ name: p.discord_name || "", day: p.day, last: p.last, approvedAt: p.reviewed_at })),
      preview: preview(s),
    });
  },
  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const kind = readBody(req).nudge;
    if (kind === "unregistered" && !discordConfigured()) return res.status(503).json({ error: "還沒設定 Discord 機器人" });
    const r = await runNudge(kind);
    return res.status(r.ok ? 200 : 400).json(r.ok ? r : { error: r.error });
  },
  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const on = readBody(req).on === true;
    const s = await getDiscordSettings();
    const next = { ...s, onboardingOn: on };
    if (on && !s.onboardingOn) next.onboardingSince = new Date().toISOString();
    await saveDiscordSettings(next);
    return res.status(200).json({ ok: true, on, since: next.onboardingSince || null });
  },
});
