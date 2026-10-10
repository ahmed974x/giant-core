// Morning briefing entry point (ADR-037). Run by the "OMEGA Morning Briefing" scheduled task at 07:00 through
// `phoenix.py briefing` (so no console window opens), or by hand: npm run briefing
import path from "node:path";
import { broadcast, loadStore } from "../src/lib/alerts.ts";
import { morningBriefing } from "../src/lib/briefing.ts";
import { directorData, directorDir, runDirector } from "../src/lib/director.ts";

const web = path.resolve(import.meta.dirname, "..");
process.chdir(web);                                    // directorDir() resolves from the web folder
const data = directorData();
const rules = path.resolve(directorDir(), "..", "sweeper", "rules.json");

const result = await morningBriefing(data, rules, { runDirector: args => runDirector(args) });
const push = path.join(data, "push"), store = await loadStore(push);
const sent = store.subs.length ? await broadcast(push, store, result.note) : { sent: 0, removed: 0 };
console.log(JSON.stringify({ ...result, pushed: sent.sent }, null, 2));
