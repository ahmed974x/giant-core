// BM25 ranking for the Jarvis memory bank (ADR-138), pure: used by jarvis/server/lib/memory.mjs and
// inlined into the page for sample mode. Arabic and English: lower case, Arabic marks and tatweel
// removed, alef / ya / ta marbuta forms folded, then split on anything that is not a letter or digit.
// Stop words in both languages are dropped. Okapi BM25 with k1 = 1.2, b = 0.75.

const STOP = new Set(("a an and are as at be by for from has have in is it its of on or that the this to was were will with " +
  "في من على الى إلى عن مع هذا هذه ذلك التي الذي و او أو ما لا ثم قد كان كانت هو هي هم").split(/\s+/));

export function normalize(text) {
  return String(text || "").toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
}

export function tokenize(text) {
  return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 1 && !STOP.has(t));
}

// docs: [{id, text, boost?}] → ranked [{id, score, terms}] for the query; boost multiplies the score
// (the memory bank uses it to prefer episodes that passed their gates).
export function bm25(docs, query, { k1 = 1.2, b = 0.75, limit = 10 } = {}) {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !docs.length) return [];
  const toks = docs.map(d => tokenize(d.text));
  const avg = toks.reduce((n, t) => n + t.length, 0) / docs.length || 1;
  const df = new Map(q.map(t => [t, toks.filter(ts => ts.includes(t)).length]));
  const out = [];
  docs.forEach((d, i) => {
    const tf = new Map();
    for (const t of toks[i]) if (df.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    const terms = [];
    for (const t of q) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * toks[i].length / avg));
      terms.push(t);
    }
    if (score > 0) out.push({ id: d.id, score: Math.round(score * (d.boost || 1) * 1000) / 1000, terms });
  });
  return out.sort((x, y) => y.score - x.score || String(x.id).localeCompare(String(y.id))).slice(0, limit);
}
