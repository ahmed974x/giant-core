// Oil Watch (ADR-047): the tanker and oil-site fire bots, their latest reading and the combined signal. Read-only
// public data, so no PIN; each call records at most one reading an hour to build the baselines.
import { directorData } from "@/lib/director";
import { assess, fireBot, loadHistory, OIL_SITES, readTankers, record, type FirePoint, type Snapshot } from "@/lib/oilwatch";
import { GET as hazardsGET } from "../hazards/route";
import { aisStatus, hormuzTankers } from "@/lib/ais";

let last: { at: number; body: unknown } | null = null;

export async function GET() {
  if (last && Date.now() - last.at < 60_000) return Response.json(last.body, { headers: { "Cache-Control": "no-store" } });
  const [tankers, hz] = await Promise.all([
    readTankers(),
    hazardsGET().then(r => r.json()).catch(() => null) as Promise<{ hazards?: FirePoint[]; firms?: string } | null>,
  ]);
  const firmsOk = hz?.firms === "ok";
  const snap: Snapshot = { at: new Date().toISOString(), tankers, sites: firmsOk ? fireBot(hz?.hazards ?? []) : null };
  const history = await loadHistory(directorData());
  const signal = assess(snap, history);
  await record(directorData(), snap, history).catch(() => false);
  aisStatus();   // starts the AISStream socket when its key is set
  const body = { ...snap, signal, hormuz: hormuzTankers(), firms: hz?.firms ?? "error", sitesWatched: OIL_SITES.length,
    sources: ["Fintraffic Digitraffic AIS (CC BY 4.0)", "NASA FIRMS VIIRS"] };
  last = { at: Date.now(), body };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
