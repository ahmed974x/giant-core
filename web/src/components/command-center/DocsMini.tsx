"use client";
import { useEffect, useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import type { DocItem } from "@/lib/documents";

const BADGE: Record<string, string> = { word: "text-[#8db4ff]", excel: "text-[#6ee7b7]", powerpoint: "text-[#fdba74]", pdf: "text-bad", image: "text-accent", text: "text-muted" };

/** The latest files and briefings from the Library, plus one-tap exports. Private: shown only once the PIN is in
 *  this tab's session (entered on any screen). */
export default function DocsMini({ onCount }: { onCount?: (n: number | null) => void }) {
  const t = useTranslations("command.docs");
  const f = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [items, setItems] = useState<DocItem[] | null>(null);
  const [pin, setPin] = useState("");

  useEffect(() => {
    let p = "";
    try { p = sessionStorage.getItem("omega-pin") ?? ""; } catch { /* storage blocked */ }
    setPin(p);
    if (p.length < 6) { onCount?.(null); return; }
    fetch("/api/documents", { headers: { "x-omega-pin": p }, cache: "no-store" }).then(r => (r.ok ? r.json() : null))
      .then(j => { setItems(j?.items ?? null); onCount?.(j?.items?.length ?? null); }).catch(() => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = async (e: React.MouseEvent, fmt: "xlsx" | "docx" | "pptx") => {
    e.stopPropagation();
    const r = await fetch(`/api/documents?export=${fmt}`, { headers: { "x-omega-pin": pin } }).catch(() => null);
    if (!r?.ok) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob()); a.download = `omega-ledger-${new Date().toISOString().slice(0, 10)}.${fmt}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (pin.length < 6) return <p className="px-4 pt-6 text-sm text-muted">{t("locked")}</p>;
  return (
    <div className="flex h-full flex-col px-4 pb-3">
      <ul className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-hidden">
        {items?.slice(0, 5).map(d => (
          <li key={d.name} className="flex items-center gap-2 text-sm">
            <span className={`w-16 shrink-0 text-[11px] font-semibold ${BADGE[d.type] ?? "text-muted"}`}>{t(`types.${d.type}`)}</span>
            <span className="min-w-0 flex-1 truncate" dir="auto">{d.name.replace(/^\d{8}-[0-9a-f]{8}-/, "")}</span>
            <span className="shrink-0 text-[11px] text-muted">{f.relativeTime(new Date(d.modified), now)}</span>
          </li>
        ))}
        {items && !items.length && <li className="text-sm text-muted">{t("empty")}</li>}
      </ul>
      <div className="flex gap-1.5 pt-2">
        {(["xlsx", "docx", "pptx"] as const).map(fmt => (
          <button key={fmt} onClick={e => download(e, fmt)} className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-brass hover:text-brass">{t(`export.${fmt}`)}</button>
        ))}
      </div>
    </div>
  );
}
