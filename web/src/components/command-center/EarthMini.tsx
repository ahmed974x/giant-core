"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE = "https://tiles.openfreemap.org/styles/dark";
const HOME = { lat: 29.3, lon: 47.9 }; // the Gulf: where the planes are fetched around

type Counts = { planes: number; ships: number | null; events: number; hazards: number };

/** A small live 3D globe that slowly turns: world events (purple), hazards (orange), planes over the Gulf (cyan),
 *  ships when AIS is configured (green). Not interactive; the card opens the full Earth screen. */
export default function EarthMini({ onCounts }: { onCounts?: (c: Counts) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: MlMap | null = null, raf = 0, cancelled = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("maplibre-gl").then(async ml => {
      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      if (cancelled || !el.current) return;
      try {
        map = new ml.Map({ container: el.current, style: STYLE, center: [HOME.lon, 22], zoom: 0.9, interactive: false, attributionControl: false, pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
      } catch { setFailed(true); return; }
      map.on("webglcontextlost", () => setFailed(true));
      const get = (u: string) => fetch(u, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
      const [ev, hz, fl, sh] = await Promise.all([get("/api/events"), get("/api/hazards"), get(`/api/flights?lat=${HOME.lat}&lon=${HOME.lon}`), get(`/api/ships?lat=${HOME.lat}&lon=${HOME.lon}`)]);
      const pts = (list: { lat: number; lon: number }[] | undefined, kind: string) => (list ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
        .map(p => ({ type: "Feature" as const, properties: { kind }, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] } }));
      const features = [...pts(ev?.events, "event"), ...pts(hz?.hazards, "hazard"), ...pts(fl?.flights, "plane"), ...pts(sh?.ships, "ship")];
      onCounts?.({ planes: fl?.flights?.length ?? 0, ships: sh?.configured === false ? null : (sh?.ships?.length ?? 0), events: ev?.events?.length ?? 0, hazards: hz?.hazards?.length ?? 0 });
      const ready = () => {
        if (!map || cancelled) return;
        try { map.setProjection({ type: "globe" }); } catch { /* older style spec: flat map is fine */ }
        map.addSource("live", { type: "geojson", data: { type: "FeatureCollection", features } });
        map.addLayer({ id: "live-glow", type: "circle", source: "live", paint: {
          "circle-radius": 6, "circle-blur": 1, "circle-opacity": 0.5,
          "circle-color": ["match", ["get", "kind"], "event", "#A855F7", "hazard", "#F97316", "plane", "#06B6D4", "#10B981"] } });
        map.addLayer({ id: "live-dot", type: "circle", source: "live", paint: {
          "circle-radius": 2.2, "circle-color": ["match", ["get", "kind"], "event", "#C4B5FD", "hazard", "#FDBA74", "plane", "#67E8F9", "#6EE7B7"] } });
        if (still) return;
        let lon = HOME.lon, last = performance.now();
        const spin = (t: number) => {   // ~6 degrees a second, paused while the tab is hidden
          if (!map) return;
          if (!document.hidden) { lon += ((t - last) / 1000) * 6; map.setCenter([((lon + 180) % 360) - 180, 22]); }
          last = t; raf = requestAnimationFrame(spin);
        };
        raf = requestAnimationFrame(spin);
      };
      if (map.isStyleLoaded()) ready(); else map.once("load", ready);
    });
    return () => { cancelled = true; cancelAnimationFrame(raf); map?.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return failed
    ? <div className="grid size-full place-items-center text-xs text-muted">3D</div>
    : <div ref={el} className="size-full [&_.maplibregl-canvas]:outline-none" aria-hidden />;
}
