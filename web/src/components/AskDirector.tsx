"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Action = { type: string; kind?: string; content?: string; message?: string };
type Reply = { thread_id: string; answer: string; status: string; actions: Action[]; memories: { content: string }[];
  causal: { confidence?: number; scenarios?: { label: string; probability: number }[] } | null };

/** Ask Director 00 directly from the Research screen. Questions answer at once (read-only tools such as the Butterfly
 *  Engine); anything that would change memory or send something becomes a proposal in the approval inbox. */
export default function AskDirector() {
  const t = useTranslations("research.director");
  const [q, setQ] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ } }, []);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || q.trim().length < 3 || pin.length < 6) return;
    setBusy(true); setError(""); setReply(null);
    try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ }
    const r = await fetch("/api/director", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ask", request: q, pin }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (r?.ok) setReply(j); else setError(j.error ?? t("failed"));
    setBusy(false);
  };

  const waiting = reply && (reply.status === "awaiting_approval" || reply.status === "escalated");
  return (
    <section className="panel p-4">
      <h2 className="font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>
      <form onSubmit={ask} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <textarea value={q} onChange={e => setQ(e.target.value)} rows={2} maxLength={2000} dir="auto" placeholder={t("placeholder")}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
          className="min-h-12 flex-1 resize-y rounded-lg bg-panel-2 px-3 py-2 placeholder:text-muted" />
        <div className="flex gap-2 sm:flex-col">
          <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
            placeholder={t("pin")} aria-label={t("pin")} className="w-28 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm" dir="ltr" />
          <button disabled={busy || q.trim().length < 3 || pin.length < 6} className="flex-1 rounded-lg bg-brass px-5 py-2 font-semibold text-[#071526] disabled:opacity-50">
            {busy ? t("asking") : t("ask")}
          </button>
        </div>
      </form>
      {error && <p role="alert" className="mt-3 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {reply && (
        <div className="mt-4 space-y-3" aria-live="polite">
          {typeof reply.causal?.confidence === "number" && (
            <p className="text-xs text-muted">{t("confidence", { pct: Math.round(reply.causal.confidence * 100) })}</p>
          )}
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg bg-panel-2 p-3 font-sans text-sm leading-relaxed" dir="auto">{reply.answer}</pre>
          {reply.memories?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted">{t("recalled")}</h3>
              <ul className="mt-1 space-y-1 text-sm">{reply.memories.slice(0, 5).map((m, i) => <li key={i} dir="auto">• {m.content}</li>)}</ul>
            </div>
          )}
          {waiting && (
            <p className="rounded-md bg-brass/10 px-3 py-2 text-sm text-brass">
              {t("waiting")} <Link href="/#inbox" className="underline">{t("openInbox")}</Link>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
