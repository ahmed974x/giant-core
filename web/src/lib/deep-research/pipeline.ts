// Deep Research pipeline (ADR-061): a Perplexity-style answer engine built as a small multi-agent graph.
//
//   planner ─► scouts (6 free sources, in parallel) ─► merge (RRF) ─► dedupe (URL + MinHash) ─► read (pages)
//          ─► rank (BM25) ─► [deep: gap planner ─► second scout wave] ─► writer ─► cite check ─► verify
//
// Every stage reports through `emit`, so the page can draw the graph live. Models are only used where language is
// needed (planning, writing); everything else is classic, deterministic and testable. If no model answers, the writer
// switches to an extractive answer (quoted evidence with citations), so the engine never comes back empty-handed.
import { readPage } from "../reader.ts";
import { chat, parseJson, type Msg } from "./llm.ts";
import { pickScouts, scout, type Hit, type ScoutId } from "./sources.ts";
import { bm25, canonicalUrl, citesOf, dedupeNear, domainOf, isArabic, passages, rrf, sentences, support, tokens } from "./text.ts";

type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;

export type Depth = "quick" | "deep";
export type SubQ = { q: string; queries: string[] };
export type Source = { n: number; url: string; title: string; domain: string; scout: ScoutId; published?: string; quote: string; score: number };
export type Verdict = "supported" | "weak" | "unsupported" | "uncited" | "plain";
export type Claim = { text: string; cites: number[]; support: number; verdict: Verdict };
export type Result = {
  question: string; lang: "ar" | "en"; mode: "model" | "extractive"; model?: string; answer: string; claims: Claim[];
  confidence: number; stats: { queries: number; hits: number; unique: number; read: number; passages: number; domains: number; ms: number };
};
export type Event =
  | { type: "stage"; node: string; status: "start" | "done" | "skip" | "error"; detail?: string; ms?: number }
  | { type: "plan"; subquestions: SubQ[] }
  | { type: "sources"; sources: Source[] }
  | { type: "answer"; result: Result }
  | { type: "error"; message: string };

export type Options = { depth?: Depth; env?: Env; f?: Fetch; signal?: AbortSignal; now?: () => number };

const LIMITS = {
  quick: { subqs: 3, read: 5, sources: 8, scoutMs: 8000 },
  deep: { subqs: 5, read: 10, sources: 14, scoutMs: 12000 },
};

