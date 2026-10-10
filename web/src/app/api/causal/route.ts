// Butterfly Engine bridge. GET returns the latest causal trace (services/causal/out/butterfly/latest.json);
// POST runs a new trace with allow-listed arguments only (no shell, fixed script, 120 s cap). Read-only analysis.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CAUSAL = process.env.OMEGA_CAUSAL_DIR ?? path.resolve(/* turbopackIgnore: true */ process.cwd(), "..", "services", "causal");
const PYTHON = process.env.OMEGA_CAUSAL_PYTHON ?? path.join(CAUSAL, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const TYPES = new Set(["price_spike", "ship_deviation", "port_congestion", "oil_move"]);
const ASSETS = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "PAXGUSDT"]);
const PLACES: Record<string, [number, number]> = {
  hormuz: [26.57, 56.25], suez: [30.6, 32.35], "bab-el-mandeb": [12.58, 43.33], malacca: [2.5, 100.4], panama: [9.08, -79.68], "jebel-ali": [24.98, 55.03],
};
let running = false;

async function latest() {
  return JSON.parse(await readFile(path.join(CAUSAL, "out", "butterfly", "latest.json"), "utf8"));
}

export async function GET() {
  try {
    return Response.json(await latest(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "no trace yet" }, { status: 404 });
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { if (origin && new URL(origin).host !== host) return Response.json({ error: "forbidden" }, { status: 403 }); }
  catch { return Response.json({ error: "forbidden" }, { status: 403 }); }
  if (running) return Response.json({ error: "a trace is already running" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { type?: string; asset?: string; place?: string };
  const type = body.type ?? "price_spike";
  if (!TYPES.has(type) || (type === "price_spike" && !ASSETS.has(body.asset ?? "PAXGUSDT")) || (body.place && !PLACES[body.place]))
    return Response.json({ error: "unsupported anomaly" }, { status: 400 });

  const args = ["butterfly_engine.py", "--type", type];
  if (type === "price_spike") args.push("--asset", body.asset ?? "PAXGUSDT");
  if (body.place) args.push("--lat", String(PLACES[body.place][0]), "--lon", String(PLACES[body.place][1]));

  running = true;
  try {
    await new Promise<void>((resolve, reject) =>
      execFile(PYTHON, args, { cwd: CAUSAL, timeout: 120_000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
        err => (err ? reject(err) : resolve())));
    return Response.json(await latest());
  } catch {
    return Response.json({ error: "Butterfly Engine failed or is not installed (services/causal/.venv)" }, { status: 503 });
  } finally {
    running = false;
  }
}

export const dynamic = "force-dynamic";
