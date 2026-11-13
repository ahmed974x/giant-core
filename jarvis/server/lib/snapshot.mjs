// Studio time machine (ADR-144), pure: used by the server (studio_snapshots) and inlined into the page so
// sample mode works from disk. A snapshot is a Studio site's canonical JSON with its SHA-256, chained to the
// previous snapshot's hash, so any edit to history shows. Diffs: one per JSON line (longest common
// subsequence) and one per block (added, removed, changed, moved).

// JSON with sorted keys, so the same site always gives the same text and hash.
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}

// SHA-256 over UTF-8, in plain JavaScript (FIPS 180-4), so it also runs where WebCrypto is missing.
const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
export function sha256Hex(text) { return sha256Bytes(new TextEncoder().encode(String(text))); }
// SHA-256 of raw bytes (a Uint8Array), as hex. RFC 6962's Merkle tree hashes 0x00- and 0x01-prefixed bytes.
export function sha256Bytes(bytes) {
  const len = bytes.length, words = new Uint32Array(((len + 9 + 63) >> 6) << 4);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  words[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
  words[words.length - 1] = len * 8;
  words[words.length - 2] = Math.floor(len / 0x20000000);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < words.length; o += 16) {
    for (let t = 0; t < 64; t++) {
      if (t < 16) w[t] = words[o + t];
      else {
        const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3), s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map(x => x.toString(16).padStart(8, "0")).join("");
}

// What a snapshot keeps of a Studio site (layout, copy, theme, language, width); nothing else.
export const snapshotOf = site => ({ name: String(site.name || "").slice(0, 80), lang: site.lang === "ar" ? "ar" : "en", width: Number(site.width) || 1280, theme: site.theme || {}, blocks: Array.isArray(site.blocks) ? site.blocks.slice(0, 20) : [] });
export const snapshotHash = (site, prevHash) => sha256Hex((prevHash || "0".repeat(64)) + "\n" + canonical(snapshotOf(site)));

// Pretty JSON lines, diffed with a longest common subsequence: [{ op: "same"|"add"|"del", a, b, text }].
export function lineDiff(left, right, max = 600) {
  const A = left.slice(0, max), B = right.slice(0, max);
  const m = A.length, n = B.length;
  const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ op: "same", a: i + 1, b: j + 1, text: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ op: "del", a: i + 1, b: null, text: A[i] }); i++; }
    else { out.push({ op: "add", a: null, b: j + 1, text: B[j] }); j++; }
  }
  while (i < m) { out.push({ op: "del", a: i + 1, b: null, text: A[i] }); i++; }
  while (j < n) { out.push({ op: "add", a: null, b: j + 1, text: B[j] }); j++; }
  return out;
}
export const prettyLines = site => JSON.stringify(JSON.parse(canonical(snapshotOf(site))), null, 1).split("\n");

// Block level: which sections were added, removed, changed or moved between two sites.
export function blockDiff(a, b) {
  const A = snapshotOf(a).blocks, B = snapshotOf(b).blocks;
  const ia = new Map(A.map((x, i) => [x.id, i])), ib = new Map(B.map((x, i) => [x.id, i]));
  const out = [];
  for (const x of B) {
    if (!ia.has(x.id)) out.push({ id: x.id, type: x.type, change: "added" });
    else {
      const old = A[ia.get(x.id)];
      if (canonical(old) !== canonical(x)) out.push({ id: x.id, type: x.type, change: "changed", on: [old.on, x.on] });
      else if (ia.get(x.id) !== ib.get(x.id)) out.push({ id: x.id, type: x.type, change: "moved", at: [ia.get(x.id) + 1, ib.get(x.id) + 1] });
    }
  }
  for (const x of A) if (!ib.has(x.id)) out.push({ id: x.id, type: x.type, change: "removed" });
  return out;
}
