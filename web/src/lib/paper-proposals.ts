// Paper proposal queue (ADR-073). The system reads market data and proposes paper trades; nothing is recorded in the
// paper account until Ahmad approves that one proposal on the screen. There is no auto-approve path: scanning only
// ever appends "proposed" events, and a fill is written only by approve(), which the PIN-guarded route calls on a tap.
// Every proposal carries the numbers it was based on and a link to the raw data, so it can be checked by eye.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fillOrder, type Account, type Fill, type Side } from "./paper.ts";
import type { Result } from "./strategies.ts";

export const PROPOSAL_USD = 100;              // size of a proposed paper buy
export const PROPOSAL_TTL_MS = 24 * 3600_000; // evidence older than a day is stale: the proposal can't be approved
export const MAX_DRIFT = 0.03;                // refuse approval if the price moved more than 3% since the proposal

export type Evidence = {
  source: string;                              // e.g. "strategy:trend 1d"
  summary: Record<string, number | string>;    // the numbers behind the signal
  url: string;                                 // raw data the signal was computed from
  observed_price: number;
  observed_at: string;
};
export type Proposal = { id: string; at: string; symbol: string; side: Side; usd?: number; evidence: Evidence };
export type ProposalEvent =
  | ({ type: "proposed" } & Proposal)
  | { type: "approved"; id: string; at: string; by: string; fill_id: string; price: number }
  | { type: "rejected"; id: string; at: string; by: string; reason: string };
export type Status = "pending" | "approved" | "rejected" | "expired";
export type Row = Proposal & { status: Status; decided_at?: string; by?: string; fill_id?: string; reason?: string };

const SYMBOL = /^[A-Z0-9]{2,15}USDT$/;
const ID = /^[0-9a-f]{12}$/;

/** Evidence must point somewhere Ahmad can open: an https URL or a path on this same site. */
export function validEvidence(e: unknown): Evidence {
  const x = (e ?? {}) as Partial<Evidence>;
  const url = String(x.url ?? "");
  const linkOk = /^https:\/\/[^\s]+$/.test(url) || /^\/api\/[a-z0-9/_-]+(\?[^\s]*)?$/i.test(url);
  if (!linkOk) throw new Error("a proposal needs a link to its evidence");
  if (typeof x.source !== "string" || !x.source.trim()) throw new Error("a proposal needs its source");
  if (!(Number(x.observed_price) > 0)) throw new Error("a proposal needs the price it saw");
  if (!x.summary || typeof x.summary !== "object") throw new Error("a proposal needs the numbers behind it");
  return { source: x.source.slice(0, 80), summary: x.summary, url, observed_price: Number(x.observed_price), observed_at: String(x.observed_at ?? "") };
}

export function makeProposal(input: { symbol: string; side: Side; usd?: number; evidence: unknown }, now = new Date()): Proposal {
  const symbol = String(input.symbol ?? "").toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("pick a USDT pair, like BTCUSDT");
  if (input.side !== "buy" && input.side !== "sell") throw new Error("side must be buy or sell");
  return { id: randomBytes(6).toString("hex"), at: now.toISOString(), symbol, side: input.side,
    ...(input.side === "buy" ? { usd: Number(input.usd ?? PROPOSAL_USD) } : {}), evidence: validEvidence(input.evidence) };
}

