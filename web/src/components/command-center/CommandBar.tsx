"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ping } from "@/lib/ping";
import { refreshPulse } from "@/lib/status";

type Reply = { kind: "answer"; text: string; confidence?: number } | { kind: "queued"; thread: string };
type SpeechCtor = new () => { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void; stop: () => void };

/** The one place to tell OMEGA what to do. 🔮 asks Director 00 and answers right here (read-only tools); ⚡ sends it as
 *  a task that waits in the approval inbox; 📎 attaches a file; 🎤 dictates. Nothing executes without approval.
 *  Ctrl+K (or the header search) focuses it from anywhere on the page. */
export default function CommandBar() {
  const t = useTranslations("command.bar");
  const locale = useLocale();
  const [text, setText] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"propose" | "execute" | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [listening, setListening] = useState(false);
  const [launch, setLaunch] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const speech = useRef<InstanceType<SpeechCtor> | null>(null);

  useEffect(() => {
    try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ }
    const focus = () => { input.current?.focus(); input.current?.scrollIntoView({ block: "center", behavior: "smooth" }); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); focus(); }
      if (e.key === "Escape") { setReply(null); setError(""); input.current?.blur(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("omega:command", focus);
    if (new URLSearchParams(location.search).has("cmd")) setTimeout(focus, 300);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("omega:command", focus); };
  }, []);

  const savePin = () => { try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ } };
  const ready = text.trim().length >= 3 && pin.length >= 6;

  const propose = async () => {
    if (!ready || busy) return;
    setBusy("propose"); setError(""); setReply(null); setLaunch(n => n + 1); savePin();
    const r = await fetch("/api/director", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ask", request: text, pin }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (!r?.ok) setError(j.error ?? t("failed"));
    else if (j.status === "awaiting_approval" || j.status === "escalated") { setReply({ kind: "queued", thread: j.thread_id }); ping(); refreshPulse(); }
    else setReply({ kind: "answer", text: j.answer, confidence: j.causal?.confidence });
    setBusy(null);
  };

  const execute = async () => {
    if (!ready || busy) return;
    setBusy("execute"); setError(""); setReply(null); setLaunch(n => n + 1); savePin();
    const form = new FormData();
    form.set("pin", pin); form.set("kind", "task"); form.set("text", text); form.set("url", "");
    if (file) form.set("file", file);
    const r = await fetch("/api/intake", { method: "POST", body: form }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (r?.ok) { setReply({ kind: "queued", thread: j.thread_id }); setText(""); setFile(null); ping(); refreshPulse(); }
    else setError(j.error ?? t("failed"));
    setBusy(null);
  };

  const Speech = (typeof window !== "undefined" ? ((window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition) : undefined);
  const dictate = () => {
    if (!Speech) { setError(t("noVoice")); return; }
    if (listening) { speech.current?.stop(); return; }
    const rec = new Speech();
    rec.lang = locale === "ar" ? "ar-SA" : "en-US"; rec.interimResults = false;
    rec.onresult = e => setText(s => `${s ? `${s} ` : ""}${e.results[0][0].transcript}`);
    rec.onend = () => setListening(false);
    speech.current = rec; setListening(true); rec.start();
  };

  const examples = [t("examples.0"), t("examples.1"), t("examples.2"), t("examples.3")];
  const btn = "grid size-10 place-items-center rounded-xl border border-line text-lg transition duration-300 hover:border-brass disabled:opacity-40";
  return (
    <section aria-label={t("title")} className="relative">
      <div key={launch} className={`command-ring glass rounded-2xl p-3 sm:p-4 ${launch ? "command-launch" : ""}`}>
        <div className="flex items-center gap-2">
          <span className="omega-mark hidden size-9 shrink-0 place-items-center rounded-xl text-[#0A0E1A] sm:grid" aria-hidden>🎯</span>
          <textarea ref={input} value={text} onChange={e => setText(e.target.value)} rows={1} maxLength={2000} dir="auto"
            placeholder={t("placeholder")} aria-label={t("placeholder")}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.ctrlKey || e.metaKey ? execute : propose)(); } }}
            className="h-20 min-h-11 flex-1 resize-none bg-transparent sm:h-auto px-1 py-2.5 text-base outline-none placeholder:text-muted sm:text-lg" />
          {pin.length < 6 && (
            <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
              placeholder={t("pin")} aria-label={t("pin")} className="w-24 rounded-lg border border-line bg-panel-2 px-2 py-2 text-sm" dir="ltr" />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={dictate} aria-pressed={listening} title={t("voice")} aria-label={t("voice")} className={`${btn} ${listening ? "border-pink text-pink pulse-dot" : ""}`}>🎤</button>
          <button type="button" onClick={() => fileRef.current?.click()} title={t("attach")} aria-label={t("attach")} className={`${btn} ${file ? "border-accent" : ""}`}>📎</button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf,text/plain,.docx,.xlsx,.pptx" className="sr-only" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          {file && <span className="max-w-40 truncate text-xs text-accent" dir="auto">{file.name}</span>}
          <span className="hidden text-xs text-muted md:inline"><span className="kbd">Enter</span> {t("enterHint")} · <span className="kbd">Ctrl+Enter</span> {t("ctrlEnterHint")}</span>
          <div className="ms-auto flex gap-2">
            <button type="button" disabled={!ready || !!busy} onClick={propose} className="rounded-xl bg-purple px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              🔮 {busy === "propose" ? t("thinking") : t("propose")}
            </button>
            <button type="button" disabled={!ready || !!busy} onClick={execute} className="rounded-xl bg-brass px-4 py-2 text-sm font-semibold text-[#0A0E1A] disabled:opacity-40">
              ⚡ {busy === "execute" ? t("sending") : t("execute")}
            </button>
          </div>
        </div>
      </div>

      {!reply && !error && (
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {examples.map(x => (
            <button key={x} onClick={() => { setText(x); input.current?.focus(); }} className="rounded-full border border-line bg-panel-2/60 px-3 py-1 text-xs text-muted hover:border-brass hover:text-ink" dir="auto">{x}</button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-xl bg-bad/10 px-4 py-2 text-sm text-bad">{error}</p>}
      {reply && (
        <div className="glass mt-2 rounded-2xl p-4" aria-live="polite">
          {reply.kind === "queued" ? (
            <p className="text-sm text-brass">{t("queued")} <span className="font-mono text-xs" dir="ltr">{reply.thread}</span> · <Link href="/company#inbox" className="underline">{t("openInbox")}</Link></p>
          ) : (
            <>
              {typeof reply.confidence === "number" && <p className="mb-2 text-xs text-muted">{t("confidence", { pct: Math.round(reply.confidence * 100) })}</p>}
              <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed" dir="auto">{reply.text}</pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}
