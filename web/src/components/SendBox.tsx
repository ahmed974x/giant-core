"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const KINDS = ["note", "task", "link"] as const;
type Kind = (typeof KINDS)[number];
type Sent = { thread_id: string; status: string };

/** Phone intake (ADR-025): anything sent here becomes a Director 00 proposal waiting in the approval inbox. */
export default function SendBox({ initialText = "", initialUrl = "" }: { initialText?: string; initialUrl?: string }) {
  const t = useTranslations("send");
  const [kind, setKind] = useState<Kind>(initialUrl ? "link" : "note");
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState<File | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ } }, []);

  const ready = pin.length >= 6 && (kind === "link" ? /^https?:\/\/\S{3,}$/i.test(url.trim()) : text.trim().length >= 3);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError(""); setSent(null);
    try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ }
    const form = new FormData();
    form.set("pin", pin); form.set("kind", kind); form.set("text", text); form.set("url", url);
    if (file) form.set("file", file);
    const r = await fetch("/api/intake", { method: "POST", body: form }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (r?.ok) {
      setSent(j); setText(""); setUrl(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } else setError(j.error ?? t("failed"));
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>

      <form onSubmit={submit} className="panel mt-5 space-y-4 p-4">
        <div role="radiogroup" aria-label={t("kind")} className="grid grid-cols-3 gap-1 rounded-lg bg-panel-2 p-1">
          {KINDS.map(k => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={`rounded-md py-2 text-sm font-medium transition ${kind === k ? "bg-brass text-[#0A0E1A]" : "text-muted hover:text-ink"}`}>
              {t(`kinds.${k}`)}
            </button>
          ))}
        </div>

        {kind === "link" && (
          <label className="block text-sm">
            <span className="text-muted">{t("url")}</span>
            <input type="url" inputMode="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://"
              className="mt-1 w-full rounded-md border border-line bg-panel-2 px-3 py-2.5" dir="ltr" />
          </label>
        )}

        <label className="block text-sm">
          <span className="text-muted">{t(kind === "link" ? "comment" : kind === "task" ? "taskText" : "noteText")}</span>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={kind === "link" ? 2 : 5} maxLength={1500} dir="auto"
            className="mt-1 w-full resize-y rounded-md border border-line bg-panel-2 px-3 py-2.5 leading-relaxed" />
        </label>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="cursor-pointer rounded-md border border-dashed border-line px-3 py-2 text-muted hover:border-accent hover:text-ink">
            {file ? file.name : t("attach")}
            <input ref={fileRef} type="file" accept="image/*,application/pdf,text/plain,.docx,.xlsx,.pptx" className="sr-only"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {file && <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
            className="text-xs text-muted underline">{t("remove")}</button>}
          <span className="text-xs text-muted">{t("fileHint")}</span>
        </div>

        <div className="flex items-center gap-3 border-t border-line pt-4">
          <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
            placeholder={t("pin")} aria-label={t("pin")} className="w-32 rounded-md border border-line bg-panel-2 px-3 py-2.5 text-sm" dir="ltr" />
          <button type="submit" disabled={!ready || busy}
            className="ms-auto rounded-md bg-brass px-5 py-2.5 font-semibold text-[#0A0E1A] disabled:opacity-40">
            {busy ? t("sending") : t("submit")}
          </button>
        </div>

        {error && <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        {sent && (
          <p role="status" className="rounded-md bg-good/10 px-3 py-2 text-sm text-good">
            {t("sent")} <span className="font-mono" dir="ltr">{sent.thread_id}</span>.{" "}
            <Link href="/company#inbox" className="underline">{t("openInbox")}</Link>
          </p>
        )}
      </form>
      <p className="mt-3 text-xs text-muted">{t("safety")}</p>
      <Link href="/library" className="mt-4 inline-block rounded-md border border-line px-3 py-1.5 text-sm text-accent hover:border-accent">{t("library")}</Link>
    </div>
  );
}
