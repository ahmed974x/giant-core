// Awesome atlas search (ADR-027): read-only, served from the bundled snapshot, works offline.
import data from "../../../../data/awesome-atlas.json";
import { searchAtlas, type Atlas } from "@/lib/awesome";

const atlas = data as Atlas;

export function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").slice(0, 120);
  const cat = p.get("cat") ?? "";
  const category = atlas.categories.includes(cat) ? cat : undefined;
  const results = searchAtlas(atlas, q, { category, limit: Number(p.get("limit")) || 40 });
  return Response.json({ fetchedAt: atlas.fetchedAt, total: atlas.entries.length, categories: atlas.categories, results },
    { headers: { "Cache-Control": "public, max-age=300" } });
}
