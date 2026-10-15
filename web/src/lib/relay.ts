"use client";
import { useEffect, useState } from "react";
import { DEMO_HELLO } from "./demo";
import type { Anomaly, Hello, NewsItem, Pulse, Status } from "./types";

export async function relayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/relay/${path}`, { cache: "no-store", ...init });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
}

export type LiveState = {
  connected: boolean;
  demo: boolean;
  status: Status;
  pulse: Pulse | null;
  anomalies: Anomaly[];
  news: NewsItem[];
  symbols: string[];
};

const KEEP = 50;

/** One SSE connection to the relay's /events; falls back to labelled demo data while offline. */
export function useLive(): LiveState {
  const [s, set] = useState<LiveState>({
    connected: false, demo: false, status: DEMO_HELLO.status, pulse: null, anomalies: [], news: [], symbols: [],
  });

  useEffect(() => {
    const es = new EventSource("/relay/events");
    const offline = setTimeout(() => set(p => (p.connected ? p : {
      ...p, demo: true, anomalies: DEMO_HELLO.recent, symbols: DEMO_HELLO.symbols,
    })), 4000);
    const parse = <T,>(e: MessageEvent): T | null => { try { return JSON.parse(e.data) as T; } catch { return null; } };

    es.addEventListener("hello", e => {
      const h = parse<Hello>(e as MessageEvent);
      if (!h) return;
      set({ connected: true, demo: false, status: h.status, pulse: h.pulse, anomalies: [...h.recent].reverse(), news: h.news, symbols: h.symbols });
    });
    es.addEventListener("status", e => { const v = parse<Status>(e as MessageEvent); if (v) set(p => ({ ...p, status: v })); });
    es.addEventListener("pulse", e => { const v = parse<Pulse>(e as MessageEvent); if (v) set(p => ({ ...p, pulse: v })); });
    es.addEventListener("anomaly", e => {
      const v = parse<Anomaly>(e as MessageEvent);
      if (v) set(p => ({ ...p, anomalies: [v, ...p.anomalies.filter(a => a.id !== v.id)].slice(0, KEEP) }));
    });
    es.addEventListener("news", e => {
      const v = parse<{ items: NewsItem[] }>(e as MessageEvent);
      if (v) set(p => ({ ...p, news: [...v.items, ...p.news.filter(n => !v.items.some(i => i.id === n.id))].slice(0, KEEP) }));
    });
    es.onerror = () => set(p => ({ ...p, connected: false }));
    return () => { clearTimeout(offline); es.close(); };
  }, []);

  return s;
}
