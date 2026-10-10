// Review (ADR-032): the judgement calls Ahmad signs off on, shown in the app with a fingerprint of their current
// contents. An approval is recorded against that fingerprint, so any later edit shows up as "changed since review".
import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

export const ITEMS = {
  sources: "services/truth/sources.json",       // Truth Layer source tiers (ADR-021)
  butterfly: "services/causal/assumptions.json", // Butterfly Engine scenario assumptions (ADR-022)
  restic: null,                                  // a manual step: the backup password is saved somewhere safe
} as const;
export type ItemId = keyof typeof ITEMS;
export type Approval = { hash: string; by: string; at: string };
export type ReviewItem = { id: ItemId; hash: string; content: unknown; approval: Approval | null; current: boolean };

export const fingerprint = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);

export async function loadItems(root: string, log: Record<string, Approval>): Promise<ReviewItem[]> {
  return Promise.all((Object.keys(ITEMS) as ItemId[]).map(async id => {
    const rel = ITEMS[id];
    const text = rel ? await readFile(path.join(root, rel), "utf8") : "manual";
    const hash = rel ? fingerprint(text) : "manual";
    const approval = log[id] ?? null;
    return { id, hash, content: rel ? JSON.parse(text) : null, approval, current: approval?.hash === hash };
  }));
}

export async function readLog(file: string): Promise<Record<string, Approval>> {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return {}; }
}

/** Record an approval only if the fingerprint the reviewer saw is still the current one. */
export async function approve(root: string, file: string, id: unknown, hash: unknown, by: string, now = new Date()): Promise<Approval> {
  if (typeof id !== "string" || !(id in ITEMS)) throw new Error("unknown review item");
  const items = await loadItems(root, {});
  const item = items.find(i => i.id === id)!;
  if (hash !== item.hash) throw new Error("this changed since you opened it; reload and review again");
  const log = await readLog(file);
  log[id] = { hash: item.hash, by, at: now.toISOString() };
  await writeFile(`${file}.tmp`, JSON.stringify(log, null, 2));
  await rename(`${file}.tmp`, file);
  return log[id];
}
