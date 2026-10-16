// Daily paper scan (ADR-073). Run by the "OMEGA Paper Scan" scheduled task at 09:00 (Kuwait) through
// `phoenix.py paper-scan`, or by hand: npm run paper:scan
// Proposals only: it queues proposals, writes the briefing file and pushes one phone alert. It never records a fill;
// that happens only when Ahmad taps Approve on the Market screen.
import path from "node:path";
import { broadcast, loadStore } from "../src/lib/alerts.ts";
import { directorData } from "../src/lib/director.ts";
import { briefingEmail } from "../src/lib/mailer.ts";
import { loadEvents, replay } from "../src/lib/paper.ts";
import { briefingText, loadProposalEvents, proposalSize, replayProposals, scan, topProposals, writeBriefing } from "../src/lib/paper-proposals.ts";

const web = path.resolve(import.meta.dirname, "..");
process.chdir(web);                                    // directorData() resolves from the web folder
const data = directorData();
const site = process.env.OMEGA_SITE_URL ?? "http://127.0.0.1:3100";   // the local web app serves the signals

const added = await scan(data, async (symbol, interval) => {
  const r = await fetch(`${site}/api/strategies?symbol=${symbol}&interval=${interval}`, { signal: AbortSignal.timeout(30_000) });
  return r.ok ? r.json() : null;
});
const now = new Date();
const rows = replayProposals(await loadProposalEvents(data), now);
const size = proposalSize(replay(await loadEvents(data)), now);
const text = briefingText(rows, size, site, now);
const file = await writeBriefing(data, text, now);
const email = briefingEmail(text);              // placeholder: reports what it would do, sends nothing (ADR-075)
const top = topProposals(rows);

const push = path.join(data, "push"), store = await loadStore(push);
const note = { title: "OMEGA paper briefing", tag: "paper-briefing", url: "/ar/market",
  body: top.length ? top.map(r => `${r.side} ${r.symbol}`).join(" · ") + " (paper, waiting for your approval)" : "No paper proposals today." };
const sent = store.subs.length ? await broadcast(push, store, note) : { sent: 0, removed: 0 };
console.log(JSON.stringify({ added: added.length, pending: rows.filter(r => r.status === "pending").length, size, briefing: file, pushed: sent.sent, email: email.send ? "ready, not sent (sending not built yet)" : `off: ${email.reason}` }, null, 2));
