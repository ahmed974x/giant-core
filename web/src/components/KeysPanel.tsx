"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { KeyStatus } from "@/lib/keys";

/** Data keys on the Review screen (ADR-041): which feeds have a key, and one tap to load and test them. */
export default function KeysPanel({ pin }: { pin: string }) {
  const t = useTranslations("review.keys");
  const [keys, setKeys] = useState<KeyStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (pin.length < 6) return;
    const r = await fetch("/api/keys", { headers: { "x-omega-pin": pin }, cache: "no-store" }).catch(() => null);
    if (r?.ok) setKeys((await r.json()).keys);
  }, [pin]);
  useEffect(() => { load(); }, [load]);

  const test = async () => {
    setBusy(true); setError("");
    const r = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) }).catch(() => null);
    if (r?.ok) setKeys((await r.json()).keys); else setError(t("failed"));
    setBusy(false);
  };

  const tone: Record<string, string> = { ok: "bg-good/15 text-good", invalid: "bg-bad/15 text-bad", unreachable: "bg-warn/15 text-warn", "not-set": "bg-panel-2 text-muted" };
  return (
    <section className="panel mt-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <button disabled={busy || pin.length < 6} onClick={test} className="ms-auto rounded-md bg-brass px-4 py-1.5 text-sm font-semibold text-[#0A0E1A] disabled:opacity-40">
          {busy ? t("testing") : t("test")}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <ul className="mt-3 divide-y divide-line">
        {keys?.map(k => (
          <li key={k.name} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
            <span className="font-medium">{k.feed}</span>
            <span className="font-mono text-[11px] text-muted" dir="ltr">{k.name}</span>
            <span className="ms-auto flex items-center gap-2">
              {k.verdict
                ? <span className={`rounded px-2 py-0.5 text-xs ${tone[k.verdict]}`}>{t(`verdict.${k.verdict}`)}</span>
                : <span className={`rounded px-2 py-0.5 text-xs ${k.set ? "bg-panel-2 text-ink" : "bg-panel-2 text-muted"}`}>{k.set ? t("set") : t("empty")}</span>}
              {!k.set && <a href={k.signup} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">{t("signup")}</a>}
            </span>
            {k.detail && <span className="basis-full text-xs text-muted" dir="ltr">{k.detail}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{t("where")}</p>
    </section>
  );
}