async function stage<T>(emit: (e: Event) => void, node: string, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> {
  const t0 = Date.now();
  emit({ type: "stage", node, status: "start" });
  try {
    const r = await fn();
    emit({ type: "stage", node, status: "done", detail: detail?.(r), ms: Date.now() - t0 });
    return r;
  } catch (e) {
    emit({ type: "stage", node, status: "error", detail: (e as Error).message.slice(0, 160), ms: Date.now() - t0 });
    throw e;
  }
}

// ── planner ────────────────────────────────────────────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);

export function fallbackPlan(question: string): SubQ[] {
  const keywords = tokens(question).slice(0, 8).join(" ");
  return [{ q: question, queries: [...new Set([question.slice(0, 200), keywords].filter(Boolean))] }];
}

export function cleanPlan(raw: unknown, question: string, max: number): SubQ[] {
  const list = (raw as { subquestions?: unknown })?.subquestions;
  if (!Array.isArray(list)) return fallbackPlan(question);
  const out: SubQ[] = [];
  for (const s of list.slice(0, max)) {
    const q = String((s as SubQ)?.q ?? "").trim().slice(0, 300);
    const queries = (Array.isArray((s as SubQ)?.queries) ? (s as SubQ).queries : []).map(x => String(x).trim().slice(0, 160)).filter(x => x.length > 2).slice(0, 2);
    if (q && queries.length) out.push({ q, queries });
  }
  if (!out.length) return fallbackPlan(question);
  if (!out.some(s => s.queries.includes(question))) out[0].queries.unshift(question.slice(0, 160));
  return out;
}

async function plan(question: string, max: number, o: Ctx): Promise<SubQ[]> {
  const msgs: Msg[] = [
    { role: "system", content: `You are the planner of a research team. Today is ${today()}. Break the user's question into at most ${max} focused sub-questions that together answer it fully, including one that looks for counter-evidence or risks when relevant. For each give 1-2 short web search queries. Write queries in English (more sources) AND, if the question is Arabic, make one query per sub-question in Arabic. Reply with JSON only: {"subquestions":[{"q":"...","queries":["...","..."]}]}` },
    { role: "user", content: question },
  ];
  try {
    const r = await chat(msgs, { env: o.env, f: o.f, maxTokens: 500, skip: o.dead, signal: o.signal });
    return cleanPlan(parseJson(r.text), question, max);
  } catch {
    return fallbackPlan(question);
  }
}

// ── scouts, merge, dedupe ──────────────────────────────────────────────────────────────────────────────────────────
type Ctx = { env: Env; f: Fetch; signal?: AbortSignal; dead: Set<string>; emit: (e: Event) => void };
type Pool = { lists: string[][]; hits: Map<string, Hit>; queries: number; raw: number };

async function scoutWave(queries: string[], ids: ScoutId[], ms: number, o: Ctx, pool: Pool, tag = ""): Promise<void> {
  pool.queries += queries.length;
  await Promise.all(ids.map(id => stage(o.emit, `scout:${id}${tag}`, async () => {
    let n = 0;
    await Promise.all(queries.map(async q => {
      const hits = await scout(id, q, o.env, o.f, ms).catch(() => [] as Hit[]);
      n += hits.length;
      pool.raw += hits.length;
      const keys: string[] = [];
      for (const h of hits) {
        const k = canonicalUrl(h.url);
        keys.push(k);
        const old = pool.hits.get(k);
        if (!old || (h.full && !old.full) || h.snippet.length > old.snippet.length) pool.hits.set(k, h);
      }
      pool.lists.push(keys);
    }));
    return n;
  }, n => `${n} hits`).catch(() => 0)));
}

// ── read + rank ────────────────────────────────────────────────────────────────────────────────────────────────────
type Passage = { key: string; text: string; score: number };

async function readTop(keys: string[], pool: Pool, n: number, o: Ctx): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo = keys.filter(k => !pool.hits.get(k)!.full && /^https?:/.test(pool.hits.get(k)!.url)).slice(0, n);
  const env = { ...o.env, FIRECRAWL_API_KEY: "" }; // stay local and free: research never spends the Firecrawl quota
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const k = todo[i++];
      try {
        const page = await Promise.race([
          readPage(pool.hits.get(k)!.url, env, o.f),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 10_000)),
        ]);
        if (page.text.length > 200) out.set(k, page.text.slice(0, 15_000));
      } catch { /* unreadable page: its snippet still counts */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

export function rankPassages(question: string, subqs: SubQ[], keys: string[], pool: Pool, pages: Map<string, string>, max: number): Passage[] {
  const cands: Passage[] = [];
  keys.forEach(k => {
    const h = pool.hits.get(k)!;
    const body = pages.get(k) ?? h.snippet;
    const parts = passages(body);
    for (const p of parts.length ? parts : [h.snippet]) if (p.length > 40) cands.push({ key: k, text: p, score: 0 });
  });
  if (!cands.length) return [];
  const q = tokens([question, ...subqs.map(s => s.q)].join(" "));
  const docs = cands.map(c => tokens(`${pool.hits.get(c.key)!.title} ${c.text}`));
  const scores = bm25(q, docs);
  const rank = new Map(keys.map((k, i) => [k, i]));
  cands.forEach((c, i) => { c.score = scores[i] + 2 / (1 + (rank.get(c.key) ?? 50) / 5); });
  cands.sort((a, b) => b.score - a.score);
  const kept = dedupeNear(cands.map(c => c.text)).map(i => cands[i]);
  const perKey = new Map<string, number>();
  const out: Passage[] = [];
  for (const c of kept) {
    if ((perKey.get(c.key) ?? 0) >= 1 || out.length >= max) continue; // one passage per source keeps sources diverse
    perKey.set(c.key, 1);
    out.push(c);
  }
  return out;
}

// ── writer ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function writerPrompt(question: string, sources: Source[], ar: boolean): Msg[] {
  const block = sources.map(s => `[${s.n}] ${s.title} (${s.domain}${s.published ? `, ${s.published.slice(0, 10)}` : ""})\n${s.quote}`).join("\n\n");
  const lang = ar ? "Arabic (Modern Standard, clear and direct)" : "English";
  return [
    { role: "system", content: `You are the writer of a research team. Today is ${today()}. Answer ONLY from the numbered sources. Write in ${lang}.
Rules:
- Start with a 1-2 sentence direct answer.
- Then 3-6 short bullet points with the key findings, numbers and dates.
- End with one bullet on what is uncertain or where sources disagree.
- Every sentence with a fact ends with its source number(s) like [2] or [1][4]. Never cite a number that is not listed.
- If the sources do not answer the question, say so plainly. Do not invent facts.` },
    { role: "user", content: `Question: ${question}\n\nSources:\n${block}` },
  ];
}

