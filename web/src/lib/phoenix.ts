// Phoenix timeline helpers (ADR-020, ADR-024): turn raw phoenix_events rows into what the Company screen shows.
export type PhoenixEvent = { ts: string; service: string; action: string; result: string; detail: string };

/** Latest health per service (from detect/restart/restore/recover/backup rows) and the incidents worth showing. */
export function summarize(events: PhoenixEvent[]) {
  const newestFirst = [...events].sort((a, b) => b.ts.localeCompare(a.ts));
  const state: Record<string, { result: "ok" | "down"; ts: string; detail: string }> = {};
  for (const e of newestFirst) {
    if (e.service === "phoenix" || state[e.service]) continue;
    if (["detect", "restart", "restore", "recover", "backup"].includes(e.action))
      state[e.service] = { result: e.result === "ok" ? "ok" : "down", ts: e.ts, detail: e.detail };
  }
  const lastRun = newestFirst.find(e => e.service === "phoenix" && e.action === "heartbeat") ?? null;
  // Incidents: anything that was not a quiet "all good" (heartbeats and first-time ok detections are noise).
  const incidents = newestFirst.filter(e => e.action !== "heartbeat" && !(e.action === "detect" && e.result === "ok")).slice(0, 20);
  return { state, lastRun, incidents };
}
