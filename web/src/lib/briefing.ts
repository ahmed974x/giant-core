// Morning briefing (ADR-037): every day at 07:00 the scheduled task builds a PowerPoint briefing of Director 00's
// ledger into the Library, runs the Profit Sweeper check (proposal-only), and pushes one alert to the phone.
import { randomBytes } from "node:crypto";
import { readdir, readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ledgerFile } from "./documents.ts";
import { approvals as ledgerApprovals, rejections as ledgerRejections } from "./ledger.ts";
import { fetchPrices, planSweep, sweepRequest, validPositions, validRules } from "./sweeper.ts";

export type BriefingResult = { deck: string; pending: number; sweep: "proposed" | "nothing" | "already-waiting" | "no-positions" | "no-prices"; sweepUsd: number; note: { title: string; body: string; url: string; tag: string } };
type Deps = { runDirector: (args: string[]) => Promise<unknown>; fetch?: typeof fetch; now?: Date };

const KEEP = 14; // briefing decks kept in the Library

export async function morningBriefing(dataDir: string, rulesFile: string, deps: Deps): Promise<BriefingResult> {
  const now = deps.now ?? new Date(), day = now.toISOString().slice(0, 10);
  let approvals: never[] = [], rejections: never[] = [];
  try {
    approvals = await ledgerApprovals(dataDir) as never[];
    rejections = await ledgerRejections(dataDir) as never[];
  } catch { /* no ledger yet: an empty briefing still goes out */ }

  // 1. The deck, saved where the Library lists it; old briefings beyond KEEP are removed.
  const inbox = path.join(dataDir, "inbox");
  await mkdir(inbox, { recursive: true });
  const name = `${day.replace(/-/g, "")}-${randomBytes(4).toString("hex")}-morning-briefing.pptx`;
  await writeFile(path.join(inbox, name), ledgerFile("pptx", approvals, rejections, now));
  const decks = (await readdir(inbox)).filter(n => /^\d{8}-[0-9a-f]{8}-morning-briefing\.pptx$/.test(n)).sort();
  for (const old of decks.slice(0, Math.max(0, decks.length - KEEP))) await unlink(path.join(inbox, old)).catch(() => null);

  // 2. Profit Sweeper: propose at most once a day; never trades.
  const pending = (approvals as { status: string; request: string }[]).filter(a => a.status === "pending" || a.status === "escalated");
  let sweep: BriefingResult["sweep"] = "no-positions", sweepUsd = 0;
  try {
    const positions = validPositions(JSON.parse(await readFile(path.join(dataDir, "positions.json"), "utf8")));
    const rules = validRules(JSON.parse(await readFile(rulesFile, "utf8")));
    let prices: Record<string, number> | null = null;
    try { prices = await fetchPrices(positions.map(p => p.symbol), deps.fetch); } catch { sweep = "no-prices"; }
    if (prices) {
      const plan = planSweep(positions, prices, rules), request = sweepRequest(plan, now);
      sweepUsd = plan.totalSweepUsd;
      if (!request) sweep = "nothing";
      else if (pending.some(p => p.request.includes(`profit sweep plan ${day}`))) sweep = "already-waiting";
      else { await deps.runDirector(["ask", request]); sweep = "proposed"; }
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }

  const waiting = pending.length + (sweep === "proposed" ? 1 : 0);
  const body = [
    waiting ? `${waiting} waiting for your approval` : "Nothing waiting for approval",
    sweep === "proposed" ? `Profit sweep plan: ~$${sweepUsd}` : null,
  ].filter(Boolean).join(" · ");
  return { deck: `inbox/${name}`, pending: waiting, sweep, sweepUsd, note: { title: "OMEGA · morning briefing", body, url: "/ar/library", tag: `briefing-${day}` } };
}
