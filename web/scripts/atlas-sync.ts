// Refresh web/data/awesome-atlas.json from the sindresorhus/awesome README (CC0). Run: npm run atlas:sync
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseAwesome, SOURCE } from "../src/lib/awesome.ts";

const r = await fetch(SOURCE, { signal: AbortSignal.timeout(20_000) });
if (!r.ok) throw new Error(`README fetch failed: ${r.status}`);
const atlas = parseAwesome(await r.text());
if (atlas.entries.length < 300) throw new Error(`only ${atlas.entries.length} entries parsed; README format changed?`);
const out = path.join(import.meta.dirname, "..", "data", "awesome-atlas.json");
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(atlas) + "\n");
console.log(`${atlas.entries.length} lists in ${atlas.categories.length} categories -> ${out}`);
