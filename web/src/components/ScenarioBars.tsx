"use client";
import { useLocale, useTranslations } from "next-intl";

export type Scenario = {
  key: string; scenario: string; scenario_ar: string; probability: number;
  impact_range: [number, number]; confidence: number; tail_risk_flag: boolean;
};

const COLOR: Record<string, string> = { none: "#6b7a8c", compound: "#f2685c" };
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

/** Five Butterfly scenarios as horizontal probability bars (pure CSS, no chart library). */
export default function ScenarioBars({ scenarios }: { scenarios: Scenario[] }) {
  const t = useTranslations("research.causal.scenarios");
  const ar = useLocale() === "ar";
  const max = Math.max(...scenarios.map(s => s.probability), 0.01);
  return (
    <div className="border-t border-line p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <span className="text-xs text-muted">{t("subtitle")}</span>
      </div>
      <ul className="space-y-2.5">
        {scenarios.map(s => (
          <li key={s.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,16rem)_1fr_auto]">
            <span className="flex min-w-0 items-center gap-2" title={ar ? s.scenario_ar : s.scenario}>
              <span className="truncate" dir="auto">{ar ? s.scenario_ar : s.scenario}</span>
              {s.tail_risk_flag && <span className="shrink-0 rounded bg-bad/15 px-1.5 py-0.5 text-[10px] font-semibold text-bad">{t("tail")}</span>}
            </span>
            <div className="order-3 col-span-2 h-2.5 overflow-hidden rounded-full bg-panel-2 sm:order-none sm:col-span-1" dir="ltr"
              role="img" aria-label={`${Math.round(s.probability * 100)}%`}>
              <div className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${(s.probability / max) * 100}%`, background: COLOR[s.key] ?? "#3dd6c6", opacity: 0.35 + 0.65 * s.confidence }} />
            </div>
            <span className="num text-end text-xs" dir="ltr">
              <span className="font-semibold">{Math.round(s.probability * 100)}%</span>
              <span className="ms-2 text-muted">{s.key === "none" ? "—" : `${pct(s.impact_range[0])} … ${pct(s.impact_range[1])}`}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted">{t("legend")}</p>
    </div>
  );
}
