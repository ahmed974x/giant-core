"use client";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

const SCREENS = [
  { href: "/", key: "company" },
  { href: "/market", key: "market" },
  { href: "/research", key: "research" },
  { href: "/earth", key: "earth" },
] as const;

export default function Header() {
  const t = useTranslations();
  const locale = useLocale();
  const path = usePathname();
  const other = locale === "ar" ? "en" : "ar";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-[#0a0f15]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-wide">
          <span className="grid size-7 place-items-center rounded-md bg-accent text-sm text-[#0a0f15]">Ω</span>
          <span>{t("app.name")}</span>
        </Link>
        <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {SCREENS.map(s => {
            const active = s.href === "/" ? path === "/" : path.startsWith(s.href);
            return (
              <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-panel-2 text-accent" : "text-muted hover:text-ink"}`}>
                {t(`nav.${s.key}`)}
              </Link>
            );
          })}
        </nav>
        <Link href={path} locale={other} className="ms-auto rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">
          {t("app.switchLang")}
        </Link>
      </div>
    </header>
  );
}
