"use client";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

const SCREENS = [
  { href: "/", key: "company" },
  { href: "/market", key: "market" },
  { href: "/research", key: "research" },
  { href: "/earth", key: "earth" },
] as const;
const DESKTOP_ONLY = [{ href: "/library", key: "library" }, { href: "/network", key: "network" }, { href: "/atlas", key: "atlas" }] as const;

const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));

/** Top bar on wide screens; on phones a bottom tab bar (thumb reach) with Send raised in the middle. */
export default function Header() {
  const t = useTranslations();
  const locale = useLocale();
  const path = usePathname();
  const other = locale === "ar" ? "en" : "ar";
  const sending = path.startsWith("/send");

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-[#071526]/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="grid size-7 place-items-center rounded-md bg-accent text-sm text-[#071526]">Ω</span>
            <span>{t("app.name")}</span>
          </Link>
          <nav className="hidden gap-1 sm:flex">
            {[...SCREENS, ...DESKTOP_ONLY].map(s => {
              const active = isActive(s.href, path);
              return (
                <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-panel-2 text-accent" : "text-muted hover:text-ink"}`}>
                  {t(`nav.${s.key}`)}
                </Link>
              );
            })}
          </nav>
          <Link href="/send" aria-current={sending ? "page" : undefined}
            className="ms-auto hidden rounded-lg bg-brass px-3 py-1.5 text-sm font-semibold text-[#071526] sm:block">
            {t("nav.send")}
          </Link>
          <Link href={path} locale={other} className="ms-auto rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent sm:ms-0">
            {t("app.switchLang")}
          </Link>
        </div>
      </header>

      <nav aria-label={t("app.name")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[#071526]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        <div className="grid grid-cols-5 items-end">
          {[SCREENS[0], SCREENS[1], null, SCREENS[2], SCREENS[3]].map(s => {
            if (!s) return (
              <Link key="send" href="/send" aria-current={sending ? "page" : undefined} className="flex flex-col items-center pb-1.5">
                <span className={`-mt-5 grid size-14 place-items-center rounded-full bg-brass text-[#071526] shadow-[0_0_0_4px_#071526] ${sending ? "ring-2 ring-brass/60 ring-offset-2 ring-offset-[#071526]" : ""}`}>
                  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </span>
                <span className="mt-0.5 text-[11px] font-medium text-brass">{t("nav.send")}</span>
              </Link>
            );
            const active = isActive(s.href, path);
            return (
              <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${active ? "text-accent" : "text-muted"}`}>
                <span className={`h-0.5 w-6 rounded-full ${active ? "bg-accent" : "bg-transparent"}`} />
                {t(`nav.${s.key}`)}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
