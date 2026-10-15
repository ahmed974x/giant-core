"use client";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Entry } from "@/lib/awesome";

type Res = { fetchedAt: string; total: number; categories: string[]; results: Entry[] };

/** Search ~700 curated awesome-lists by tool, topic or field; each result can be sent to Director 00 for later. */
export default function AwesomeAtlas({ initialCat = "" }: { initialCat?: string }) {
  const t = useTranslations("atlas");
  const f = useFormatter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(initialCat);
  const [res, setRes] = useState<Res | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/atlas?${new URLSearchParams({ q, cat, limit: "60" })}`, { signal: ctl.signal })
        .then(r => r.json()).then(setRes).catch(() => null);
    }, 150);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q, cat]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 max-w-prose text-sm text-muted">
        {t("lead", { total: res?.total ?? 0 })}{" "}
        {res && <span>{t("updated", { date: f.dateTime(new Date(res.fetchedAt), { dateStyle: "medium" }) })}</span>}
      </p>

      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")}
        className="mt-5 w-full rounded-lg border border-line bg-panel px-4 py-3 text-base focus:border-accent" dir="auto" />

      <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {["", ...(res?.categories ?? [])].map(c => (
          <button key={c || "all"} onClick={() => setCat(c)} aria-pressed={cat === c}
            className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${cat === c ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink"}`}>
            {c || t("all")}
          </button>
        ))}
      </div>

      {res && res.results.length === 0 && <p className="mt-6 text-sm text-muted">{t("empty")}</p>}
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-panel">
        {res?.results.map(e => (
          <li key={e.url} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1" dir="ltr">
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-accent">{e.name}</a>
              <span className="ms-2 text-xs text-muted">{e.parent ? `${e.category} / ${e.parent}` : e.category}</span>
              {e.desc && <p className="mt-0.5 text-sm text-muted">{e.desc}</p>}
            </div>
            <Link href={{ pathname: "/send", query: { url: e.url, text: e.name } }}
              className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-brass hover:border-brass">{t("keep")}</Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">{t("credit")}</p>
    </div>
  );
}
