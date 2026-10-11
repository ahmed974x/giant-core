"use client";
// Deep Research box (ADR-050): ask once, watch the agent graph work, read a cited answer whose every claim was
// checked against its source. Streams NDJSON from /api/deep-research.
import { useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Claim, Event, Result, Source, SubQ } from "@/lib/deep-research/pipeline";

type Status = "idle" | "start" | "done" | "skip" | "error";
type Node = { id: string; label: string; x: number; y: number; kind: "core" | "scout" | "check" };

const SCOUTS = ["searxng", "wikipedia", "openalex", "arxiv", "hackernews", "gdelt"] as const;
const SCOUT_LABEL: Record<string, string> = { searxng: "SearXNG", wikipedia: "Wikipedia", openalex: "OpenAlex", arxiv: "arXiv", hackernews: "Hacker News", gdelt: "GDELT" };

/** Organic (non-grid) layout: planner fans out to an arc of scouts, which converge into the refinery and the checkers.
 *  Phones get a vertical constellation with the scouts in two staggered rows so labels stay readable. */
function layout(vertical: boolean): { nodes: Node[]; edges: [string, string][]; w: number; h: number } {
  const V: Record<string, [number, number]> = {
    planner: [200, 34], "scout:searxng": [62, 118], "scout:wikipedia": [200, 132], "scout:openalex": [338, 118],
    "scout:arxiv": [80, 205], "scout:hackernews": [210, 222], "scout:gdelt": [334, 200],
    merge: [120, 300], dedupe: [290, 350], read: [100, 425], rank: [280, 485], gaps: [350, 570],
    writer: [110, 560], citecheck: [250, 635], verify: [150, 705],
  };
  const H: Record<string, [number, number]> = {
    planner: [70, 200], merge: [430, 140], dedupe: [500, 265], read: [590, 120], rank: [660, 250], gaps: [640, 360],
    writer: [770, 150], citecheck: [860, 265], verify: [945, 160],
  };
  SCOUTS.forEach((sc, i) => {
    const a = (-0.42 + (i / (SCOUTS.length - 1)) * 0.84) * Math.PI;
    H[`scout:${sc}`] = [250 + Math.cos(a) * 60, 200 + Math.sin(a) * 170];
  });
  const pos = vertical ? V : H;
  const mk = (id: string, label: string, kind: Node["kind"]): Node => ({ id, label, x: pos[id][0], y: pos[id][1], kind });
  const nodes: Node[] = [
    mk("planner", "planner", "core"),
    ...SCOUTS.map(sc => mk(`scout:${sc}`, SCOUT_LABEL[sc], "scout")),
    mk("merge", "merge · RRF", "core"), mk("dedupe", "dedupe · MinHash", "core"), mk("read", "read pages", "core"),
    mk("rank", "rank · BM25", "core"), mk("gaps", "gap planner", "core"), mk("writer", "writer", "core"),
    mk("citecheck", "cite check", "check"), mk("verify", "verify", "check"),
  ];
  const edges: [string, string][] = [
    ...SCOUTS.map(sc => ["planner", `scout:${sc}`] as [string, string]),
    ...SCOUTS.map(sc => [`scout:${sc}`, "merge"] as [string, string]),
    ["merge", "dedupe"], ["dedupe", "read"], ["read", "rank"], ["rank", "gaps"], ["gaps", "merge"], ["rank", "writer"], ["writer", "citecheck"], ["citecheck", "verify"],
  ];
  return { nodes, edges, w: vertical ? 400 : 1000, h: vertical ? 740 : 400 };
}

const COLOR: Record<Status, string> = { idle: "#3a4366", start: "#06b6d4", done: "#10b981", skip: "#3a4366", error: "#ef4444" };

