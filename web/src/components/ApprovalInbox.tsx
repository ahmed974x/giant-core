"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";

type Action = { type: string; kind?: string; content?: string; message?: string };
type Pending = { thread_id: string; request: string; status: "pending" | "escalated"; created_at: string;
  proposal: { answer: string; actions: Action[] }; risk: { level?: string; reasons?: string[] }; type_to_confirm: string | null };
type Inbox = { writable: boolean; pending: Pending[]; rejections: { thread_id: string; code: string; reason: string; created_at: string }[] };
const CODES = ["USER-005", "RISK-001", "COMPLIANCE-002"] as const;

/** Director 00's approval gate on the phone (ADR-023): approve, confirm high-risk work, or reject with a code. */
export default function ApprovalInbox() {
  const t = useTranslations("company.inbox");
  const f = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [phrase, setPhrase] = useState<Record<string, string>>({});
  const [code, setCode] = useState<Record<string, string>>({});

  const load = useCallback(() => fetch("/api/director", { cache: "no-store" }).then(r => r.json()).then(setInbox).catch(() => null), []);
  useEffect(() => {
    try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ }
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const act = async (thread_id: string, body: Record<string, unknown>) => {
    setBusy(thread_id); setMsg(null);
    try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ }
    const r = await fetch("/api/director", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, thread_id, pin }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    setMsg(r?.ok ? { ok: true, text: j.status === "escalated" ? t("escalated") : t(`done.${j.status ?? "executed"}`) } : { ok: false, text: j.error ?? t("failed") });
    setBusy(null);
    load();
  };

  const items = inbox?.pending ?? [];
  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-muted">{items.length}</span>
        {inbox?.writable ? (
          <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
            placeholder={t("pin")} aria-label={t("pin")} className="ms-auto w-28 rounded-md border border-line bg-panel-2 px-2 py-1 text-sm" dir="ltr" />
        ) : <span className="ms-auto text-xs text-warn">{t("readonly")}</span>}
      </div>
      {msg && <p className={`mb-3 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>{msg.text}</p>}
      {items.length === 0 ? <p className="text-sm text-muted">{t("empty")}</p> : (
        <ul className="space-y-3">
          {items.map(p => (
            <li key={p.thread_id} className="rounded-lg border border-line bg-panel-2 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded px-1.5 py-0.5 font-semibold ${p.risk.level === "high" ? "bg-bad/15 text-bad" : "bg-good/15 text-good"}`}>
                  {t(p.risk.level === "high" ? "high" : "low")}
                </span>
                {p.status === "escalated" && <span className="rounded bg-warn/15 px-1.5 py-0.5 font-semibold text-warn">{t("needsConfirm")}</span>}
                <span className="font-mono text-muted" dir="ltr">{p.thread_id}</span>
                <span className="ms-auto text-muted">{f.relativeTime(new Date(p.created_at.replace(" ", "T")), now)}</span>
              </div>
              <p className="mt-2 text-sm" dir="auto">{p.request}</p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {p.proposal.actions.map((a, i) => (
                  <li key={i} dir="auto">• {a.type === "remember" ? `${t("remember")} (${a.kind}): ${a.content}` : `${t("notify")}: ${a.message}`}</li>
                ))}
              </ul>
              {p.risk.reasons && p.risk.reasons.length > 0 && <p className="mt-1 text-[11px] text-bad/90" dir="ltr">{p.risk.reasons.join(" · ")}</p>}
              {inbox?.writable && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {p.status === "pending" ? (
                    <button disabled={busy === p.thread_id || !pin} onClick={() => act(p.thread_id, { action: "approve" })}
                      className="rounded-md bg-accent px-3 py-1.5 font-semibold text-[#0a0f15] disabled:opacity-50">{busy === p.thread_id ? "…" : t("approve")}</button>
                  ) : (
                    <>
                      <input value={phrase[p.thread_id] ?? ""} onChange={e => setPhrase(s => ({ ...s, [p.thread_id]: e.target.value }))}
                        placeholder={p.type_to_confirm ?? ""} className="w-36 rounded-md border border-line bg-panel px-2 py-1 font-mono text-xs" dir="ltr" />
                      <button disabled={busy === p.thread_id || !pin} onClick={() => act(p.thread_id, { action: "confirm", phrase: phrase[p.thread_id] ?? "" })}
                        className="rounded-md bg-bad px-3 py-1.5 font-semibold text-white disabled:opacity-50">{t("confirm")}</button>
                    </>
                  )}
                  <select value={code[p.thread_id] ?? "USER-005"} onChange={e => setCode(s => ({ ...s, [p.thread_id]: e.target.value }))}
                    className="ms-auto rounded-md border border-line bg-panel px-2 py-1 text-xs" aria-label={t("code")}>
                    {CODES.map(c => <option key={c} value={c}>{t(`codes.${c}`)}</option>)}
                  </select>
                  <button disabled={busy === p.thread_id || !pin} onClick={() => act(p.thread_id, { action: "reject", code: code[p.thread_id] ?? "USER-005" })}
                    className="rounded-md border border-line px-3 py-1.5 disabled:opacity-50">{t("reject")}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
