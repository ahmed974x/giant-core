"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { relayJson } from "@/lib/relay";
import type { BrainJob } from "@/lib/types";

const text = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));
const pending = (s?: string) => s === "queued" || s === "running";

export default function Research() {
  const t = useTranslations("research");
  const [q, setQ] = useState("");
  const [job, setJob] = useState<BrainJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const poll = (id: string) => {
    relayJson<BrainJob>(`brain/jobs/${id}`)
      .then(j => { setJob(j); if (pending(j.status)) timer.current = setTimeout(() => poll(id), 1500); })
      .catch(() => setError(t("error")));
  };

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const request = q.trim();
    if (request.length < 3) return setError(t("tooShort"));
    clearTimeout(timer.current);
    setError(null);
    setJob(null);
    try {
      const r = await relayJson<{ id: string; status: string }>("brain/ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }),
      });
      setJob({ id: r.id, status: r.status, request, intent: null, answer: null, steps: [] });
      poll(r.id);
    } catch {
      setError(t("error"));
    }
  };

  const busy = pending(job?.status);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("hint")}</p>
      </div>

      <form onSubmit={ask} className="panel flex flex-col gap-3 p-3 sm:flex-row">
        <textarea value={q} onChange={e => setQ(e.target.value)} maxLength={4000} rows={2} dir="auto"
          placeholder={t("placeholder")}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
          className="min-h-12 flex-1 resize-y rounded-lg bg-panel-2 px-3 py-2 outline-none ring-accent placeholder:text-muted focus:ring-1" />
        <button disabled={busy} className="rounded-lg bg-accent px-5 py-2 font-semibold text-[#0a0f15] disabled:opacity-60">
          {busy ? t("asking") : t("ask")}
        </button>
      </form>

      {error && <p className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}

      {job && (
        <div className="grid gap-4 lg:grid-cols-5">
          <section className="panel lg:col-span-2">
            <h2 className="border-b border-line px-4 py-3 font-semibold">{t("steps")}</h2>
            <ol className="divide-y divide-line/60">
              {job.steps.map(s => (
                <li key={s.agent} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`size-2 shrink-0 rounded-full ${s.status === "done" ? "bg-good" : s.status === "failed" ? "bg-bad" : s.status === "working" ? "animate-pulse bg-accent" : "bg-muted/50"}`} />
                  <span className="flex-1" dir="ltr">{s.title}</span>
                  {s.ms != null && <span className="num text-xs text-muted" dir="ltr">{Math.round(s.ms)} ms</span>}
                </li>
              ))}
            </ol>
          </section>
          <section className="panel lg:col-span-3">
            <h2 className="border-b border-line px-4 py-3 font-semibold">{t("answer")}</h2>
            <div className="whitespace-pre-wrap p-4 text-sm leading-7" dir="auto">
              {job.answer ? text(job.answer) : <span className="text-muted">{t("asking")}</span>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
