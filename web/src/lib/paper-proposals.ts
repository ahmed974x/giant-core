// Paper proposal queue (ADR-073). The system reads market data and proposes paper trades; nothing is recorded in the
// paper account until Ahmad approves that one proposal on the screen. There is no auto-approve path: scanning only
// ever appends "proposed" events, and a fill is written only by approve(), which the PIN-guarded route calls on a tap.
// Every proposal carries the numbers it was based on and a link to the raw data, so it can be checked by eye.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { appendEvent, fillOrder, loadEvents, replay, serial, type Account, type Fill, type Side } from "./paper.ts";
import type { Result } from "./strategies.ts";

export const PROPOSAL_USD = 100;              // default size of a proposed paper buy
export const SIZE_MIN = 50, SIZE_MAX = 200;   // the resize rule never leaves this band
export const SIZE_WINDOW_MS = 14 * 24 * 3600_000;
export const SIZE_MIN_TRADES = 5;             // fewer closed trades than this is luck, not a result: keep 100
export const SIZE_STEP_PCT = 5;
export const PROPOSAL_TTL_MS = 24 * 3600_000; // evidence older than a day is stale: the proposal can't be approved
export const MAX_DRIFT = 0.03;                // refuse approval if the price moved more than 3% since the proposal

export type Evidence = {
  source: string;                              // e.g. "strategy:trend 1d"
  summary: Record<string, number | string>;    // the numbers behind the signal
  url: string;                                 // raw data the signal was computed from
  observed_price: number;
  observed_at: string;
};
// reasoning: the rule that fired, in plain words, so the audit log shows why the system proposed this (ADR-076).
export type Proposal = { id: string; at: string; symbol: string; side: Side; usd?: number; evidence: Evidence; reasoning: string };
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

export function makeProposal(input: { symbol: string; side: Side; usd?: number; evidence: unknown; reasoning?: string }, now = new Date()): Proposal {
  const symbol = String(input.symbol ?? "").toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("pick a USDT pair, like BTCUSDT");
  if (input.side !== "buy" && input.side !== "sell") throw new Error("side must be buy or sell");
  const reasoning = String(input.reasoning ?? "").trim().slice(0, 300);
  if (!reasoning) throw new Error("a proposal needs its reasoning");
  return { id: randomBytes(6).toString("hex"), at: now.toISOString(), symbol, side: input.side,
    ...(input.side === "buy" ? { usd: Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(input.usd ?? PROPOSAL_USD))) } : {}),
    evidence: validEvidence(input.evidence), reasoning };
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

/** Buy size from paper results only (Ahmad, 2026-10-16): over the last 14 days of closed paper trades, +5% or better
 *  doubles it to 200 USDT, -5% or worse halves it to 50 USDT, otherwise 100. Needs SIZE_MIN_TRADES closed trades. */
export function proposalSize(account: Account, now = new Date()): { usd: number; closed: number; returnPct: number | null } {
  const since = now.getTime() - SIZE_WINDOW_MS;
  const sells = account.fills.filter(f => f.side === "sell" && Date.parse(f.at) >= since);
  const basis = sells.reduce((s, f) => s + (f.usd - f.fee - f.realized), 0);
  const realized = sells.reduce((s, f) => s + f.realized, 0);
  const returnPct = basis > 0 ? Math.round((realized / basis) * 10_000) / 100 : null;
  if (sells.length < SIZE_MIN_TRADES || returnPct == null) return { usd: PROPOSAL_USD, closed: sells.length, returnPct };
  const usd = returnPct >= SIZE_STEP_PCT ? 200 : returnPct <= -SIZE_STEP_PCT ? 50 : PROPOSAL_USD;
  return { usd: Math.min(SIZE_MAX, Math.max(SIZE_MIN, usd)), closed: sells.length, returnPct };
}

/** Turn today's strategy signals into proposals. Skips holds, sells of coins not held, and anything already pending. */
export function proposalsFromSignals(o: { symbol: string; interval: string; price: number; results: Result[]; account: Account; pending: Row[]; usd?: number },
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
    const why = Object.entries(r.reason).map(([k, v]) => `${k} ${v}`).join(", ");
    const reasoning = `${r.id} rule on ${o.interval} candles says ${r.signal.toUpperCase()}${why ? ` (${why})` : ""}`;
    out.push(makeProposal({ symbol: o.symbol, side: r.signal, usd: o.usd ?? PROPOSAL_USD, reasoning, evidence: {
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

// Audit log (ADR-076): one line for every proposal, decision and rejection, with what the system saw, why it proposed,
// the price at the moment of the decision, and who decided. Append-only, next to the proposal queue.
export type AuditEntry = {
  at: string; id: string; symbol: string; side: Side; action: "proposed" | "approved" | "rejected"; actor: string;
  data: Evidence; reasoning: string; price_at_decision?: number; fill_id?: string; reason?: string;
};
export const auditPath = (dataDir: string) => path.join(dataDir, "paper", "audit.jsonl");

export async function appendAudit(dataDir: string, e: AuditEntry): Promise<void> {
  await mkdir(path.dirname(auditPath(dataDir)), { recursive: true });
  await appendFile(auditPath(dataDir), JSON.stringify(e) + "\n");
}

export async function loadAudit(dataDir: string): Promise<AuditEntry[]> {
  let raw = "";
  try { raw = await readFile(auditPath(dataDir), "utf8"); } catch { return []; }
  return raw.split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as AuditEntry]; } catch { return []; } });
}

export async function loadProposalEvents(dataDir: string): Promise<ProposalEvent[]> {
  let raw = "";
  try { raw = await readFile(proposalsPath(dataDir), "utf8"); } catch { return []; }
  return raw.split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as ProposalEvent]; } catch { return []; } });
}