function Graph({ status, vertical, className }: { status: Record<string, Status>; vertical: boolean; className: string }) {
  const { nodes, edges, w, h } = useMemo(() => layout(vertical), [vertical]);
  const at = Object.fromEntries(nodes.map(n => [n.id, n]));
  const uid = useId().replace(/:/g, ""), glow = `dr-glow-${uid}`, flow = `dr-flow-${uid}`; // two graphs per page (desktop/phone)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} role="img" aria-label="research agents graph">
      <defs>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <linearGradient id={flow} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2={vertical ? h : 0}><stop offset="0" stopColor="#7c3aed" /><stop offset="1" stopColor="#06b6d4" /></linearGradient>
      </defs>
      {edges.map(([a, b]) => {
        const A = at[a], B = at[b];
        const live = status[b] === "start" && status[a] === "done";
        const lit = status[a] === "done" && (status[b] === "done" || status[b] === "start");
        const back = a === "gaps";
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        const d = vertical
          ? `M${A.x},${A.y} C${A.x},${my + (back ? 80 : 0)} ${B.x},${my - (back ? 80 : 0)} ${B.x},${B.y}`
          : `M${A.x},${A.y} C${mx},${A.y + (back ? 90 : 0)} ${mx},${B.y - (back ? 90 : 0)} ${B.x},${B.y}`;
        return (
          <path key={`${a}-${b}`} d={d} fill="none" stroke={lit || live ? `url(#${flow})` : "#2a3152"} strokeWidth={lit ? 1.8 : 1}
            strokeDasharray={live ? "6 6" : back ? "3 5" : undefined} opacity={lit || live ? 0.95 : 0.55}>
            {live && <animate attributeName="stroke-dashoffset" from="24" to="0" dur="0.8s" repeatCount="indefinite" />}
          </path>
        );
      })}
      {nodes.map(n => {
        const s = status[n.id] ?? "idle";
        const r = n.kind === "scout" ? 7 : 10;
        return (
          <g key={n.id} opacity={s === "skip" ? 0.35 : 1}>
            {s === "start" && <circle cx={n.x} cy={n.y} r={r + 8} fill="none" stroke={COLOR.start} opacity="0.5"><animate attributeName="r" values={`${r + 2};${r + 14};${r + 2}`} dur="1.4s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.7;0;0.7" dur="1.4s" repeatCount="indefinite" /></circle>}
            <circle cx={n.x} cy={n.y} r={r} fill="#0a0e1a" stroke={COLOR[s]} strokeWidth="2" filter={s === "done" || s === "start" ? `url(#${glow})` : undefined} />
            <circle cx={n.x} cy={n.y} r={r / 2.6} fill={COLOR[s]} />
            <text x={n.x} y={vertical ? n.y + r + 17 : n.y - r - 7} textAnchor="middle"
              className="fill-[#c9d1e6] font-mono" fontSize={vertical ? 14 : 12}>{n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Ring({ value }: { value: number }) {
  const c = 2 * Math.PI * 22, color = value >= 70 ? "#10b981" : value >= 45 ? "#f5b301" : "#ef4444";
  return (
    <svg viewBox="0 0 56 56" className="size-14 shrink-0">
      <circle cx="28" cy="28" r="22" fill="none" stroke="#2a3152" strokeWidth="5" />
      <circle cx="28" cy="28" r="22" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 28 28)" />
      <text x="28" y="33" textAnchor="middle" fontSize="14" fontWeight="700" fill={color}>{value}</text>
    </svg>
  );
}

const VERDICT_CLASS: Record<Claim["verdict"], string> = {
  supported: "", plain: "", weak: "decoration-brass/80 underline decoration-dotted underline-offset-4",
  unsupported: "decoration-bad underline decoration-wavy underline-offset-4", uncited: "decoration-muted underline decoration-dotted underline-offset-4",
};

function AnswerText({ claims, sources, audit, onCite }: { claims: Claim[]; sources: Source[]; audit: boolean; onCite: (n: number) => void }) {
  const byN = new Map(sources.map(s => [s.n, s]));
  return (
    <div className="space-y-2 leading-8" dir="auto">
      {claims.map((c, i) => {
        const bullet = /^\s*[-*•]/.test(c.text);
        const parts = c.text.replace(/^\s*[-*•]\s*/, "").split(/(\[\d{1,2}\])/);
        return (
          <p key={i} className={bullet ? "flex gap-2" : ""}>
            {bullet && <span className="mt-3 size-1.5 shrink-0 rounded-full bg-accent" />}
            <span className={audit ? VERDICT_CLASS[c.verdict] : ""} title={audit && c.verdict !== "plain" ? `${c.verdict} · ${Math.round(c.support * 100)}%` : undefined}>
              {parts.map((p, j) => {
                const m = p.match(/^\[(\d{1,2})\]$/);
                if (!m) return <span key={j}>{p.replace(/\*\*/g, "")}</span>;
                const s = byN.get(Number(m[1]));
                return (
                  <button key={j} type="button" onClick={() => onCite(Number(m[1]))} title={s ? `${s.title}\n${s.quote.slice(0, 220)}…` : undefined}
                    className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-accent/50 bg-accent/10 px-1 align-[2px] font-mono text-[11px] text-accent hover:bg-accent hover:text-space">
                    {m[1]}
                  </button>
                );
              })}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export default function DeepResearch() {
  const t = useTranslations("deep");
  const [q, setQ] = useState("");
  const [depth, setDepth] = useState<"quick" | "deep">("quick");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [log, setLog] = useState<string[]>([]);
  const [plan, setPlan] = useState<SubQ[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState(true);
  const [focus, setFocus] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const onEvent = (e: Event | { type: "done"; ms: number }) => {
    if (e.type === "stage") {
      const node = e.node.replace(/:2$/, "");
      setStatus(s => ({ ...s, [node]: e.status === "skip" ? "skip" : e.status }));
      if (e.status !== "start") setLog(l => [...l.slice(-40), `${e.status === "error" ? "✕" : e.status === "skip" ? "·" : "✓"} ${node.padEnd(18)} ${e.detail ?? ""}${e.ms != null ? `  ${(e.ms / 1000).toFixed(1)}s` : ""}`]);
    } else if (e.type === "plan") setPlan(e.subquestions);
    else if (e.type === "sources") setSources(e.sources);
    else if (e.type === "answer") {
      setResult(e.result);
      setStatus(s => ({ ...Object.fromEntries(SCOUTS.map(x => [`scout:${x}`, "skip" as Status])), ...s }));
    }
    else if (e.type === "error") setError(e.message);
  };

  const run = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const question = q.trim();
    if (question.length < 3) return setError(t("tooShort"));
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true); setError(null); setResult(null); setSources([]); setPlan([]); setLog([]); setFocus(null);
    setStatus(depth === "quick" ? { gaps: "skip" } : {});
    try {
      const r = await fetch("/api/deep-research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, depth }), signal: ctrl.signal });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) try { onEvent(JSON.parse(line)); } catch { /* partial line */ }
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(`${t("error")} (${(e as Error).message})`);
    } finally {
      setBusy(false);
    }
  };

  const cite = (n: number) => {
    setFocus(n);
    document.getElementById(`dr-src-${n}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const started = busy || result || log.length > 0;
  const flagged = result?.claims.filter(c => c.verdict === "weak" || c.verdict === "unsupported" || c.verdict === "uncited").length ?? 0;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-[radial-gradient(ellipse_at_20%_0%,rgba(124,58,237,0.18),transparent_55%),radial-gradient(ellipse_at_90%_100%,rgba(6,182,212,0.14),transparent_50%)] p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.3em] text-accent">OMEGA · DEEP RESEARCH</p>
          <h2 className="mt-1 text-xl font-bold sm:text-2xl">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("hint")}</p>
        </div>
        <div className="flex rounded-full border border-line p-0.5 text-sm" role="radiogroup" aria-label={t("depth")}>
          {(["quick", "deep"] as const).map(d => (
            <button key={d} type="button" role="radio" aria-checked={depth === d} onClick={() => setDepth(d)}
              className={`rounded-full px-4 py-1.5 ${depth === d ? "bg-accent font-semibold text-space" : "text-muted hover:text-ink"}`}>{t(d)}</button>
          ))}
        </div>
      </div>

      <form onSubmit={run} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input value={q} onChange={e => setQ(e.target.value)} maxLength={600} dir="auto" placeholder={t("placeholder")}
          className="h-12 flex-1 rounded-xl border border-line bg-space/70 px-4 outline-none ring-accent placeholder:text-muted focus:ring-1" />
        <button disabled={busy} className="h-12 rounded-xl bg-gradient-to-l from-accent to-purple px-6 font-semibold text-white disabled:opacity-60">
          {busy ? t("working") : t("go")}
        </button>
      </form>

      {error && <p className="mt-3 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}

      {started && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-xl border border-line/70 bg-space/60 p-2">
            <Graph status={status} vertical={false} className="hidden h-auto w-full sm:block" />
            <Graph status={status} vertical className="mx-auto h-auto w-full max-w-[420px] sm:hidden" />
          </div>
          <div className="flex min-h-40 flex-col rounded-xl border border-line/70 bg-space/80 p-3 font-mono text-[11px] text-muted" dir="ltr">
            <p className="mb-2 tracking-[0.25em] text-accent">DISPATCH</p>
            <div className="flex-1 space-y-0.5 overflow-y-auto whitespace-pre-wrap break-words">
              {log.map((l, i) => <div key={i} className={l.startsWith("✕") ? "text-bad" : l.startsWith("✓") ? "text-ink/90" : ""}>{l}</div>)}
              {busy && <div className="animate-pulse text-accent">▍</div>}
            </div>
            {plan.length > 0 && (
              <div className="mt-3 border-t border-line/60 pt-2" dir="auto">
                <p className="mb-1 tracking-[0.25em] text-accent">PLAN</p>
                <ol className="list-decimal space-y-0.5 ps-4 font-sans text-xs text-ink/80">{plan.map((s, i) => <li key={i}>{s.q}</li>)}</ol>
              </div>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <article className="panel p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Ring value={result.confidence} />
              <div className="flex-1 text-xs text-muted">
                <p className="text-sm font-semibold text-ink">{t("confidence")}</p>
                <p>{t("stats", { sources: result.stats.passages, domains: result.stats.domains, read: result.stats.read, secs: Math.round(result.stats.ms / 1000) })}</p>
                <p className="font-mono">{result.mode === "model" ? result.model : t("extractive")}</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={audit} onChange={e => setAudit(e.target.checked)} className="accent-[#06b6d4]" />
                {t("audit")}{flagged > 0 && <span className="rounded-full bg-brass/20 px-2 text-brass">{flagged}</span>}
              </label>
            </div>
            <AnswerText claims={result.claims} sources={sources} audit={audit} onCite={cite} />
            {audit && flagged > 0 && <p className="mt-3 text-xs text-muted">{t("legend")}</p>}
            <p className="mt-4 border-t border-line/60 pt-3 text-[11px] text-muted">{t("disclaimer")}</p>
          </article>

          <aside className="space-y-2">
            <p className="px-1 text-sm font-semibold">{t("sources")} <span className="text-muted">({sources.length})</span></p>
            <ol className="max-h-[640px] space-y-2 overflow-y-auto pe-1">
              {sources.map(s => (
                <li key={s.n} id={`dr-src-${s.n}`}
                  className={`rounded-xl border p-3 text-sm transition ${focus === s.n ? "border-accent bg-accent/10 shadow-[0_0_24px_rgba(6,182,212,0.25)]" : "border-line bg-panel/50"}`}>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-xs text-accent">{s.n}</span>
                    <div className="min-w-0 flex-1">
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 font-medium hover:text-accent" dir="auto">{s.title}</a>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[10px] text-muted">
                        <span>{s.domain}</span><span className="text-purple">{SCOUT_LABEL[s.scout]}</span>{s.published && <span>{s.published.slice(0, 10)}</span>}
                      </p>
                      <details className="mt-1" open={focus === s.n}>
                        <summary className="cursor-pointer text-xs text-accent/80">{t("quote")}</summary>
                        <p className="mt-1 text-xs leading-5 text-ink/80" dir="auto">{s.quote}</p>
                      </details>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </section>
  );
}
