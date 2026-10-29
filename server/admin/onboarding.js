// 後台：新人試用週（Discord 報名通過後 7 天，每天晚上 8 點助教私訊一則）
// GET   /api/admin/onboarding           開了沒、這 7 天內的新人（第幾天、收到第幾天）、7 天內容預覽
// PATCH /api/admin/onboarding { on }    打開／關掉（打開的那一刻之後通過的人才會收到）
import { requireAdmin, readBody, route, getDiscordSettings, saveDiscordSettings } from "../lib/index.js";
import { onboardingDue, onboardingStep, ONBOARD_DAYS } from "../lib/onboarding.js";

const preview = (s) => Array.from({ length: ONBOARD_DAYS }, (_, i) => onboardingStep(i + 1, s, {}));

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const s = await getDiscordSettings();
    const { people } = await onboardingDue(Date.now(), s);
    return res.status(200).json({
      on: !!s.onboardingOn, since: s.onboardingSince || null,
      people: people.map((p) => ({ name: p.discord_name || "", day: p.day, last: p.last, approvedAt: p.reviewed_at })),
      preview: preview(s),
    });
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
