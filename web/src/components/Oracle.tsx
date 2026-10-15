"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { OracleAnswer, Source } from "@/lib/oracle";

type Stage = "idle" | "searching" | "thinking" | "done" | "error";
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** Turns "[2]" in the answer into a link to source 2, so every claim can be checked with one tap. */
function Cited({ text, sources }: { text: string; sources: Source[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return <>{parts.map((p, i) => {
    const n = /^\[(\d+)\]$/.exec(p)?.[1];
    const s = n ? sources.find(x => x.n === Number(n)) : null;
    return s ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}
      className="mx-0.5 inline-grid size-5 place-items-center rounded-full bg-accent/20 align-middle text-[11px] font-bold text-accent no-underline hover:bg-accent hover:text-[#0A0E1A]">{n}</a>
      : <Fragment key={i}>{p}</Fragment>;
  })}</>;
}

/** Oracle (ADR-057, ADR-058): ask anything; it searches the web, reads OMEGA's live signals and answers with sources.
 *  The answer streams in as steps (searching, sources found, thinking, answer) so the wait is never a blank screen. */
export default function Oracle() {
  const t = useTranslations("oracle");
  const lang = useLocale() === "en" ? "en" : "ar";
  const [pin, setPin] = useState("");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [sources, setSources] = useState<Source[]>([]);
  const [a, setA] = useState<OracleAnswer | null>(null);
  const [err, setErr] = useState("");
  const [secs, setSecs] = useState(0);
  const started = useRef(0);
  useEffect(() => { try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ } }, []);
  useEffect(() => {
    if (stage !== "searching" && stage !== "thinking") return;
    const id = setInterval(() => setSecs(Math.round((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const busy = stage === "searching" || stage === "thinking";
  const send = async (question = q) => {
    if (question.trim().length < 2 || busy) return;
    setStage("searching"); setErr(""); setA(null); setSources([]); started.current = Date.now(); setSecs(0);
    try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ }
    const r = await fetch("/api/oracle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, question, lang }) }).catch(() => null);
    if (!r?.ok || !r.body) { const j = r ? await r.json().catch(() => ({})) : {}; setErr(j.error ?? t("offline")); setStage("error"); return; }
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
        if (!ev || !data) continue;
        const d = JSON.parse(data);
        if (ev === "stage") setStage(d.stage);
        else if (ev === "sources") setSources(d);
        else if (ev === "answer") { setA(d); setStage("done"); }
        else if (ev === "error") { setErr(d.error); setStage("error"); }
      }
    }
  };

  return (
    <section aria-labelledby="oracle-title" className="relative overflow-hidden rounded-2xl border border-purple/40 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.22),transparent_60%),rgba(17,24,39,0.85)] p-5 shadow-[0_0_40px_-12px_rgba(124,58,237,0.6)]">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className={`relative grid size-10 place-items-center rounded-full bg-gradient-to-br from-purple to-accent ${busy ? "animate-pulse" : ""}`}>
          <span className="absolute inset-0 rounded-full bg-accent/30 blur-md" /><span className="relative text-lg">🔮</span>
        </span>
        <div>
          <h2 id="oracle-title" className="text-xl font-bold tracking-wide">{t("title")}</h2>
          <p className="text-xs text-muted">{t("tagline")}</p>
        </div>
        <span className="rounded-full border border-good/40 bg-good/10 px-2.5 py-0.5 text-xs font-semibold text-good">{t("free")}</span>
        <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} placeholder={t("pin")} aria-label={t("pin")}
          className="ms-auto w-28 rounded-lg border border-line bg-panel-2/80 px-2 py-1.5 text-sm" dir="ltr" />
      </div>

      <form onSubmit={e => { e.preventDefault(); send(); }} className="mt-4 flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("placeholder")} aria-label={t("placeholder")} dir="auto"
          className="flex-1 rounded-xl border border-line bg-[#0A0E1A]/70 px-4 py-3 text-base outline-none transition focus:border-accent focus:shadow-[0_0_0_3px_rgba(6,182,212,0.2)]" />
        <button disabled={busy || q.trim().length < 2 || pin.length < 6}
          className="rounded-xl bg-gradient-to-r from-brass to-[#f59e0b] px-5 font-bold text-[#0A0E1A] transition hover:brightness-110 disabled:opacity-40">{busy ? t("thinking") : t("ask")}</button>
      </form>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {(["s1", "s2", "s3"] as const).map(k => (
          <button key={k} type="button" onClick={() => { setQ(t(`samples.${k}`)); send(t(`samples.${k}`)); }} disabled={busy || pin.length < 6}
            className="rounded-full border border-line/80 bg-panel-2/60 px-3 py-1 text-xs text-muted transition hover:border-accent hover:text-ink disabled:opacity-40">{t(`samples.${k}`)}</button>
        ))}
      </div>

      {stage !== "idle" && (
        <ol className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-live="polite">
          {(["searching", "thinking", "done"] as const).map((s, i) => {
            const order = ["searching", "thinking", "done"], now = order.indexOf(stage === "error" ? "done" : stage);
            const state = i < now ? "done" : i === now ? (stage === "done" ? "done" : "now") : "next";
            return <li key={s} className={`flex items-center gap-1.5 ${state === "next" ? "text-muted/60" : state === "now" ? "text-accent" : "text-good"}`}>
              <span className={`size-2 rounded-full ${state === "now" ? "animate-ping bg-accent" : state === "done" ? "bg-good" : "bg-muted/40"}`} />{t(`steps.${s}`)}</li>;
          })}
          {busy && <li className="num ms-auto text-muted" dir="ltr">{secs}s</li>}
        </ol>
      )}

      {sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sources.map(s => (
            <a key={s.n} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}
              className="flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-line bg-panel-2/70 px-2 py-1 text-xs transition hover:border-accent">
              <span className="num grid size-4 shrink-0 place-items-center rounded-full bg-accent/20 text-[10px] font-bold text-accent">{s.n}</span>
              <span className="truncate" dir="ltr">{host(s.url)}</span>
            </a>
          ))}
        </div>
      )}

      {stage === "thinking" && <p className="mt-3 text-sm text-muted">{t("working")}</p>}
      {err && <p className="mt-3 rounded-lg bg-bad/10 p-3 text-sm text-bad">{err}</p>}
      {a && (
        <div className="mt-4 rounded-xl border border-line/70 bg-[#0A0E1A]/60 p-4 leading-relaxed" dir="auto">
          <div className="whitespace-pre-wrap"><Cited text={a.answer} sources={a.sources} /></div>
          <p className="mt-3 border-t border-line/60 pt-2 text-xs text-muted">{a.model ? t("by", { model: a.model }) : t("noModel")} · {t("untrusted")}</p>
        </div>
      )}
    </section>
  );
}