export function extractive(subqs: SubQ[], sources: Source[], ar: boolean): string {
  const lines = [ar ? "ملخص من المصادر مباشرة (بدون نموذج لغوي متاح الآن):" : "Straight from the sources (no language model available right now):"];
  const used = new Set<number>();
  for (const s of subqs) {
    const scores = bm25(tokens(s.q), sources.map(x => tokens(`${x.title} ${x.quote}`)));
    const best = scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).find(([, i]) => !used.has(i));
    if (!best) continue;
    used.add(best[1]);
    const src = sources[best[1]];
    const first = src.quote.split(/(?<=[.!?؟])\s+/).slice(0, 2).join(" ").slice(0, 320);
    lines.push(`- ${first} [${src.n}]`);
  }
  for (const [i, src] of sources.entries()) if (lines.length < 5 && !used.has(i)) lines.push(`- ${src.quote.split(/(?<=[.!?؟])\s+/)[0].slice(0, 240)} [${src.n}]`);
  return lines.join("\n");
}

// ── cite check + verify ────────────────────────────────────────────────────────────────────────────────────────────
export function checkCitations(answer: string, sources: Source[]): { answer: string; claims: Claim[]; confidence: number } {
  const byN = new Map(sources.map(s => [s.n, s]));
  const claims: Claim[] = [];
  for (const raw of sentences(answer)) {
    // Drop citations to numbers that don't exist (a classic small-model failure).
    let text = raw.replace(/\[(\d{1,2})\]/g, (m, n) => (byN.has(Number(n)) ? m : ""));
    const bare = text.replace(/\[\d+\]/g, "").replace(/^[-*•\s]+/, "").trim();
    const content = tokens(bare);
    if (content.length < 4 || /[:：]$/.test(bare)) { claims.push({ text, cites: citesOf(text), support: 1, verdict: "plain" }); continue; }
    let cites = citesOf(text);
    let best = Math.max(0, ...cites.map(n => support(bare, `${byN.get(n)!.title} ${byN.get(n)!.quote}`)));
    // Verifier: a claim its cited source doesn't back, but another source clearly does, gets re-attributed.
    if (best < 0.35) {
      const alt = sources.map(s => [support(bare, `${s.title} ${s.quote}`), s.n] as const).sort((a, b) => b[0] - a[0])[0];
      if (alt && alt[0] >= 0.5 && alt[0] > best + 0.15) {
        text = `${text.replace(/\s*(\[\d+\])+\s*$/, "").replace(/\[\d+\]/g, "")} [${alt[1]}]`;
        cites = [alt[1]];
        best = alt[0];
      }
    }
    const verdict: Verdict = !cites.length ? "uncited" : best >= 0.45 ? "supported" : best >= 0.25 ? "weak" : "unsupported";
    claims.push({ text, cites, support: Math.round(best * 100) / 100, verdict });
  }
  const factual = claims.filter(c => c.verdict !== "plain");
  const mean = factual.length ? factual.reduce((s, c) => s + (c.verdict === "uncited" ? 0 : Math.min(1, c.support / 0.6)), 0) / factual.length : 0;
  const domains = new Set(sources.filter(s => factual.some(c => c.cites.includes(s.n))).map(s => s.domain)).size;
  const confidence = Math.round(100 * (0.7 * mean + 0.3 * Math.min(1, domains / 4)));
  return { answer: claims.map(c => c.text).join("\n"), claims, confidence };
}

