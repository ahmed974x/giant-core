// Phone alerts (ADR-035): which events become a push notification, the subscription store, and the watcher that
// checks Director 00's ledger and Phoenix's log every minute. Everything lives in Director 00's data folder.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { newVapid, sendPush, vapidMatches, type Note, type Subscription, type Vapid } from "./webpush.ts";

export type Store = { vapid: Vapid; subs: Subscription[]; state: { proposalAt: string; phoenixId: number } };
type Proposal = { thread_id: string; request: string; status: string; created_at: string };
type PhoenixRow = { id: number; ts: string; service: string; action: string; result: string; detail: string };

const SUBJECT = "https://omega-prime.local/alerts"; // VAPID contact; deliberately not a personal address

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return fallback; }
}
async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2));
  await rename(`${file}.tmp`, file);
}

export async function loadStore(dir: string): Promise<Store> {
  let vapid = await readJson<Vapid | null>(path.join(dir, "vapid.json"), null);
  if (!vapid || !vapidMatches(vapid)) { vapid = newVapid(); await writeJson(path.join(dir, "vapid.json"), vapid); }
  return {
    vapid,
    subs: await readJson<Subscription[]>(path.join(dir, "subscriptions.json"), []),
    state: await readJson(path.join(dir, "state.json"), { proposalAt: new Date().toISOString().slice(0, 19) + "Z", phoenixId: -1 }),
  };
}
export const saveSubs = (dir: string, subs: Subscription[]) => writeJson(path.join(dir, "subscriptions.json"), subs.slice(-10));
export const saveState = (dir: string, state: Store["state"]) => writeJson(path.join(dir, "state.json"), state);

/** New proposals and Phoenix incidents since the last check, as notifications (at most 5 per check). */
export function pendingAlerts(proposals: Proposal[], phoenix: PhoenixRow[], state: Store["state"]): { notes: Note[]; state: Store["state"] } {
  const notes: Note[] = [];
  const fresh = proposals.filter(p => p.created_at > state.proposalAt && (p.status === "pending" || p.status === "escalated"));
  for (const p of fresh) notes.push({
    title: p.status === "escalated" ? "Director 00 · high risk, needs your phrase" : "Director 00 · approval waiting",
    body: p.request.replace(/^remember:\s*/i, "").slice(0, 140), url: "/ar#inbox", tag: `proposal-${p.thread_id}`,
  });
  // Phoenix's first run only sets the bookmark, so an existing history doesn't flood the phone.
  const incidents = state.phoenixId < 0 ? [] : phoenix.filter(e => e.id > state.phoenixId && (e.action !== "heartbeat" || e.result !== "ok"));
  for (const e of incidents) notes.push({
    title: `Phoenix · ${e.service} ${e.action}${e.result === "ok" ? "" : ` (${e.result})`}`, body: e.detail.slice(0, 140), url: "/ar", tag: `phoenix-${e.id}`,
  });
  return {
    notes: notes.slice(0, 5),
    state: {
      proposalAt: proposals.reduce((m, p) => (p.created_at > m ? p.created_at : m), state.proposalAt),
      phoenixId: phoenix.reduce((m, e) => Math.max(m, e.id), state.phoenixId < 0 ? 0 : state.phoenixId),
    },
  };
}

/** Send to every subscription; drop the ones the push service says are gone. */
export async function broadcast(dir: string, store: Store, note: Note, f: typeof fetch = fetch): Promise<{ sent: number; removed: number }> {
  let sent = 0;
  const keep: Subscription[] = [];
  for (const s of store.subs) {
    try {
      const status = await sendPush(s, note, store.vapid, SUBJECT, f);
      if (status === 404 || status === 410) continue;
      if (status < 300) sent++;
      keep.push(s);
    } catch { keep.push(s); }
  }
  const removed = store.subs.length - keep.length;
  if (removed) { store.subs = keep; await saveSubs(dir, keep); }
  return { sent, removed };
}

/** One watcher pass: read the ledgers, notify, move the bookmarks. */
export async function checkOnce(dataDir: string, f: typeof fetch = fetch): Promise<number> {
  const dir = path.join(dataDir, "push"), store = await loadStore(dir);
  const { DatabaseSync } = await import("node:sqlite");
  const read = <T,>(file: string, sql: string): T[] => {
    try { const db = new DatabaseSync(path.join(dataDir, file), { readOnly: true }); try { return db.prepare(sql).all() as T[]; } finally { db.close(); } }
    catch { return []; }
  };
  const proposals = read<Proposal>("director.sqlite", "SELECT thread_id, request, status, created_at FROM director_approvals ORDER BY created_at DESC LIMIT 50");
  const phoenix = read<PhoenixRow>("phoenix.sqlite", "SELECT id, ts, service, action, result, detail FROM phoenix_events ORDER BY id DESC LIMIT 50");
  const { notes, state } = pendingAlerts(proposals, phoenix, store.state);
  if (store.subs.length) for (const n of notes) await broadcast(dir, store, n, f);
  if (JSON.stringify(state) !== JSON.stringify(store.state)) await saveState(dir, state);
  return notes.length;
}
