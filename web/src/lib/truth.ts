// TypeScript twin of services/truth/truth_layer.py (ADR-021), so the web app can badge GDELT events without a Python
// round-trip. Same formula, same curated sources.json (read from services/truth at runtime); test/truth.test.ts runs both
// implementations on the same items and fails if they ever disagree.
import { readFileSync } from "node:fs";
import path from "node:path";

export const THRESHOLD = 0.7;
type Sources = { tiers: Record<string, { score: number }>; domains: Record<string, string> };

let cached: Sources | null = null;
function sources(): Sources {
  if (!cached) {
    const file = process.env.OMEGA_TRUTH_SOURCES
      ?? path.resolve(/* turbopackIgnore: true */ process.cwd(), "..", "services", "truth", "sources.json");
    cached = JSON.parse(readFileSync(file, "utf8")) as Sources;
  }
  return cached;
}

const OPINION = /\/(opinion|opinions|op-?ed|oped|comment|commentary|editorial|editorials|column|columns|columnists?|blogs?|analysis\/opinion|views?)\//i;
const LOADED = new RegExp(
  "\\b(shocking|bombshell|exposed|exposes|you won'?t believe|the truth about|wake up|cover-?up|traitors?|puppets?|" +
  "regime'?s? lies|lies of|evil|destroy(?:ed|s)?|slams?|annihilat\\w*|false flag|deep state|globalists?|" +
  "mainstream media|msm|hoax|crisis actors?|they don'?t want you to know)\\b", "i");

export type TruthItem = { id: string; url: string; title?: string; tone?: number; polarity?: number | null; num_sources?: number | null };
export type TruthResult = { event_id: string; score: number; status: "verified" | "unverified"; flags: string[]; source_tier: string; sources: number };

function parse(url: string): URL | null {
  try { return new URL(url); } catch { return null; }
}

export function domain(url: string): string {
  const host = (parse(url)?.hostname ?? "").toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

export function reputation(url: string): [number, string] {
  const { tiers, domains } = sources();
  const host = domain(url), parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const tier = domains[parts.slice(i).join(".")];
    if (tier) return [tiers[tier].score, tier];
  }
  if (/\.(gov|mil|int)$/.test(host) || host.includes(".gov.")) return [tiers.official.score, "official"];
  return [tiers.unknown.score, "unknown"];
}

function slugText(url: string): string {
  const p = parse(url)?.pathname ?? "";
  return p.replace(/\.\w{2,5}$/, "").replace(/[-_/]+/g, " ");
}

export function score(item: TruthItem): TruthResult {
  const flags: string[] = [];
  const [rep, tier] = reputation(item.url);
  if (["state_controlled", "satire", "unknown"].includes(tier)) flags.push(`source:${tier}`);

  const n = item.num_sources ?? 1;
  const corroboration = Math.min(1, (n - 1) / 3);
  if (n <= 1) flags.push("single_source");

  const neutrality = 1 - Math.max(Math.min(1, Math.abs(item.tone ?? 0) / 8), Math.min(1, (item.polarity ?? 0) / 15));
  if (neutrality < 0.5) flags.push("emotive_language");

  let penalty = 0;
  if (LOADED.test(`${item.title ?? ""} ${slugText(item.url)}`)) { flags.push("propaganda_pattern"); penalty += 0.15; }
  if (OPINION.test((parse(item.url)?.pathname ?? "") + "/")) { flags.push("opinion"); penalty += 0.1; }
  if (n <= 1 && tier === "unknown") penalty += 0.05;

  const s = Math.max(0, Math.min(1, 0.45 * rep + 0.3 * corroboration + 0.25 * neutrality - penalty));
  return { event_id: item.id, score: Math.round(s * 1000) / 1000, status: s >= THRESHOLD ? "verified" : "unverified", flags, source_tier: tier, sources: n };
}
