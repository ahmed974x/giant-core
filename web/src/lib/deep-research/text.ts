// Deep Research text toolkit (ADR-061): the small, classic, explainable algorithms the pipeline leans on instead of
// another model call. Arabic + English normalisation, BM25 passage ranking, reciprocal rank fusion (RRF) to merge
// scout result lists, MinHash for near-duplicate passages (syndicated news), and claim/evidence overlap for the
// citation check. No dependencies; everything here is deterministic and unit-tested.

const AR_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const STOP = new Set([
  // English
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "at", "from", "as", "is", "are", "was", "were",
  "be", "been", "it", "its", "this", "that", "these", "those", "what", "which", "who", "how", "why", "when", "where", "do",
  "does", "did", "not", "no", "but", "if", "than", "then", "so", "can", "will", "would", "should", "could", "has", "have",
  "had", "about", "into", "over", "more", "most", "also", "their", "they", "them", "there", "he", "she", "we", "you", "i",
  // Arabic (normalised forms)
  "في", "من", "على", "الى", "عن", "مع", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "الذين", "هو", "هي", "هم", "ان", "او",
  "ما", "ماذا", "لماذا", "كيف", "متى", "اين", "هل", "لا", "لم", "لن", "قد", "كان", "كانت", "يكون", "بين", "كل", "بعد", "قبل",
  "عند", "حتى", "اذا", "ثم", "او", "ايضا", "وهو", "وهي", "به", "بها", "له", "لها", "فيه", "فيها", "منه", "منها", "شو", "وش",
  "ابي", "ليش", "كذا", "يعني",
]);

/** Lower-case, strip Arabic diacritics/tatweel, unify alef/yeh/teh-marbuta forms, turn Arabic-Indic digits to ASCII. */
export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(AR_DIACRITICS, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

/** Light Arabic stemmer: drops the common one-letter conjunction/preposition prefixes and "ال", and a few suffixes. */
function stem(w: string): string {
  if (!/[؀-ۿ]/.test(w)) return w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w;
  let x = w;
  if (x.length > 4 && /^(وال|بال|كال|فال|لل)/.test(x)) x = x.slice(3);
  else if (x.length > 3 && x.startsWith("ال")) x = x.slice(2);
  else if (x.length > 4 && /^[وفبكل]/.test(x)) x = x.slice(1);
  if (x.length > 4) x = x.replace(/(ات|ون|ين|ها|هم|يه|ه)$/, "");
  return x;
}

/** Content tokens: normalised, stop-words removed, lightly stemmed. Keeps numbers (they carry most facts). */
export function tokens(s: string): string[] {
  return normalize(s).split(/[^\p{L}\p{N}%.]+/u).map(w => w.replace(/^\.+|\.+$/g, ""))
    .filter(w => w.length > 1 && !STOP.has(w)).map(stem).filter(w => w.length > 1);
}

export const isArabic = (s: string) => (s.match(/[؀-ۿ]/g)?.length ?? 0) > (s.match(/[A-Za-z]/g)?.length ?? 0);

/** Okapi BM25 over pre-tokenised documents; returns one score per document for the query. */
export function bm25(query: string[], docs: string[][], k1 = 1.4, b = 0.75): number[] {
  const N = docs.length;
  if (!N) return [];
  const avg = docs.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = [...new Set(query)];
  return docs.map(d => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avg));
    }
    return s;
  });
}

/** Reciprocal Rank Fusion: merges ranked lists of keys; an item ranked well by several scouts rises to the top. */
export function rrf(lists: string[][], k = 60): Map<string, number> {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((key, i) => score.set(key, (score.get(key) ?? 0) + 1 / (k + i + 1)));
  return score;
}

/** Canonical form of a URL for de-duplication: no fragment, no tracking params, no "www.", no trailing slash. */
export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const p of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|ref_src|mc_|igshid)/i.test(p)) url.searchParams.delete(p);
    const host = url.hostname.replace(/^(www|m|amp)\./, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

export const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

// MinHash over word 3-shingles. 64 hashes is plenty to tell "same wire story" (J > 0.6) from "same topic".
const SEEDS = Array.from({ length: 64 }, (_, i) => (Math.imul(i + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0);
function fnv(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
export function minhash(text: string): number[] {
  const t = tokens(text);
  const shingles = new Set<string>();
  for (let i = 0; i + 2 < t.length; i++) shingles.add(`${t[i]} ${t[i + 1]} ${t[i + 2]}`);
  if (!shingles.size && t.length) shingles.add(t.join(" "));
  return SEEDS.map(seed => { let m = 0xffffffff; for (const s of shingles) m = Math.min(m, fnv(s, seed)); return m; });
}
export const minhashSimilarity = (a: number[], b: number[]) => a.reduce((n, v, i) => n + (v === b[i] ? 1 : 0), 0) / a.length;

/** Indices to keep after dropping near-duplicates (first, i.e. best-ranked, copy wins). */
export function dedupeNear(texts: string[], threshold = 0.6): number[] {
  const sigs: number[][] = [];
  const keep: number[] = [];
  texts.forEach((t, i) => {
    const sig = minhash(t);
    if (sigs.some(s => minhashSimilarity(s, sig) >= threshold)) return;
    sigs.push(sig);
    keep.push(i);
  });
  return keep;
}

/** Fraction of the claim's content tokens that appear in the evidence (prefix match tolerates Arabic inflection). */
export function support(claim: string, evidence: string): number {
  const c = [...new Set(tokens(claim))];
  if (!c.length) return 1;
  const ev = new Set(tokens(evidence));
  const evList = [...ev];
  let hit = 0;
  for (const w of c) {
    if (ev.has(w)) hit++;
    else if (w.length >= 4 && evList.some(e => e.length >= 4 && (e.startsWith(w.slice(0, 4)) || w.startsWith(e.slice(0, 4))))) hit += 0.6;
  }
  return hit / c.length;
}

/** Splits text into passages of about `size` characters on paragraph/sentence boundaries. */
export function passages(text: string, size = 700): string[] {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n{1,}/).map(p => p.trim()).filter(p => p.length > 40)) {
    for (const sent of para.split(/(?<=[.!?؟。])\s+/)) {
      if (cur && cur.length + sent.length > size) { out.push(cur.trim()); cur = ""; }
      cur += `${sent} `;
    }
    if (cur.length > size * 0.6) { out.push(cur.trim()); cur = ""; }
  }
  if (cur.trim().length > 60) out.push(cur.trim());
  return out;
}

/** Sentences of an answer, keeping the [n] markers attached to the sentence they close. */
export function sentences(text: string): string[] {
  return text.split(/\n+/).flatMap(line => line.split(/(?<=[.!?؟](?:\s*\[\d+\])*)\s+(?=[^\s[])/)).map(s => s.trim()).filter(Boolean);
}

export const citesOf = (s: string) => [...new Set([...s.matchAll(/\[(\d{1,2})\]/g)].map(m => Number(m[1])))];
