"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useLive } from "@/lib/relay";
import { usePulse } from "@/lib/status";

/** The system's pulse along the bottom: approvals waiting, Phoenix, memory, live feed, and how fresh this is. */
export default function StatusBar() {
  const t = useTranslations("command.status");
  const pulse = usePulse();
  const live = useLive();
  const [ago, setAgo] = useState(0);
  useEffect(() => { const id = setInterval(() => setAgo(pulse.at ? Math.round((Date.now() - pulse.at) / 1000) : 0), 1000); return () => clearInterval(id); }, [pulse.at]);

  const dot = (tone: "good" | "bad" | "warn" | "muted" | "brass", pulseIt = false) =>
    <span className={`size-2 shrink-0 rounded-full ${pulseIt ? "pulse-dot" : ""} ${{ good: "bg-good", bad: "bg-bad", warn: "bg-warn", muted: "bg-muted/50", brass: "bg-brass" }[tone]}`} />;
  const item = "flex items-center gap-1.5 whitespace-nowrap";
  return (
    <footer className="glass !bg-[#0A0E1A]/90 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-2xl px-4 py-2.5 text-xs text-muted">
      <Link href="/company#inbox" className={`${item} hover:text-ink`}>{dot(pulse.pending ? "brass" : "good", pulse.pending > 0)}{t("director", { n: pulse.pending })}</Link>
      <span className={item}>{dot(pulse.phoenix === "ok" ? "good" : pulse.phoenix === "down" ? "warn" : "muted")}{t("phoenix")}: {t(`phoenixState.${pulse.phoenix}`)}</span>
      <span className={item}>{dot("muted")}{t("memory", { n: pulse.memories ?? 0 })}</span>
      <span className={item}>{dot(live.connected ? "good" : "muted", live.connected)}{live.connected ? t("live") : t("local")}</span>
      <span className="ms-auto whitespace-nowrap">{pulse.at ? t("updated", { s: ago }) : t("loading")}</span>
    </footer>
  );
}
