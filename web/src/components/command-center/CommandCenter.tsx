"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import CommandBar from "./CommandBar";
import DocsMini from "./DocsMini";
import MiniCard from "./MiniCard";
import Particles from "./Particles";
import StatusBar from "./StatusBar";

// The heavy, browser-only pieces load after the page shell: WebGL globe, chart, network canvas.
const EarthMini = dynamic(() => import("./EarthMini"), { ssr: false, loading: () => <div className="size-full animate-pulse" /> });
const MarketMini = dynamic(() => import("./MarketMini"), { ssr: false });
const NetworkMini = dynamic(() => import("./NetworkMini"), { ssr: false });

const ROUTES = ["/earth", "/market", "/network", "/library"] as const;

/** Command Center (ADR-039): four live miniature screens around one command bar, with the system's pulse below.
 *  Keys: Ctrl+K command bar, 1-4 open a screen, Esc closes the answer. */
export default function CommandCenter() {
  const t = useTranslations("command");
  const f = useFormatter();
  const router = useRouter();
  const [earth, setEarth] = useState<{ planes: number; ships: number | null; events: number; hazards: number } | null>(null);
  const [quote, setQuote] = useState<{ price: number; change24h: number } | null>(null);
  const [net, setNet] = useState<{ nodes: number; edges: number; down: number } | null>(null);
  const [docs, setDocs] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) router.push(ROUTES[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  const cards = {
    earth: (
      <MiniCard index={1} href="/earth" icon="🌍" title={t("cards.earth.title")} glow="cyan"
        stat={earth ? t("cards.earth.stat", { events: earth.events, hazards: earth.hazards, planes: earth.planes }) : t("loading")}
        detail={earth ? (earth.ships === null ? t("cards.earth.noShips") : t("cards.earth.ships", { n: earth.ships })) : null}>
        <EarthMini onCounts={setEarth} />
      </MiniCard>
    ),
    market: (
      <MiniCard index={2} href="/market" icon="📊" title={t("cards.market.title")} glow={quote && quote.change24h < 0 ? "purple" : "gold"}
        stat={quote ? <span className="num" dir="ltr">BTC {f.number(quote.price, { maximumFractionDigits: 0 })} <span className={quote.change24h >= 0 ? "text-accent" : "text-pink"}>{pct(quote.change24h)}</span></span> : t("loading")}
        detail={t("cards.market.detail")}>
        <MarketMini onQuote={setQuote} />
      </MiniCard>
    ),
    network: (
      <MiniCard index={3} href="/network" icon="🧠" title={t("cards.network.title")} glow={net && net.down > 0 ? "orange" : "purple"}
        stat={net ? t("cards.network.stat", { nodes: net.nodes, edges: net.edges }) : t("loading")}
        detail={net ? (net.down ? t("cards.network.down", { n: net.down }) : t("cards.network.allOk")) : null}>
        <NetworkMini onStats={setNet} />
      </MiniCard>
    ),
    docs: (
      <MiniCard index={4} href="/library" icon="📚" title={t("cards.docs.title")} glow="green"
        stat={docs === null ? t("cards.docs.private") : t("cards.docs.stat", { n: docs })} detail={t("cards.docs.detail")}>
        <DocsMini onCount={setDocs} />
      </MiniCard>
    ),
  };

  return (
    <div className="relative -mt-2 space-y-4 pb-24 sm:pb-20">
      <Particles />
      <div className="text-center">
        <h1 className="bg-gradient-to-r from-brass via-[#FCD34D] to-brass bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("lead")}</p>
      </div>

      {/* Phones: the command bar comes first, then the cards in one column. Wider: cards above and below the bar. */}
      <div className="sm:hidden"><CommandBar /></div>
      <div className="grid gap-4 sm:grid-cols-2">{cards.earth}{cards.market}</div>
      <div className="hidden sm:block"><CommandBar /></div>
      <div className="grid gap-4 sm:grid-cols-2">{cards.network}{cards.docs}</div>

      <div className="sm:sticky sm:bottom-3 sm:z-10"><StatusBar /></div>
      <p className="hidden text-center text-xs text-muted sm:block">
        <span className="kbd">Ctrl+K</span> {t("keys.command")} · <span className="kbd">1</span>-<span className="kbd">4</span> {t("keys.screens")} · <span className="kbd">Esc</span> {t("keys.close")}
      </p>
    </div>
  );
}
