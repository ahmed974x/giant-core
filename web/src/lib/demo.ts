// Shown only when the relay is offline, and always labelled as demo in the UI.
import type { GeoNode, Hello } from "./types";

const now = new Date().toISOString();

export const DEMO_NODES: Record<"ar" | "en", GeoNode[]> = (() => {
  const seed = [
    ["hormuz", "strait", "Strait of Hormuz", "مضيق هرمز", 56.25, 26.57],
    ["suez", "canal", "Suez Canal", "قناة السويس", 32.35, 30.6],
    ["bab-el-mandeb", "strait", "Bab-el-Mandeb", "باب المندب", 43.33, 12.58],
    ["malacca", "strait", "Strait of Malacca", "مضيق ملقا", 100.4, 2.5],
    ["panama", "canal", "Panama Canal", "قناة بنما", -79.68, 9.08],
    ["jebel-ali", "port", "Port of Jebel Ali", "ميناء جبل علي", 55.03, 24.98],
  ] as const;
  const make = (ar: boolean) => seed.map(([slug, node_type, en, arName, lon, lat]) =>
    ({ slug, node_type, status: "operational", name: ar ? arName : en, lon, lat }));
  return { ar: make(true), en: make(false) };
})();

export const DEMO_HELLO: Hello = {
  recent: [
    { id: 1, ts: now, symbol: "BTCUSDT", kind: "volume_spike", severity: "watch", price: 0, value: 0, baseline: null, zscore: 3.1, reason: "demo: volume 3.1σ above the hourly baseline" },
  ],
  news: [],
  whales: [],
  pulse: null,
  status: { relay: "down", n8n: "unknown", postgrest: "unknown", timescale: "unknown", cortex: "unknown", checkedAt: null },
  symbols: ["BTCUSDT", "ETHUSDT"],
};
