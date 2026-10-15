"use client";
// One shared pulse for the header bell and the Command Center status bar: pending approvals, Director 00 and
// memory counts from System Health, Phoenix's latest state. Polled every 30 s and shared across components.
import { useEffect, useState } from "react";

export type Pulse = {
  pending: number; escalated: number; memories: number | null; director: string; phoenix: "ok" | "down" | "unknown";
  checks: Record<string, { state: string; detail?: string }>; at: number;
};

const EMPTY: Pulse = { pending: 0, escalated: 0, memories: null, director: "unknown", phoenix: "unknown", checks: {}, at: 0 };
let current = EMPTY, timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(p: Pulse) => void>();

async function poll() {
  const get = (u: string) => fetch(u, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [inbox, health, phoenix] = await Promise.all([get("/api/director"), get("/api/health"), get("/api/phoenix")]);
  const pending = (inbox?.pending ?? []) as { status: string }[];
  const detail: string = health?.checks?.director?.detail ?? "";
  const states = Object.values((phoenix?.state ?? {}) as Record<string, { result: string }>).map(s => s.result);
  current = {
    pending: pending.length, escalated: pending.filter(p => p.status === "escalated").length,
    memories: /(\d+) memories/.test(detail) ? Number(detail.match(/(\d+) memories/)![1]) : null,
    director: health?.checks?.director?.state ?? "unknown",
    phoenix: !states.length ? "unknown" : states.every(s => s === "ok") ? "ok" : "down",
    checks: health?.checks ?? {}, at: Date.now(),
  };
  listeners.forEach(l => l(current));
}

export function usePulse(): Pulse {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    if (!timer) { poll(); timer = setInterval(poll, 30_000); }
    else setP(current);
    return () => { listeners.delete(setP); if (!listeners.size && timer) { clearInterval(timer); timer = null; } };
  }, []);
  return p;
}

export const refreshPulse = () => poll();