// ── orchestrator ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function research(question: string, emit: (e: Event) => void, opts: Options = {}): Promise<Result> {
  const t0 = Date.now();
  const depth = opts.depth ?? "quick";
  const L = LIMITS[depth];
  const o: Ctx = { env: opts.env ?? process.env, f: opts.f ?? fetch, signal: opts.signal, dead: new Set(), emit };
  const ar = isArabic(question);

  const subqs = await stage(emit, "planner", () => plan(question, L.subqs, o), s => `${s.length} sub-questions`);
  emit({ type: "plan", subquestions: subqs });

  const pool: Pool = { lists: [], hits: new Map(), queries: 0, raw: 0 };
  const ids = pickScouts(question, depth === "deep");
  await scoutWave([...new Set(subqs.flatMap(s => s.queries))], ids, L.scoutMs, o, pool);

  const gather = async () => {
    const merged = await stage(emit, "merge", async () => {
      const score = rrf(pool.lists);
      return [...pool.hits.keys()].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
    }, m => `${pool.raw} → ${m.length} unique`);
    const keys = await stage(emit, "dedupe", async () => {
      const keep = dedupeNear(merged.map(k => `${pool.hits.get(k)!.title} ${pool.hits.get(k)!.snippet}`), 0.7);
      return keep.map(i => merged[i]);
    }, k => `${merged.length - k.length} near-duplicates removed`);
    const pages = await stage(emit, "read", () => readTop(keys, pool, L.read, o), p => `${p.size} pages read`);
    const ranked = await stage(emit, "rank", async () => rankPassages(question, subqs, keys, pool, pages, L.sources), r => `${r.length} best passages`);
    return { keys, pages, ranked };
  };
  let g = await gather();

  if (depth === "deep" && g.ranked.length) {
    const follow = await stage(emit, "gaps", async () => {
      const titles = g.ranked.map((p, i) => `${i + 1}. ${pool.hits.get(p.key)!.title}`).join("\n");
      const r = await chat([
        { role: "system", content: 'You review a research team\'s evidence. List up to 3 short web search queries that would fill the biggest gaps (missing angle, newer data, counter-evidence). JSON only: {"queries":["..."]}' },
        { role: "user", content: `Question: ${question}\n\nEvidence found so far:\n${titles}` },
      ], { env: o.env, f: o.f, maxTokens: 200, skip: o.dead, signal: o.signal });
      const qs = parseJson<{ queries?: unknown[] }>(r.text)?.queries ?? [];
      return qs.map(q => String(q).trim().slice(0, 160)).filter(q => q.length > 2).slice(0, 3);
    }, q => (q.length ? q.join(" | ") : "no gaps")).catch(() => [] as string[]);
    if (follow.length) {
      await scoutWave(follow, ["searxng", "wikipedia", ...ids.filter(i => i === "gdelt" || i === "openalex")], L.scoutMs, o, pool, ":2");
      g = await gather();
    }
  } else if (depth === "deep") emit({ type: "stage", node: "gaps", status: "skip" });

  const sources: Source[] = g.ranked.map((p, i) => {
    const h = pool.hits.get(p.key)!;
    return { n: i + 1, url: h.url, title: h.title || domainOf(h.url), domain: domainOf(h.url), scout: h.source, published: h.published, quote: p.text.slice(0, 900), score: Math.round(p.score * 100) / 100 };
  });
  emit({ type: "sources", sources });

  const stats = { queries: pool.queries, hits: pool.raw, unique: pool.hits.size, read: g.pages.size, passages: sources.length, domains: new Set(sources.map(s => s.domain)).size, ms: 0 };
  if (!sources.length) {
    const answer = ar ? "لم أجد مصادر كافية لهذا السؤال. جرّب صياغة أخرى أو تأكد أن SearXNG يعمل." : "No usable sources were found. Try rephrasing, or check that SearXNG is running.";
    const result: Result = { question, lang: ar ? "ar" : "en", mode: "extractive", answer, claims: [{ text: answer, cites: [], support: 0, verdict: "plain" }], confidence: 0, stats: { ...stats, ms: Date.now() - t0 } };
    emit({ type: "answer", result });
    return result;
  }

  let mode: Result["mode"] = "model", model: string | undefined, draft: string;
  try {
    const r = await stage(emit, "writer", () => chat(writerPrompt(question, sources, ar), { env: o.env, f: o.f, maxTokens: 1100, skip: o.dead, signal: o.signal }), r => r.model);
    draft = r.text; model = r.model;
  } catch {
    mode = "extractive";
    draft = extractive(subqs, sources, ar);
    emit({ type: "stage", node: "writer", status: "done", detail: "extractive (no model)" });
  }

  const checked = await stage(emit, "citecheck", async () => checkCitations(draft, sources),
    c => `${c.claims.filter(x => x.verdict === "supported").length}/${c.claims.filter(x => x.verdict !== "plain").length} claims backed`);
  await stage(emit, "verify", async () => checked.confidence, c => `confidence ${c}%`);

  const result: Result = { question, lang: ar ? "ar" : "en", mode, model, answer: checked.answer, claims: checked.claims, confidence: checked.confidence, stats: { ...stats, ms: Date.now() - t0 } };
  emit({ type: "answer", result });
  return result;
}
