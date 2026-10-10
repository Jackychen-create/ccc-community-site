// 教學課程（規則在 shared/rules.js）
export { COURSE_HOSTS, COURSE_PARTS, COURSE_CYCLE_WEEKS, courseWeek, courseUnlockDate } from "../../public/assets/js/shared/rules.js";

export function isCourse(v) {
  return !!(v && v.course_host);
}
