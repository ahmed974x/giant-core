// Nervous system (ADR-028): the registry with each node's live state, the awesome-atlas categories as satellites,
// and which optional keys are configured (true/false only, never the values).
import registry from "../../../../data/nervous-system.json";
import atlasData from "../../../../data/awesome-atlas.json";
import { GET as health } from "../health/route";
import { nodeState, withAtlas, type LiveNode, type Registry } from "@/lib/network";
import type { Atlas } from "@/lib/awesome";

const KEYS = ["FIRECRAWL_API_KEY", "AISSTREAM_API_KEY", "WINDY_WEBCAMS_KEY", "NASA_FIRMS_KEY"];

export async function GET() {
  const { checks } = await (await health()).json() as { checks: Record<string, { state: string; detail?: string }> };
  const keys = Object.fromEntries(KEYS.map(k => [k, Boolean(process.env[k]?.trim())]));
  const full = withAtlas(registry as Registry, atlasData as Atlas);
  const nodes: LiveNode[] = full.nodes.map(n => ({ ...n, ...nodeState(n, checks, keys) }));
  return Response.json({ checkedAt: new Date().toISOString(), nodes, edges: full.edges }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