export async function appendProposalEvent(dataDir: string, e: ProposalEvent): Promise<void> {
  await mkdir(path.dirname(proposalsPath(dataDir)), { recursive: true });
  await appendFile(proposalsPath(dataDir), JSON.stringify(e) + "\n");
}

export const SCAN_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "PAXGUSDT"];
export const SCAN_INTERVAL = "1d";
export type Signals = { price?: number; results?: Result[] } | null;

/** Scan today's signals and queue proposals. Writes only "proposed" events; it never touches the paper ledger. */
export async function scan(dataDir: string, getSignals: (symbol: string, interval: string) => Promise<Signals>, now = new Date()): Promise<Proposal[]> {
  return serial(async () => {
    const account = replay(await loadEvents(dataDir));
    const { usd } = proposalSize(account, now);
    let pending = replayProposals(await loadProposalEvents(dataDir), now);
    const added: Proposal[] = [];
    for (const symbol of SCAN_SYMBOLS) {
      const j = await getSignals(symbol, SCAN_INTERVAL).catch(() => null);
      if (!j || !(Number(j.price) > 0) || !j.results) continue;
      for (const p of proposalsFromSignals({ symbol, interval: SCAN_INTERVAL, price: Number(j.price), results: j.results, account, pending, usd }, now)) {
        await appendProposalEvent(dataDir, { type: "proposed", ...p });
        await appendAudit(dataDir, { at: p.at, id: p.id, symbol: p.symbol, side: p.side, action: "proposed", actor: "system:scan",
          data: p.evidence, reasoning: p.reasoning });
        added.push(p);
      }
      pending = replayProposals(await loadProposalEvents(dataDir), now);
    }
    return added;
  });
}

/** Ahmad tapped Approve: fill this one proposal on paper. The only code path that writes a fill from a proposal. */
export async function approveAndRecord(dataDir: string, id: string, getPrice: (symbol: string) => Promise<number>, by: string,
  now = new Date()): Promise<Fill> {
  return serial(async () => {
    const row = replayProposals(await loadProposalEvents(dataDir), now).find(r => r.id === id);
    const price = row ? await getPrice(row.symbol).catch(() => NaN) : NaN;
    const { fill, event } = approve(row, replay(await loadEvents(dataDir)), price, by, now);
    await appendEvent(dataDir, { type: "fill", ...fill });
    await appendProposalEvent(dataDir, event);
    await appendAudit(dataDir, { at: now.toISOString(), id: row!.id, symbol: row!.symbol, side: row!.side, action: "approved", actor: by,
      data: row!.evidence, reasoning: row!.reasoning, price_at_decision: price, fill_id: fill.id });
    return fill;
  });
}

/** Ahmad tapped Reject: record it with the same audit detail. Nothing is filled. */
export async function rejectAndRecord(dataDir: string, id: string, by: string, reason: unknown, now = new Date()): Promise<void> {
  await serial(async () => {
    const row = replayProposals(await loadProposalEvents(dataDir), now).find(r => r.id === id);
    const event = reject(row, by, reason, now);
    await appendProposalEvent(dataDir, event);
    await appendAudit(dataDir, { at: now.toISOString(), id: row!.id, symbol: row!.symbol, side: row!.side, action: "rejected", actor: by,
      data: row!.evidence, reasoning: row!.reasoning, reason: event.type === "rejected" ? event.reason : "" });
  });
}

/** Rank pending proposals for the briefing: best backtest edge over buy-and-hold first; no backtest goes last. */
export function topProposals(rows: Row[], n = 3): Row[] {
  const edge = (r: Row) => {
    const s = r.evidence.summary, a = Number(s.backtestReturnPct), b = Number(s.buyHoldPct);
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : -Infinity;
  };
  return rows.filter(r => r.status === "pending").sort((x, y) => edge(y) - edge(x) || y.at.localeCompare(x.at)).slice(0, n);
}

/** The daily briefing: top proposals with their numbers and raw-data links. A decision aid; nothing is executed. */
export function briefingText(rows: Row[], size: ReturnType<typeof proposalSize>, siteUrl: string, now = new Date()): string {
  const top = topProposals(rows);
  const link = (u: string) => (u.startsWith("/") ? siteUrl.replace(/\/$/, "") + u : u);
  const lines = [
    `# OMEGA paper briefing ${now.toISOString().slice(0, 10)}`, "",
    "Paper only. Nothing is recorded until you tap Approve on the Market screen.", "",
    `Buy size: ${size.usd} USDT (${size.closed} closed paper trades in 14 days${size.returnPct == null ? "" : `, ${size.returnPct}%`}).`, "",
  ];
  if (!top.length) lines.push("No proposals waiting today.");
  top.forEach((r, i) => {
    lines.push(`## ${i + 1}. ${r.side.toUpperCase()} ${r.symbol}${r.usd != null ? ` ${r.usd} USDT` : " (all held)"}`,
      `- Source: ${r.evidence.source} at ${r.evidence.observed_price}`,
      `- Numbers: ${Object.entries(r.evidence.summary).map(([k, v]) => `${k} ${v}`).join(", ")}`,
      `- Raw data: ${link(r.evidence.url)}`, "");
  });
  lines.push(`Approve or reject: ${siteUrl.replace(/\/$/, "")}/ar/market`);
  return lines.join("\n") + "\n";
}

export const briefingPath = (dataDir: string, now = new Date()) => path.join(dataDir, "paper", "briefings", `${now.toISOString().slice(0, 10)}.md`);

export async function writeBriefing(dataDir: string, text: string, now = new Date()): Promise<string> {
  const file = briefingPath(dataDir, now);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}
