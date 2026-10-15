export type Status = Record<string, string | null> & { checkedAt: string | null };
export type Price = { symbol: string; close: number; ts: string };
export type Pulse = { symbols: Price[]; stored: number; anomalies: number; at: string };
export type Anomaly = {
  id: number; ts: string; symbol: string; kind: string; severity: "watch" | "high";
  price: number; value: number; baseline: number | null; zscore: number | null; reason: string;
};
export type NewsItem = { id: string; title: string; published_at: string; sentiment: number; relevance?: number; source?: string; url?: string };
export type GeoNode = { slug: string; node_type: string; status: string; name: string; description?: string; lon: number; lat: number };
export type Hello = { recent: Anomaly[]; news: NewsItem[]; whales: unknown[]; pulse: Pulse | null; status: Status; symbols: string[] };
export type BrainStep = { agent: string; title: string; role: string; status: string; output: unknown; ms: number | null };
export type BrainJob = { id: string; status: string; request: string; intent: string | null; answer: unknown; steps: BrainStep[] };
