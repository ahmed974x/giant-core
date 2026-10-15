// World Pulse (ADR-048): market-moving events from GDACS, USGS and GDELT, each with its evidence and the assets it
// tends to push. Public, keyless data, so no PIN. Cached for 5 minutes.
import { fromGdelt, fromUsgs, lean, readGdacs, type Driver } from "@/lib/worldpulse";
import { GET as hazardsGET } from "../hazards/route";
import { GET as eventsGET } from "../events/route";

let last: { at: number; body: unknown } | null = null;

export async function GET() {
  if (last && Date.now() - last.at < 5 * 60_000) return Response.json(last.body, { headers: { "Cache-Control": "no-store" } });
  const json = (p: Promise<Response>) => p.then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [gdacs, hz, ev] = await Promise.all([readGdacs(), json(hazardsGET()), json(eventsGET())]);
  const drivers: Driver[] = [...gdacs, ...fromUsgs(hz?.hazards ?? []), ...fromGdelt(ev?.events ?? [])]
    .sort((a, b) => b.severity - a.severity || (a.region === "world" ? 1 : 0) - (b.region === "world" ? 1 : 0) || b.at.localeCompare(a.at));
  const body = { at: new Date().toISOString(), drivers: drivers.slice(0, 40), lean: lean(drivers),
    sources: { gdacs: gdacs.length, usgs: (hz?.hazards ?? []).length ? "ok" : "unavailable", gdelt: ev?.events ? "ok" : "unavailable" } };
  last = { at: Date.now(), body };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
