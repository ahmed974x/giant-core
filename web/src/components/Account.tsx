"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Profile } from "@/lib/accounts";

/** Account page (ADR-075): sign in / out with NextAuth, and edit the profile. Paper money only. */
export default function Account({ enabled, signedIn, providers, locale }: { enabled: boolean; signedIn: boolean; providers: string[]; locale: string }) {
  const t = useTranslations("account");
  const [p, setP] = useState<Pick<Profile, "display_name" | "country" | "language">>({ display_name: "", country: "", language: locale === "en" ? "en" : "ar" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const back = encodeURIComponent(`/${locale}/account`);

  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/profile", { cache: "no-store" }).then(r => r.json()).then(j => { if (j.profile) setP(j.profile); }).catch(() => null);
  }, [signedIn]);

  const save = async () => {
    setMsg(null);
    const r = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setMsg(r?.ok ? { ok: true, text: t("saved") } : { ok: false, text: j.error ?? t("failed") });
  };

  return (
    <section className="panel mx-auto max-w-xl p-4" aria-labelledby="account-title">
      <h1 id="account-title" className="font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>

      {!enabled && <p className="mt-3 rounded-md bg-panel-2 px-3 py-2 text-sm">{t("off")}</p>}

      {enabled && !signedIn && (
        <div className="mt-4 flex flex-wrap gap-2">
          {providers.map(id => (
            <a key={id} href={`/api/auth/signin/${id}?callbackUrl=${back}`} className="rounded-md bg-brass px-4 py-1.5 text-sm font-semibold text-[#0A0E1A]">
              {t("signInWith", { provider: id === "github" ? "GitHub" : "Google" })}
            </a>
          ))}
        </div>
      )}

      {enabled && signedIn && (
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-muted">{t("name")}
            <input value={p.display_name} onChange={e => setP({ ...p, display_name: e.target.value })} maxLength={40}
              className="mt-1 block w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-xs text-muted">{t("country")}
            <input value={p.country} onChange={e => setP({ ...p, country: e.target.value.toUpperCase().slice(0, 2) })} placeholder="KW"
              className="mt-1 block w-24 rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm font-mono" dir="ltr" />
          </label>
          <label className="block text-xs text-muted">{t("language")}
            <select value={p.language} onChange={e => setP({ ...p, language: e.target.value as "ar" | "en" })}
              className="mt-1 block rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm">
              <option value="ar">العربية</option><option value="en">English</option>
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={save} className="rounded-md bg-brass px-4 py-1.5 text-sm font-semibold text-[#0A0E1A]">{t("save")}</button>
            <a href={`/${locale}/market`} className="text-sm underline">{t("toPaper")}</a>
            <a href={`/api/auth/signout?callbackUrl=${back}`} className="ms-auto text-sm underline">{t("signOut")}</a>
          </div>
        </div>
      )}

      {msg && <p role="status" className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>{msg.text}</p>}
      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{t("safety")}</p>
    </section>
  );
}
