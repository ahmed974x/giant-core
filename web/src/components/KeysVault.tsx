"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Field = "NASA_FIRMS_KEY" | "AISSTREAM_API_KEY";
const FIELDS: { name: Field; label: string; help: string }[] = [
  { name: "NASA_FIRMS_KEY", label: "NASA FIRMS", help: "firms.modaps.eosdis.nasa.gov/api/map_key" },
  { name: "AISSTREAM_API_KEY", label: "AISStream", help: "aisstream.io/apikeys" },
];
type Done = { verdicts: Record<string, string>; saved: string[] };

/** Keys Vault on the phone (ADR-043): paste two keys, one tap saves them on the laptop, encrypted and tested.
 *  The fields clear as soon as they're sent, and the whole page wipes itself 60 s after success. */
export default function KeysVault({ token }: { token: string }) {
  const t = useTranslations("vault");
  const [values, setValues] = useState<Record<Field, string>>({ NASA_FIRMS_KEY: "", AISSTREAM_API_KEY: "" });
  const [pin, setPin] = useState("");
  const [link, setLink] = useState<string>("checking");
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [wipeIn, setWipeIn] = useState(60);
  const wiped = useRef(false);

  useEffect(() => {
    try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ }
    const ping = () => fetch(`/api/keys-vault?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(r => r.json()).then(j => { setLink(j.link); setOnline(true); }).catch(() => setOnline(false));
    ping();
    const id = setInterval(ping, 10_000);
    // Take the token out of the address bar and history right away.
    history.replaceState(null, "", location.pathname);
    return () => clearInterval(id);
  }, [token]);

  useEffect(() => {
    if (!done) return;
    const id = setInterval(() => setWipeIn(s => {
      if (s <= 1 && !wiped.current) { wiped.current = true; setDone(null); setPin(""); location.replace("/"); }
      return s - 1;
    }), 1000);
    return () => clearInterval(id);
  }, [done]);

  const paste = async (f: Field) => {
    try { const v = (await navigator.clipboard.readText()).trim(); setValues(s => ({ ...s, [f]: v })); }
    catch { setError(t("noClipboard")); }
  };

  const save = async () => {
    setBusy(true); setError("");
    const keys = { ...values };
    setValues({ NASA_FIRMS_KEY: "", AISSTREAM_API_KEY: "" });          // never keep them on screen
    const r = await fetch("/api/keys-vault", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, pin, keys }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (r?.ok) setDone({ verdicts: j.verdicts, saved: j.saved }); else { setError(j.error ?? t("failed")); setValues(keys); }
    setBusy(false);
  };

  const ready = pin.length >= 6 && (values.NASA_FIRMS_KEY.length >= 8 || values.AISSTREAM_API_KEY.length >= 8) && link === "ok";
  const tone: Record<string, string> = { ok: "text-good", invalid: "text-bad", unreachable: "text-warn", "not-set": "text-muted" };

  return (
    <div className="mx-auto max-w-md pt-2">
      <div className="flex items-center gap-3">
        <span className="omega-mark grid size-11 place-items-center rounded-xl text-xl text-[#0A0E1A]">🔐</span>
        <div>
          <h1 className="text-2xl font-bold text-brass">{t("title")}</h1>
          <p className="text-sm text-muted">{t("lead")}</p>
        </div>
      </div>
      <p className="mt-4 flex items-center gap-2 text-sm">
        <span className={`size-2.5 rounded-full ${online && link === "ok" ? "pulse-dot bg-good" : online ? "bg-warn" : "bg-bad"}`} />
        {!online ? t("status.offline") : t(`status.${link}`)}
      </p>

      {done ? (
        <section className="glass mt-5 rounded-2xl p-5" aria-live="polite">
          <p className="text-lg font-semibold text-good">✅ {t("saved")}</p>
          <ul className="mt-2 space-y-1 text-sm">{done.saved.map(s => <li key={s} dir="ltr" className="text-start">• {s}</li>)}</ul>
          <ul className="mt-4 space-y-2">
            {Object.entries(done.verdicts).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2 text-sm">
                <span dir="ltr">{FIELDS.find(f => f.name === k)?.label ?? k}</span>
                <span className={`font-semibold ${tone[v] ?? "text-muted"}`}>{t(`verdict.${v}`)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">{t("wipe", { s: wipeIn })}</p>
        </section>
      ) : (
        <form onSubmit={e => { e.preventDefault(); save(); }} className="glass mt-5 space-y-4 rounded-2xl p-5">
          {FIELDS.map(f => (
            <label key={f.name} className="block">
              <span className="flex items-baseline justify-between text-sm">
                <span className="font-semibold">{f.label}</span>
                <span className="text-[11px] text-muted" dir="ltr">{f.help}</span>
              </span>
              <span className="mt-1.5 flex gap-2">
                <input type="password" autoComplete="off" spellCheck={false} value={values[f.name]} onChange={e => setValues(s => ({ ...s, [f.name]: e.target.value }))}
                  dir="ltr" aria-label={f.name} placeholder={f.name}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-3.5 font-mono text-base" />
                <button type="button" onClick={() => paste(f.name)} className="shrink-0 rounded-xl border border-line px-4 text-sm hover:border-brass">📋 {t("paste")}</button>
              </span>
            </label>
          ))}
          <label className="block">
            <span className="text-sm font-semibold">{t("pin")}</span>
            <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} dir="ltr"
              className="mt-1.5 w-full rounded-xl border border-line bg-panel-2 px-4 py-3.5 text-base" />
          </label>
          <button disabled={!ready || busy} className="w-full rounded-xl bg-brass py-4 text-lg font-bold text-[#0A0E1A] disabled:opacity-40">
            💾 {busy ? t("saving") : t("save")}
          </button>
          {error && <p role="alert" className="rounded-xl bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}
          <p className="text-xs leading-relaxed text-muted">{t("safety")}</p>
        </form>
      )}
    </div>
  );
}
