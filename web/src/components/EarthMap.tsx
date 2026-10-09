"use client";
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoNode } from "@/lib/types";

// Free, keyless vector tiles (OpenFreeMap, OSM data). The engine is loaded lazily so other screens stay light.
const STYLE = "https://tiles.openfreemap.org/styles/dark";
const COLOR: Record<string, string> = { strait: "#3dd6c6", canal: "#f2b84b", port: "#7aa2ff" };

export default function EarthMap({ nodes, focus }: { nodes: GeoNode[]; focus: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl").then(({ Map, NavigationControl, setWorkerUrl }) => {
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      if (cancelled || !el.current) return;
      const m = new Map({ container: el.current, style: STYLE, center: [50, 20], zoom: 1.6, attributionControl: { compact: true } });
      m.addControl(new NavigationControl({ showCompass: false }), "top-left");
      m.on("load", () => {
        m.addSource("nodes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "nodes-halo", type: "circle", source: "nodes", paint: { "circle-radius": 14, "circle-color": ["get", "color"], "circle-opacity": 0.18 } });
        m.addLayer({ id: "nodes", type: "circle", source: "nodes", paint: { "circle-radius": 5, "circle-color": ["get", "color"], "circle-stroke-width": 1.5, "circle-stroke-color": "#0a0f15" } });
        m.addLayer({ id: "nodes-label", type: "symbol", source: "nodes",
          layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top" },
          paint: { "text-color": "#e6edf3", "text-halo-color": "#0a0f15", "text-halo-width": 1.2 } });
        map.current = m;
        setReady(true);
      });
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("nodes") as GeoJSONSource).setData({ type: "FeatureCollection", features: nodes.map(n => ({
      type: "Feature", geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      properties: { name: n.name, color: COLOR[n.node_type] ?? "#e6edf3" },
    })) });
  }, [nodes, ready]);

  useEffect(() => {
    const n = nodes.find(x => x.slug === focus);
    if (n && ready && map.current) map.current.flyTo({ center: [n.lon, n.lat], zoom: 5, speed: 1.4 });
  }, [focus, nodes, ready]);

  return <div ref={el} className="h-[55dvh] min-h-[320px] w-full overflow-hidden rounded-[14px] lg:h-[calc(100dvh-170px)]" />;
}
