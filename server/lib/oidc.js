// GitHub Actions 的身分證明（OIDC）：直播精華的工作流程用它證明「我是這個 repo main 分支上的 highlights.yml」
// 不用在 GitHub 另外存網站的密碼；網站用 GitHub 公開的金鑰驗證簽章
// https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect
export const OIDC = {
  issuer: "https://token.actions.githubusercontent.com",
  audience: "ccc-highlights",
  repository: "jackychen-create/ccc-community-site",
  repositoryId: "1412597765", // 帳號改名、被別人重新註冊同名也不會過
  ownerId: "214575415",
  workflow: ".github/workflows/highlights.yml",
  ref: "refs/heads/main",
  jwks: "https://token.actions.githubusercontent.com/.well-known/jwks",
};

const b64url = (s) => {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const json = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

let cache = { at: 0, keys: [] };
async function keys(fetchImpl = fetch, now = Date.now(), force = false) {
  if (!force && cache.keys.length && now - cache.at < 60 * 60 * 1000) return cache.keys;
  const r = await fetchImpl(OIDC.jwks, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`GitHub 金鑰抓不到（${r.status}）`);
  cache = { at: now, keys: (await r.json()).keys || [] };
  return cache.keys;
}
export const resetOidcCache = () => { cache = { at: 0, keys: [] }; };

// 驗證成功回傳 claims；不對就回 null
export async function verifyGithubOidc(token, { fetchImpl = fetch, now = Date.now(), expect = OIDC } = {}) {
  try {
    const [h, p, sig] = String(token || "").split(".");
    if (!h || !p || !sig) return null;
    const head = json(h), claims = json(p);
    if (head.alg !== "RS256") return null;
    let jwk = (await keys(fetchImpl, now)).find((k) => k.kid === head.kid);
    // GitHub 換了金鑰：快取超過 5 分鐘就重抓一次
    if (!jwk && now - cache.at > 5 * 60 * 1000) jwk = (await keys(fetchImpl, now, true)).find((k) => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const sec = Math.floor(now / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== expect.issuer || !aud.includes(expect.audience)) return null;
    if (!(claims.exp > sec) || (claims.nbf && claims.nbf > sec + 60)) return null;
    if (String(claims.repository || "").toLowerCase() !== expect.repository) return null;
    if (expect.repositoryId && String(claims.repository_id) !== expect.repositoryId) return null;
    if (expect.ownerId && String(claims.repository_owner_id) !== expect.ownerId) return null;
    if (claims.ref !== expect.ref) return null;
    // workflow_ref：owner/repo/.github/workflows/highlights.yml@refs/heads/main
    if (!String(claims.workflow_ref || "").toLowerCase().startsWith(`${expect.repository}/${expect.workflow}@`)) return null;
    return claims;
  } catch {
    return null;
  }
}
