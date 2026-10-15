"use client";
import { useTranslations } from "next-intl";

export default function Severity({ level }: { level: "watch" | "high" }) {
  const t = useTranslations("severity");
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${level === "high" ? "bg-bad/15 text-bad" : "bg-warn/15 text-warn"}`}>
      {t(level)}
    </span>
  );
}
