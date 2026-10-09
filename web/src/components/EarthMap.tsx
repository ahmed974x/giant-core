"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoNode } from "@/lib/types";

// Free, keyless vector tiles (OpenFreeMap, OSM data): vectors stay razor-sharp at every zoom level.
const STYLE = "https://tiles.openfreemap.org/styles/dark";
// Sentinel-2 cloudless 2024 mosaic by EOX (10 m/pixel, native to z14, overzoomed beyond). CC BY-NC-SA 4.0.
const SATELLITE = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const SAT_ATTRIBUTION = '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless 2024 by EOX</a> (Copernicus Sentinel data)';
const COLOR: Record<string, string> = { strait: "#3dd6c6", canal: "#f2b84b", port: "#7aa2ff" };
const MAX_ZOOM = 19;

export type Basemap = "map" | "satellite";

export default function EarthMap({ nodes, focus, onFocus }: { nodes: GeoNode[]; focus: string | null; onFocus: (slug: string) => void }) {
  const t = useTranslations("earth");
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [zoom, setZoom] = useState(1.6);
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  useEffect(() => {
    let cancelled = false;
    let m: MlMap | null = null;
    import("maplibre-gl").then(({ Map, NavigationControl, FullscreenControl, ScaleControl, GlobeControl, setWorkerUrl }) => {
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      if (cancelled || !el.current) return;
      m = new Map({
        container: el.current, style: STYLE, center: [50, 20], zoom: 1.6, maxZoom: MAX_ZOOM, maxPitch: 75,
        // Render at least 2x (3x on dense phone screens) so labels and coastlines stay crisp when zoomed.
        pixelRatio: Math.min(Math.max(window.devicePixelRatio || 1, 2), 3),
        attributionControl: { compact: true },
      });
      m.addControl(new NavigationControl({ visualizePitch: true }), "top-left");
      m.addControl(new GlobeControl(), "top-left");
      m.addControl(new FullscreenControl(), "top-left");
      m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
      m.on("zoom", () => setZoom(m!.getZoom()));
      m.on("style.load", () => m!.setProjection({ type: "globe" }));
      m.on("load", () => {
        const mm = m!;
        // Satellite goes under the first label layer, so place names stay readable on top of the imagery.
        const firstSymbol = mm.getStyle().layers.find(l => l.type === "symbol")?.id;
        mm.addSource("satellite", { type: "raster", tiles: [SATELLITE], tileSize: 256, maxzoom: 14, attribution: SAT_ATTRIBUTION });
        mm.addLayer({ id: "satellite", type: "raster", source: "satellite", paint: { "raster-fade-duration": 150 } }, firstSymbol);

        mm.addSource("nodes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        mm.addLayer({ id: "nodes-halo", type: "circle", source: "nodes", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 12, 10, 26], "circle-color": ["get", "color"], "circle-opacity": 0.2 } });
        mm.addLayer({ id: "nodes", type: "circle", source: "nodes", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 5, 10, 9], "circle-color": ["get", "color"], "circle-stroke-width": 2, "circle-stroke-color": "#0a0f15" } });
        mm.addLayer({ id: "nodes-label", type: "symbol", source: "nodes",
          layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 2, 12, 10, 16], "text-offset": [0, 1.4], "text-anchor": "top" },
          paint: { "text-color": "#ffffff", "text-halo-color": "#0a0f15", "text-halo-width": 1.6 } });
        mm.on("click", "nodes", e => { const slug = e.features?.[0]?.properties?.slug; if (slug) onFocusRef.current(String(slug)); });
        mm.on("mouseenter", "nodes", () => { mm.getCanvas().style.cursor = "pointer"; });
        mm.on("mouseleave", "nodes", () => { mm.getCanvas().style.cursor = ""; });
        map.current = mm;
        setReady(true);
      });
    });
    return () => { cancelled = true; m?.remove(); map.current = null; setReady(false); };
  }, []);

  useEffect(() => {
    if (ready) map.current?.setLayoutProperty("satellite", "visibility", basemap === "satellite" ? "visible" : "none");
  }, [basemap, ready]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("nodes") as GeoJSONSource).setData({ type: "FeatureCollection", features: nodes.map(n => ({
      type: "Feature", geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      properties: { slug: n.slug, name: n.name, color: COLOR[n.node_type] ?? "#e6edf3" },
    })) });
  }, [nodes, ready]);

  useEffect(() => {
    const n = nodes.find(x => x.slug === focus);
    // Ports get a close-up; straits and canals need a wider frame to show both shores.
    if (n && ready && map.current) map.current.flyTo({ center: [n.lon, n.lat], zoom: n.node_type === "port" ? 12 : 9, pitch: 45, speed: 1.2, essential: true });
  }, [focus, nodes, ready]);

  const zoomBy = (d: number) => map.current?.easeTo({ zoom: Math.min(MAX_ZOOM, Math.max(0, zoom + d)), duration: 300 });

  return (
    <div className="relative">
      <div ref={el} className="h-[60dvh] min-h-[340px] w-full overflow-hidden rounded-[14px] lg:h-[calc(100dvh-170px)]" />
      {/* Physical right: the map canvas does not mirror in RTL, and MapLibre's own controls sit top-left. */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2" dir="ltr">
        <div className="flex overflow-hidden rounded-lg border border-line bg-[#0a0f15]/85 text-xs backdrop-blur" role="group" aria-label={t("basemap")}>
          {(["satellite", "map"] as const).map(b => (
            <button key={b} onClick={() => setBasemap(b)} aria-pressed={basemap === b}
              className={`px-3 py-1.5 ${basemap === b ? "bg-accent font-semibold text-[#0a0f15]" : "text-ink hover:bg-panel-2"}`}>
              {t(`layers.${b}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-[#0a0f15]/85 p-1 text-sm backdrop-blur">
          <button onClick={() => zoomBy(-1)} className="grid size-8 place-items-center rounded-md hover:bg-panel-2" aria-label={t("zoomOut")}>−</button>
          <span className="num w-14 text-center text-xs text-muted" dir="ltr">z {zoom.toFixed(1)}</span>
          <button onClick={() => zoomBy(1)} className="grid size-8 place-items-center rounded-md hover:bg-panel-2" aria-label={t("zoomIn")}>+</button>
        </div>
      </div>
    </div>
  );
}
