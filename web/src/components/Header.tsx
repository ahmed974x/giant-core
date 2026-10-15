"use client";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useLive } from "@/lib/relay";
import { usePulse } from "@/lib/status";

const SCREENS = [
  { href: "/", key: "command" },
  { href: "/company", key: "company" },
  { href: "/market", key: "market" },
  { href: "/earth", key: "earth" },
  { href: "/research", key: "research" },
] as const;
const MORE = [{ href: "/library", key: "library" }, { href: "/network", key: "network" }, { href: "/atlas", key: "atlas" }, { href: "/review", key: "review" }] as const;
const BOTTOM = ["command", "market", null, "earth", "company"] as const;

const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));

const Icon = ({ d, className = "size-5" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const BELL = "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0";
const GEAR = "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z";
const SEARCH = "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35";

/** Header: glowing OMEGA mark, main screens, live indicators, approvals bell. Phones get a bottom tab bar with Send
 *  raised in the middle, and the remaining screens as a strip under the header. */
export default function Header() {
  const t = useTranslations();
  const locale = useLocale();
  const path = usePathname();
  const live = useLive();
  const pulse = usePulse();
  const other = locale === "ar" ? "en" : "ar";
  const sending = path.startsWith("/send");
  const strip = [...SCREENS, ...MORE];
  const openCommand = () => window.dispatchEvent(new CustomEvent("omega:command"));

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-[#0A0E1A]/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5 sm:px-6">
          <Link href="/" className="group flex items-center gap-2.5 font-bold">
            <span className="omega-mark grid size-8 place-items-center rounded-lg text-base text-[#0A0E1A]">Ω</span>
            <span className="tracking-wide">{t("app.name")}</span>
          </Link>
          <nav className="hidden gap-0.5 lg:flex">
            {SCREENS.map(s => {
              const active = isActive(s.href, path);
              return (
                <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition duration-300 ${active ? "bg-panel-2 text-brass" : "text-muted hover:text-ink"}`}>
                  {t(`nav.${s.key}`)}
                </Link>
              );
            })}
            <details className="relative">
              <summary className={`cursor-pointer list-none whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${MORE.some(m => isActive(m.href, path)) ? "text-brass" : "text-muted hover:text-ink"}`}>{t("nav.more")} ▾</summary>
              <div className="panel absolute start-0 top-full z-30 mt-2 grid w-44 gap-0.5 p-1.5">
                {MORE.map(m => <Link key={m.key} href={m.href} className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-panel-2 hover:text-ink">{t(`nav.${m.key}`)}</Link>)}
              </div>
            </details>
          </nav>

          <div className="ms-auto flex items-center gap-1.5">
            <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted md:flex" title={t("pulse.live")}>
              <span className={`size-2 rounded-full ${live.connected ? "pulse-dot bg-good" : "bg-muted/50"}`} />{live.connected ? t("pulse.live") : t("pulse.local")}
            </span>
            <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted md:flex">
              <span className={`size-2 rounded-full ${pulse.director === "down" ? "bg-bad" : "pulse-dot bg-brass"}`} />Director 00
            </span>
            <button onClick={openCommand} className="rounded-lg p-2 text-muted hover:text-ink" aria-label={t("pulse.search")} title="Ctrl+K"><Icon d={SEARCH} /></button>
            <Link href="/company#inbox" className="relative rounded-lg p-2 text-muted hover:text-ink" aria-label={t("pulse.inbox", { n: pulse.pending })}>
              <Icon d={BELL} />
              {pulse.pending > 0 && <span className="absolute -end-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-brass px-1 text-[10px] font-bold text-[#0A0E1A]">{pulse.pending}</span>}
            </Link>
            <Link href="/review" className="hidden rounded-lg p-2 text-muted hover:text-ink sm:block" aria-label={t("nav.review")}><Icon d={GEAR} /></Link>
            <Link href="/send" aria-current={sending ? "page" : undefined}
              className="hidden rounded-lg bg-brass px-3 py-1.5 text-sm font-semibold text-[#0A0E1A] sm:block">{t("nav.send")}</Link>
            <Link href={path} locale={other} className="rounded-lg border border-line px-2.5 py-1.5 text-sm hover:border-brass">{t("app.switchLang")}</Link>
          </div>
        </div>
        <nav aria-label={t("nav.more")} className="flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
          {strip.map(s => {
            const active = isActive(s.href, path);
            return (
              <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${active ? "border-brass text-brass" : "border-line text-muted"} ${BOTTOM.includes(s.key as never) ? "hidden sm:inline-block" : ""}`}>
                {t(`nav.${s.key}`)}
              </Link>
            );
          })}
        </nav>
      </header>

      <nav aria-label={t("app.name")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[#0A0E1A]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
        <div className="grid grid-cols-5 items-end">
          {BOTTOM.map(key => {
            if (!key) return (
              <Link key="send" href="/send" aria-current={sending ? "page" : undefined} className="flex flex-col items-center pb-1.5">
                <span className={`-mt-5 grid size-14 place-items-center rounded-full bg-brass text-[#0A0E1A] shadow-[0_0_0_4px_#0A0E1A,0_0_24px_rgba(245,179,1,0.35)] ${sending ? "ring-2 ring-brass/60 ring-offset-2 ring-offset-[#0A0E1A]" : ""}`}>
                  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </span>
                <span className="mt-0.5 text-[11px] font-medium text-brass">{t("nav.send")}</span>
              </Link>
            );
            const s = SCREENS.find(x => x.key === key)!, active = isActive(s.href, path);
            return (
              <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${active ? "text-brass" : "text-muted"}`}>
                <span className={`h-0.5 w-6 rounded-full ${active ? "bg-brass" : "bg-transparent"}`} />
                {t(`nav.${s.key}`)}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
