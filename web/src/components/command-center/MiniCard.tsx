"use client";
import type { ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";

export type Glow = "gold" | "cyan" | "purple" | "orange" | "green";

/** One of the four live miniature screens. The whole card opens its full screen (also keys 1-4); hovering or
 *  focusing it reveals the detail line. */
export default function MiniCard({ index, href, title, icon, glow, stat, detail, children }: {
  index: number; href: string; title: string; icon: string; glow: Glow; stat?: ReactNode; detail?: ReactNode; children: ReactNode;
}) {
  const router = useRouter();
  return (
    <article role="link" tabIndex={0} aria-label={title}
      onClick={() => router.push(href)} onKeyDown={e => { if (e.key === "Enter") router.push(href); }}
      className={`mini-card glass group relative flex h-[300px] cursor-pointer flex-col overflow-hidden rounded-2xl glow-${glow} sm:h-[330px]`}>
      <header className="relative z-10 flex items-center gap-2 px-4 pt-3.5">
        <span className="text-lg" aria-hidden>{icon}</span>
        <h2 className="font-semibold">{title}</h2>
        <span className="kbd ms-auto hidden sm:inline">{index}</span>
      </header>
      {stat && <div className="relative z-10 px-4 pt-1 text-sm text-muted">{stat}</div>}
      <div className="relative min-h-0 flex-1">{children}</div>
      {detail && (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-10 translate-y-2 bg-gradient-to-t from-[#0A0E1A] via-[#0A0E1A]/85 to-transparent px-4 pb-3 pt-8 text-xs text-muted opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
          {detail}
        </footer>
      )}
    </article>
  );
}
