"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { DocItem, DocPreview } from "@/lib/documents";
import type { Photo } from "@/lib/immich";

type Tab = "documents" | "photos";
type PhotoState = { state: "up" | "offline" | "not-configured" | "misconfigured" | "error"; photos?: Photo[]; error?: string };

const BADGE: Record<string, string> = { word: "bg-[#2b579a]/25 text-[#8db4ff]", excel: "bg-[#217346]/25 text-[#7fd6a4]", powerpoint: "bg-[#c43e1c]/25 text-[#ff9f85]", pdf: "bg-bad/15 text-bad", image: "bg-accent/15 text-accent", text: "bg-panel-2 text-muted" };

/** Files and photos sent from the phone: Word, Excel and PowerPoint previews, ledger exports, and the Immich library. */
export default function Library() {
  const t = useTranslations("library");
  const f = useFormatter();
  const [tab, setTab] = useState<Tab>("documents");
  const [pin, setPin] = useState("");
  const [items, setItems] = useState<DocItem[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocPreview | null>(null);
  const [sheet, setSheet] = useState(0);
  const [photos, setPhotos] = useState<PhotoState | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => { try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ } }, []);

  const call = useCallback(async (url: string) => {
    try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ }
    const r = await fetch(url, { headers: { "x-omega-pin": pin }, cache: "no-store" }).catch(() => null);
    if (!r) throw new Error(t("offline"));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? t("failed"));
    return r;
  }, [pin, t]);

  const load = useCallback(async () => {
    if (pin.length < 6) return;
    setError("");
    try {
      if (tab === "documents") setItems((await (await call("/api/documents")).json()).items);
      else setPhotos(await (await call("/api/photos")).json());
    } catch (e) { setError((e as Error).message); }
  }, [pin, tab, call]);
  useEffect(() => { load(); }, [load]);

  // Thumbnails need the PIN header, so they're fetched as blobs rather than plain <img src>.
  useEffect(() => {
    if (photos?.state !== "up") return;
    let alive = true;
    const urls: string[] = [];
    (async () => {
      for (const p of photos.photos ?? []) {
        if (!alive) break;
        try {
          const u = URL.createObjectURL(await (await call(`/api/photos?thumb=${p.id}`)).blob());
          urls.push(u); setThumbs(s => ({ ...s, [p.id]: u }));
        } catch { /* skip one */ }
      }
    })();
    return () => { alive = false; urls.forEach(URL.revokeObjectURL); };
  }, [photos, call]);

  const show = async (name: string) => {
    setOpen(name); setPreview(null); setSheet(0);
    try { setPreview(await (await call(`/api/documents?file=${encodeURIComponent(name)}`)).json()); } catch (e) { setError((e as Error).message); }
  };
  const download = async (format: "xlsx" | "docx" | "pptx") => {
    try {
      const blob = await (await call(`/api/documents?export=${format}`)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `omega-ledger-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { setError((e as Error).message); }
  };

  const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">{t("lead")}</p>
        </div>
        <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
          placeholder={t("pin")} aria-label={t("pin")} className="w-32 rounded-md border border-line bg-panel px-3 py-2 text-sm" dir="ltr" />
      </div>

      <div role="tablist" className="mt-5 inline-grid grid-cols-2 gap-1 rounded-lg bg-panel-2 p-1">
        {(["documents", "photos"] as const).map(k => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === k ? "bg-accent text-[#071526]" : "text-muted hover:text-ink"}`}>{t(`tabs.${k}`)}</button>
        ))}
      </div>

      {pin.length < 6 && <p className="mt-4 text-sm text-muted">{t("needPin")}</p>}
      {error && <p role="alert" className="mt-4 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {tab === "documents" && pin.length >= 6 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[360px_1fr]">
          <section className="panel p-3">
            <div className="flex flex-wrap gap-2 border-b border-line px-1 pb-3">
              <button onClick={() => download("xlsx")} className="rounded-md border border-line px-3 py-1.5 text-sm text-[#7fd6a4] hover:border-[#7fd6a4]">{t("exportExcel")}</button>
              <button onClick={() => download("docx")} className="rounded-md border border-line px-3 py-1.5 text-sm text-[#8db4ff] hover:border-[#8db4ff]">{t("exportWord")}</button>
              <button onClick={() => download("pptx")} className="rounded-md border border-line px-3 py-1.5 text-sm text-[#ff9f85] hover:border-[#ff9f85]">{t("exportSlides")}</button>
            </div>
            {items && items.length === 0 && <p className="p-2 text-sm text-muted">{t("empty")}</p>}
            <ul className="mt-2 max-h-[60vh] space-y-1 overflow-y-auto">
              {items?.map(d => (
                <li key={d.name}>
                  <button onClick={() => show(d.name)} aria-current={open === d.name}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-start text-sm ${open === d.name ? "bg-panel-2" : "hover:bg-panel-2/60"}`}>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${BADGE[d.type] ?? BADGE.text}`}>{t(`types.${d.type}`)}</span>
                    <span className="min-w-0 flex-1 truncate" dir="auto">{d.name.replace(/^\d{8}-[0-9a-f]{8}-/, "")}</span>
                    <span className="shrink-0 text-xs text-muted">{size(d.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel min-h-[300px] overflow-hidden p-4" aria-live="polite">
            {!open && <p className="text-sm text-muted">{t("pick")}</p>}
            {open && !preview && !error && <p className="text-sm text-muted">{t("loading")}</p>}
            {preview?.kind === "docx" && (
              <article className="mx-auto max-w-[70ch] space-y-3 leading-relaxed" dir="auto">
                {preview.blocks.map((b, i) => b.heading
                  ? <h2 key={i} className="pt-2 text-lg font-semibold" dir="auto">{b.text}</h2>
                  : <p key={i} className="whitespace-pre-wrap text-sm" dir="auto">{b.text}</p>)}
              </article>
            )}
            {preview?.kind === "xlsx" && (
              <>
                <div className="mb-3 flex flex-wrap gap-1">
                  {preview.sheets.map((s, i) => (
                    <button key={i} onClick={() => setSheet(i)} className={`rounded-md px-3 py-1 text-xs ${sheet === i ? "bg-[#217346]/30 text-[#7fd6a4]" : "bg-panel-2 text-muted"}`}>{s.name}</button>
                  ))}
                </div>
                <div className="max-h-[60vh] overflow-auto rounded-md border border-line" dir="ltr">
                  <table className="num min-w-full text-sm">
                    <tbody>
                      {preview.sheets[sheet]?.rows.map((r, i) => (
                        <tr key={i} className={i === 0 ? "bg-panel-2 font-semibold" : "border-t border-line"}>
                          <td className="w-10 border-e border-line px-2 py-1 text-end text-xs text-muted">{i + 1}</td>
                          {r.map((c, j) => <td key={j} className={`whitespace-nowrap px-3 py-1 ${typeof c === "number" ? "text-end" : ""}`} dir="auto">{c === null ? "" : typeof c === "number" ? f.number(c) : String(c)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.sheets[sheet]?.truncated && <p className="mt-2 text-xs text-muted">{t("truncated")}</p>}
              </>
            )}
            {preview?.kind === "pptx" && (
              <ol className="grid gap-3 sm:grid-cols-2">
                {preview.slides.map(s => (
                  <li key={s.n} className="aspect-video overflow-hidden rounded-lg border border-line bg-panel-2 p-4">
                    <p className="text-xs text-muted">{t("slide", { n: s.n })}</p>
                    {s.lines.map((l, i) => <p key={i} className={i === 0 ? "mt-1 font-semibold" : "mt-1 text-sm text-muted"} dir="auto">{l}</p>)}
                  </li>
                ))}
              </ol>
            )}
            {preview?.kind === "text" && <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm" dir="auto">{preview.text}</pre>}
            {preview?.kind === "binary" && <p className="text-sm text-muted">{t("noPreview")}</p>}
          </section>
        </div>
      )}

      {tab === "photos" && pin.length >= 6 && photos && (
        photos.state === "up" ? (
          photos.photos?.length ? (
            <ul className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-8">
              {photos.photos.map(p => (
                <li key={p.id} className="aspect-square overflow-hidden rounded-md bg-panel-2">
                  {thumbs[p.id] && <img src={thumbs[p.id]} alt={p.name} className="size-full object-cover" loading="lazy" />}
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-sm text-muted">{t("noPhotos")}</p>
        ) : (
          <div className="panel mt-4 max-w-2xl p-5">
            <h2 className="font-semibold">{t(`immich.${photos.state}.title`)}</h2>
            <p className="mt-1 text-sm text-muted">{t(`immich.${photos.state}.body`)}</p>
            {photos.error && <p className="mt-2 font-mono text-xs text-bad" dir="ltr">{photos.error}</p>}
          </div>
        )
      )}
    </div>
  );
}
