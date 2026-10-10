// 隨機字串：實驗室密碼、重設密碼、檔名（用 Web Crypto）
// 公平的隨機整數（0 到 n-1），用 Web Crypto
function randomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}
export function randomHex(bytes) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// 產生不易猜的字串，排除容易看錯的 0/O/1/I/L
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function randomCode(groups = 2, size = 4) {
  const out = [];
  for (let g = 0; g < groups; g++) {
    let s = "";
    for (let i = 0; i < size; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    out.push(s);
  }
  return out.join("-");
}

export function randomPassword(len = 12) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[randomInt(chars.length)];
  return s;
}
