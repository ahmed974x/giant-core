// Awesome atlas (ADR-027): the sindresorhus/awesome index (CC0) parsed into a flat, searchable list of ~700 curated
// awesome-lists. Snapshot lives in web/data/awesome-atlas.json so search works offline; `npm run atlas:sync` refreshes it.
// Plain TypeScript (erasable syntax only) so the MCP server in mcp/awesome-atlas can import it with Node directly.

export type Entry = { name: string; url: string; desc: string; category: string; parent: string };
export type Atlas = { source: string; fetchedAt: string; categories: string[]; entries: Entry[] };

export const SOURCE = "https://raw.githubusercontent.com/sindresorhus/awesome/main/readme.md";
const SKIP = new Set(["Contents"]);
const ITEM = /^(\s*)- (?:\[([^\]]+)\]\(([^)\s]+)\))?\s*([^\n]*)$/;

/** README markdown -> entries. Nested items keep their parent's name; link-less items ("- Linux") become parents only. */
export function parseAwesome(md: string, fetchedAt = new Date().toISOString()): Atlas {
  const entries: Entry[] = [], categories: string[] = [];
  let category = "", top = "";
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^## (.+)$/);
    if (h) { category = SKIP.has(h[1].trim()) ? "" : h[1].trim(); if (category) categories.push(category); top = ""; continue; }
    if (!category) continue;
    const m = line.match(ITEM);
    if (!m) continue;
    const nested = m[1].replace(/\t/g, "    ").length >= 2;
    const [, , name, url, rest] = m;
    if (!name) { if (!nested) top = rest.trim(); continue; }
    if (!/^https?:\/\//.test(url)) continue;
    const desc = rest.replace(/^-\s*/, "").trim();
    entries.push({ name: name.trim(), url, desc, category, parent: nested ? top : "" });
    if (!nested) top = name.trim();
  }
  return { source: SOURCE, fetchedAt, categories: categories.filter(c => entries.some(e => e.category === c)), entries };
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Ranked search: every word must match somewhere; name hits beat parent/category hits beat description hits. */
export function searchAtlas(atlas: Atlas, query: string, opts: { category?: string; limit?: number } = {}): Entry[] {
  const words = norm(query).split(/[^\p{L}\p{N}+#.]+/u).filter(w => w.length > 0);
  const pool = opts.category ? atlas.entries.filter(e => e.category === opts.category) : atlas.entries;
  const limit = Math.max(1, Math.min(opts.limit ?? 30, 200));
  if (!words.length) return pool.slice(0, limit);
  const scored: { e: Entry; s: number }[] = [];
  for (const e of pool) {
    const name = norm(e.name), ctx = norm(`${e.parent} ${e.category}`), desc = norm(e.desc);
    let s = 0;
    for (const w of words) {
      const ws = name === w ? 12 : name.startsWith(w) ? 8 : name.includes(w) ? 5 : ctx.includes(w) ? 3 : desc.includes(w) ? 1 : 0;
      if (!ws) { s = 0; break; }
      s += ws;
    }
    if (s) scored.push({ e, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name)).slice(0, limit).map(x => x.e);
}
