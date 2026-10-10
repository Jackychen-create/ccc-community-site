// 觀看分段：每 30 秒一格（後台「觀看曲線」用）
export { BUCKET_SEC } from "../../public/assets/js/shared/rules.js";

// 合併「這次看過的格子」：{ "12": 1 } 這種格式，最多 600 格、每格每次最多 +5
export function mergeBuckets(old, seen) {
  const out = { ...(old && typeof old === "object" ? old : {}) };
  if (!seen || typeof seen !== "object") return out;
  let n = 0;
  for (const [k, v] of Object.entries(seen)) {
    if (++n > 600) break;
    const i = Number(k), c = Math.floor(Number(v));
    if (!Number.isInteger(i) || i < 0 || i > 2880 || !Number.isFinite(c) || c < 1) continue;
    out[i] = Math.min(9999, (Number(out[i]) || 0) + Math.min(c, 5));
  }
  return out;
}
