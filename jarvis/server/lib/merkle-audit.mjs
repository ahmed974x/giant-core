// Merkle audit tree (ADR-147), pure: RFC 6962 (Certificate Transparency) hashing, used by the server's audit
// log and inlined into the page, which checks every inclusion proof itself.
//   leaf hash  = SHA-256(0x00 || entry)            node hash = SHA-256(0x01 || left || right)
//   MTH({})    = SHA-256()                          MTH(D[n]) = node(MTH(D[0:k]), MTH(D[k:n])), k the largest
//                                                   power of two smaller than n
//   PATH(m, D[n]) is the audit path of leaf m; verifyInclusion follows RFC 9162 section 2.1.3.2.
// The frontier (the roots of the perfect subtrees, largest first) gives the new head after an append in
// O(log n) hashes, so the server stores the tree head with every entry.
import { sha256Bytes } from "./snapshot.mjs";

const enc = new TextEncoder();
const toBytes = x => (x instanceof Uint8Array ? x : enc.encode(String(x)));
const fromHex = h => Uint8Array.from(String(h).match(/../g) || [], b => parseInt(b, 16));
const join = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export const EMPTY_ROOT = sha256Bytes(new Uint8Array(0));
export const leafHash = entry => sha256Bytes(join(Uint8Array.of(0), toBytes(entry)));
export const nodeHash = (left, right) => sha256Bytes(join(Uint8Array.of(1), fromHex(left), fromHex(right)));
const split = n => { let k = 1; while (k * 2 < n) k *= 2; return k; };

// MTH over leaf hashes (hex).
export function merkleRoot(leaves) {
  if (!leaves.length) return EMPTY_ROOT;
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return nodeHash(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)));
}

// PATH(m, D[n]): the sibling hashes from the leaf up, as RFC 6962 section 2.1.1 defines them.
export function inclusionPath(m, leaves) {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  return m < k ? [...inclusionPath(m, leaves.slice(0, k)), merkleRoot(leaves.slice(k))] : [...inclusionPath(m - k, leaves.slice(k)), merkleRoot(leaves.slice(0, k))];
}

// RFC 9162 section 2.1.3.2: true only if the leaf hash, index, tree size and path give exactly the root.
export function verifyInclusion(leaf, index, size, path, root) {
  if (!Number.isInteger(index) || !Number.isInteger(size) || index < 0 || index >= size || !Array.isArray(path)) return false;
  let fn = index, sn = size - 1, r = leaf;
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    } else r = nodeHash(r, p);
    fn = Math.floor(fn / 2); sn = Math.floor(sn / 2);
  }
  return sn === 0 && r === root;
}

// Frontier: [{ size, hash }] of perfect subtrees, largest first. Push merges equal sizes; the root folds them.
export function frontierPush(peaks, leaf) {
  const out = [...peaks, { size: 1, hash: leaf }];
  while (out.length > 1 && out[out.length - 1].size === out[out.length - 2].size) {
    const r = out.pop(), l = out.pop();
    out.push({ size: l.size * 2, hash: nodeHash(l.hash, r.hash) });
  }
  return out;
}
export function frontierRoot(peaks) {
  if (!peaks.length) return EMPTY_ROOT;
  let r = peaks[peaks.length - 1].hash;
  for (let i = peaks.length - 2; i >= 0; i--) r = nodeHash(peaks[i].hash, r);
  return r;
}

// Which event kinds are audited: locked-step requests and decisions, agent changes, gate results, skills,
// endpoints, access, Studio exports and snapshots, mission milestones and reversal-engine corrections (ADR-150).
export const AUDITED = /^(approval\.|agent\.|skill\.|endpoint\.|access\.|studio\.|export\.|gate\.|workspace\.|reversal\.|mission\.(created|waiting|step_failed|restored))/;

// The text that is hashed for one audit entry: canonical, so the page can recompute it from the row.
export const auditEntry = e => JSON.stringify({ seq: e.seq, kind: e.kind, actor: e.actor, target: e.target == null ? null : String(e.target), at: e.at });
