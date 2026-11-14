// ADR-164: project search. The repository's own documents (every ADR, every security review, every skill's
// SKILL.md) searched by three lexical rankers fused with Reciprocal Rank Fusion:
//   body   Okapi BM25 (k1 1.2, b 0.75, the memory bank's ADR-138 tokenizer for Arabic and English) over
//          the title, headings and text
//   field  the same BM25 over the title and headings only
//   title  character trigrams of the query against each title (Dice), so a misspelt name still matches
// RRF(d) = sum over the lists of 1 / (k + rank), k = 60, each list cut at 50. Nothing here is semantic or
// learned: a document that shares no word or trigram with the query is not found, and with nothing found
// the answer says so. The corpus is written by .claude/skills/replica-project-search/project_search.py
// (jarvis/app/data/search-corpus.json). Pure: no network, no process, no file. Same answers in Python.
import { tokenize, normalize } from "./bm25.mjs";

export const PS_K = 60;
export const PS_DEPTH = 50;
export const PS_KINDS = ["adr", "review", "skill"];
export class SearchError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const psFail = (m, d) => { throw new SearchError(m, d); };
function psR(v, p) { return Math.round(v * p) / p; }
// Ids are unique (checkCorpus), so two entries never compare equal.
function byScore(a, b) { return b.score - a.score || (a.id < b.id ? -1 : 1); }

// Okapi BM25 over one field of each document. Ties go by id, so one input gives one order.
export function bm25Rank(docs, field, terms) {
  const q = [...new Set(terms)];
  const toks = docs.map(d => tokenize(field(d)));
  const avg = toks.reduce((n, t) => n + t.length, 0) / docs.length;
  const df = new Map(q.map(t => [t, toks.filter(ts => ts.includes(t)).length]));
  const out = [];
  docs.forEach((d, i) => {
    let score = 0;
    const hit = [];
    for (const t of q) {
      const f = toks[i].filter(x => x === t).length;
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * toks[i].length / avg));
      hit.push(t);
    }
    if (score > 0) out.push({ id: d.id, score: psR(score, 1000), terms: hit });
  });
  return out.sort(byScore);
}

// Character trigrams of the folded text with spaces at the ends.
export function trigrams(text) {
  const s = " " + normalize(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
  const out = new Set();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}
export function dice(a, b) {
  const s = a.size + b.size;
  if (!s) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return psR(2 * n / s, 10000);
}
export function titleRank(docs, query) {
  const q = trigrams(query);
  return docs.map(d => ({ id: d.id, score: dice(q, trigrams(d.title)) })).filter(x => x.score >= 0.3).sort(byScore);
}

// Reciprocal Rank Fusion of ranked lists of {id}.
export function rrf(lists, k) {
  const score = new Map(), ranks = new Map();
  for (const [name, list] of lists) list.slice(0, PS_DEPTH).forEach((x, i) => {
    score.set(x.id, (score.get(x.id) || 0) + 1 / (k + i + 1));
    if (!ranks.has(x.id)) ranks.set(x.id, {});
    ranks.get(x.id)[name] = i + 1;
  });
  return [...score].map(([id, s]) => ({ id, score: psR(s, 1e6), ranks: ranks.get(id) })).sort(byScore);
}

// The first line of a document that holds a query word, cut at 200 characters.
export function snippet(text, terms) {
  const want = new Set(terms);
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("|") || l.startsWith("#")) continue;
    if (tokenize(l).some(t => want.has(t))) return l.length > 200 ? l.slice(0, 199) + "…" : l;
  }
  return null;
}

function checkCorpus(corpus) {
  const docs = corpus && Array.isArray(corpus.docs) && corpus.docs.length <= 1000 ? corpus.docs : psFail("Send the corpus.", "corpus");
  const seen = new Set();
  for (const [i, d] of docs.entries()) {
    if (!d || typeof d.id !== "string" || !d.id || seen.has(d.id) || typeof d.title !== "string" || typeof d.text !== "string" || !PS_KINDS.includes(d.kind) || !Array.isArray(d.headings) || !d.headings.every(x => typeof x === "string")) psFail("Each document has its own id, a kind, a title, headings and text.", "docs[" + i + "]");
    seen.add(d.id);
  }
  return docs;
}

export function searchProject(corpus, req) {
  const all = checkCorpus(corpus);
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : psFail("Send an object with a query.", "");
  const query = typeof r.query === "string" && r.query.trim() && r.query.length <= 300 ? r.query : psFail("The query is text of 1 to 300 characters.", "query");
  const kinds = r.kinds === undefined ? PS_KINDS : Array.isArray(r.kinds) && r.kinds.length && r.kinds.every(k => PS_KINDS.includes(k)) ? r.kinds : psFail("Kinds are " + PS_KINDS.join(", ") + ".", "kinds");
  const limit = r.limit === undefined ? 10 : Number.isInteger(r.limit) && r.limit >= 1 && r.limit <= 20 ? r.limit : psFail("limit is a whole number from 1 to 20.", "limit");
  const k = r.k === undefined ? PS_K : Number.isInteger(r.k) && r.k >= 1 && r.k <= 1000 ? r.k : psFail("k is a whole number from 1 to 1000.", "k");
  const docs = all.filter(d => kinds.includes(d.kind));
  const terms = [...new Set(tokenize(query))];
  const body = bm25Rank(docs, d => d.title + "\n" + d.headings.join("\n") + "\n" + d.text, terms);
  const field = bm25Rank(docs, d => d.title + "\n" + d.headings.join("\n"), terms);
  const title = titleRank(docs, query);
  const scoreOf = { body: new Map(body.map(x => [x.id, x.score])), field: new Map(field.map(x => [x.id, x.score])), title: new Map(title.map(x => [x.id, x.score])) };
  const byId = new Map(docs.map(d => [d.id, d]));
  const termsOf = new Map(body.map(x => [x.id, x.terms]));
  const results = rrf([["body", body], ["field", field], ["title", title]], k).slice(0, limit).map(x => {
    const d = byId.get(x.id);
    return { id: d.id, kind: d.kind, path: d.path ?? null, title: d.title, score: x.score, ranks: x.ranks, scores: Object.fromEntries(Object.keys(x.ranks).map(n => [n, scoreOf[n].get(x.id)])), terms: termsOf.get(d.id) ?? [], snippet: snippet(d.text, termsOf.get(d.id) ?? []) };
  });
  return { query, terms, k, depth: PS_DEPTH, counts: { docs: docs.length, body: body.length, field: field.length, title: title.length }, results,
    found: results.length > 0, method: "lexical: BM25 body, BM25 title and headings, title trigrams, fused by RRF" };
}
