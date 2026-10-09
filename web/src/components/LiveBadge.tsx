"use client";
import { useTranslations } from "next-intl";

export default function LiveBadge({ connected, demo }: { connected: boolean; demo: boolean }) {
  const t = useTranslations("app");
  if (!connected && !demo) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${connected ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
      <span className={`size-1.5 rounded-full ${connected ? "animate-pulse bg-good" : "bg-warn"}`} />
      {connected ? t("live") : t("demo")}
    </span>
  );
}