/** Rebuild the queue from its log. A pending proposal past its TTL reads as expired. */
export function replayProposals(events: ProposalEvent[], now = new Date()): Row[] {
  const rows = new Map<string, Row>();
  for (const e of events) {
    if (e.type === "proposed") { const { type: _t, ...p } = e; rows.set(e.id, { ...p, status: "pending" }); continue; }
    const r = rows.get(e.id);
    if (!r || r.status !== "pending") continue;    // a decision counts once
    if (e.type === "approved") Object.assign(r, { status: "approved", decided_at: e.at, by: e.by, fill_id: e.fill_id });
    else Object.assign(r, { status: "rejected", decided_at: e.at, by: e.by, reason: e.reason });
  }
  for (const r of rows.values())
    if (r.status === "pending" && now.getTime() - Date.parse(r.at) > PROPOSAL_TTL_MS) r.status = "expired";
  return [...rows.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/** Turn today's strategy signals into proposals. Skips holds, sells of coins not held, and anything already pending. */
export function proposalsFromSignals(o: { symbol: string; interval: string; price: number; results: Result[]; account: Account; pending: Row[] },
  now = new Date()): Proposal[] {
  const held = new Set(o.account.holdings.map(h => h.symbol));
  const klines = `https://data-api.binance.vision/api/v3/klines?symbol=${o.symbol}&interval=${o.interval}&limit=500`;
  const out: Proposal[] = [];
  for (const r of o.results) {
    if (r.signal === "hold") continue;
    if (r.signal === "sell" && !held.has(o.symbol)) continue;
    const source = `strategy:${r.id} ${o.interval}`;
    if (o.pending.some(p => p.status === "pending" && p.symbol === o.symbol && p.side === r.signal && p.evidence.source === source)) continue;
    const summary: Record<string, number | string> = { ...r.reason };
    if (r.backtest) Object.assign(summary, { backtestReturnPct: r.backtest.returnPct, buyHoldPct: r.backtest.buyHoldPct, maxDrawdownPct: r.backtest.maxDrawdownPct });
    out.push(makeProposal({ symbol: o.symbol, side: r.signal, usd: PROPOSAL_USD, evidence: {
      source, summary, url: r.id === "news" ? "/api/worldpulse" : klines, observed_price: o.price, observed_at: now.toISOString() } }, now));
  }
  return out;
}

/** Ahmad approved this proposal: fill it on paper at the live price. Refuses stale, decided or drifted proposals. */
export function approve(row: Row | undefined, account: Account, livePrice: number, by: string, now = new Date()): { fill: Fill; event: ProposalEvent } {
  if (!row) throw new Error("no such proposal");
  if (row.status !== "pending") throw new Error(`this proposal is already ${row.status}`);
  if (!(livePrice > 0)) throw new Error(`no live price for ${row.symbol}`);
  const drift = Math.abs(livePrice - row.evidence.observed_price) / row.evidence.observed_price;
  if (drift > MAX_DRIFT) throw new Error(`the price moved ${(drift * 100).toFixed(1)}% since this was proposed; reject it and scan again`);
  const fill = fillOrder(account, { symbol: row.symbol, side: row.side, usd: row.usd, mode: "paper" }, livePrice, now);
  return { fill, event: { type: "approved", id: row.id, at: now.toISOString(), by, fill_id: fill.id, price: fill.price } };
}

export function reject(row: Row | undefined, by: string, reason: unknown, now = new Date()): ProposalEvent {
  if (!row) throw new Error("no such proposal");
  if (row.status !== "pending") throw new Error(`this proposal is already ${row.status}`);
  return { type: "rejected", id: row.id, at: now.toISOString(), by, reason: typeof reason === "string" ? reason.slice(0, 200) : "" };
}

export const validId = (id: unknown): string => {
  if (typeof id !== "string" || !ID.test(id)) throw new Error("invalid proposal id");
  return id;
};

// Lives beside the paper ledger, in Director 00's git-ignored data folder.
export const proposalsPath = (dataDir: string) => path.join(dataDir, "paper", "proposals.jsonl");

export async function loadProposalEvents(dataDir: string): Promise<ProposalEvent[]> {
  let raw = "";
  try { raw = await readFile(proposalsPath(dataDir), "utf8"); } catch { return []; }
  return raw.split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as ProposalEvent]; } catch { return []; } });
}

export async function appendProposalEvent(dataDir: string, e: ProposalEvent): Promise<void> {
  await mkdir(path.dirname(proposalsPath(dataDir)), { recursive: true });
  await appendFile(proposalsPath(dataDir), JSON.stringify(e) + "\n");
}
