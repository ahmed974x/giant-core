"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, Marker as MlMarker, Popup as MlPopup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { nightPolygon } from "@/lib/sun";
import type { GeoNode } from "@/lib/types";

// Free, keyless vector tiles (OpenFreeMap, OSM data): vectors stay razor-sharp at every zoom level.
const STYLE = "https://tiles.openfreemap.org/styles/dark";
// Sentinel-2 cloudless 2024 mosaic by EOX (10 m/pixel, native to z14). CC BY-NC-SA 4.0.
const SATELLITE = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const SAT_ATTRIBUTION = '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless 2024 by EOX</a> (Copernicus Sentinel data)';
// Global elevation (Mapzen Terrarium on the AWS open-data registry) for real 3D relief.
const TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TERRAIN_ATTRIBUTION = '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles (Mapzen, AWS Open Data)</a>';
const COLOR: Record<string, string> = { strait: "#3dd6c6", canal: "#f2b84b", port: "#7aa2ff" };
const MAX_ZOOM = 19;
const EMPTY = { type: "FeatureCollection" as const, features: [] };

export type Layer = "flights" | "ships" | "cams" | "hazards" | "events" | "gkg";
export type FeedMeta = Record<string, unknown>;
export type FeedItem = { id: string; lat: number; lon: number; label: string; sub?: string | null; image?: string | null; url?: string | null; heading?: number; kind?: string;
  truth?: { score: number; status: string; flags: string[] } };
export type MapTarget = { lon: number; lat: number; zoom: number; seq: number };
type Feed = { on: boolean; count: number | null; state: "idle" | "loading" | "live" | "stale" | "nokey" | "error" };
type Basemap = "satellite" | "map";
type Hit = { features?: { properties: Record<string, unknown> }[]; lngLat: { lng: number; lat: number } };

/** Draws a small white silhouette that MapLibre tints per layer (SDF icon). */
function icon(draw: (c: CanvasRenderingContext2D) => void, size = 48) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#fff";
  draw(c);
  return c.getImageData(0, 0, size, size);
}
const PLANE = (c: CanvasRenderingContext2D) => {
  c.beginPath();
  c.moveTo(24, 2); c.lineTo(28, 18); c.lineTo(46, 28); c.lineTo(46, 32); c.lineTo(28, 27); c.lineTo(27, 39);
  c.lineTo(33, 44); c.lineTo(33, 46); c.lineTo(24, 43); c.lineTo(15, 46); c.lineTo(15, 44); c.lineTo(21, 39);
  c.lineTo(20, 27); c.lineTo(2, 32); c.lineTo(2, 28); c.lineTo(20, 18); c.closePath(); c.fill();
};
const SHIP = (c: CanvasRenderingContext2D) => {
  c.beginPath(); c.moveTo(24, 3); c.lineTo(34, 18); c.lineTo(32, 45); c.lineTo(16, 45); c.lineTo(14, 18); c.closePath(); c.fill();
};
const CAM = (c: CanvasRenderingContext2D) => {
  c.beginPath(); c.roundRect(6, 14, 28, 22, 4); c.fill();
  c.beginPath(); c.moveTo(34, 21); c.lineTo(44, 15); c.lineTo(44, 35); c.lineTo(34, 29); c.closePath(); c.fill();
};

/** Popup body built from DOM nodes (never innerHTML), since titles come from public feeds. */
function card(title: string, rows: [string, string | null | undefined][], img?: string | null, link?: string | null) {
  const root = document.createElement("div");
  root.className = "omega-pop";
  if (img) { const i = document.createElement("img"); i.src = img; i.alt = ""; i.referrerPolicy = "no-referrer"; root.append(i); }
  const h = document.createElement("strong"); h.textContent = title; root.append(h);
  for (const [k, v] of rows) {
    if (v == null || v === "") continue;
    const p = document.createElement("div"); const s = document.createElement("span"); s.textContent = k;
    p.append(s, document.createTextNode(` ${v}`)); root.append(p);
  }
  if (link && /^https:\/\//.test(link)) { const a = document.createElement("a"); a.href = link; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "↗"; root.append(a); }
  return root;
}

const wrapLon = (lon: number) => ((lon + 540) % 360) - 180;

function viewQuery(m: MlMap) {
  const c = m.getCenter(), ne = m.getBounds().getNorthEast();
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(ne.lat - c.lat) / 2) ** 2 + Math.cos(r(c.lat)) * Math.cos(r(ne.lat)) * Math.sin(r(ne.lng - c.lng) / 2) ** 2;
  const km = Math.round(12742 * Math.asin(Math.min(1, Math.sqrt(a))));
  return `lat=${c.lat.toFixed(2)}&lon=${wrapLon(c.lng).toFixed(2)}&km=${km}`;
}

export default function EarthMap({ nodes, focus, onFocus, target, onFeed, eventKinds }: {
  nodes: GeoNode[]; focus: string | null; onFocus: (slug: string) => void;
  target?: MapTarget | null; onFeed?: (layer: Layer, items: FeedItem[], meta?: FeedMeta) => void;
  eventKinds?: string[];   // event categories to show; undefined = all
}) {
  const t = useTranslations("earth");
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const popup = useRef<MlPopup | null>(null);
  const meMarker = useRef<MlMarker | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [terrain, setTerrain] = useState(true);
  const [zoom, setZoom] = useState(1.6);
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);
  const [me, setMe] = useState<{ lat: number; lon: number; acc: number } | "locating" | "denied" | null>(null);
  // Collapsed on phones so the globe gets the screen; one tap opens it.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640);
  const [feeds, setFeeds] = useState<Record<Layer, Feed>>({
    flights: { on: true, count: null, state: "idle" },
    ships: { on: true, count: null, state: "idle" },
    cams: { on: true, count: null, state: "idle" },
    hazards: { on: true, count: null, state: "idle" },
    events: { on: true, count: null, state: "idle" },
    gkg: { on: true, count: null, state: "idle" },
  });
  const feedsRef = useRef(feeds);
  feedsRef.current = feeds;
  const [glFailed, setGlFailed] = useState(false);
  const [night, setNight] = useState(true);
  const [spin, setSpin] = useState(true);
  const [ar, setAr] = useState<"off" | "on" | "denied">("off");
  const [canAr, setCanAr] = useState(false);
  const trails = useRef(new Map<string, { pts: [number, number][]; seen: number }>());
  const tick = useRef(0);
  const onFeedRef = useRef(onFeed);
  onFeedRef.current = onFeed;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  const patch = (l: Layer, p: Partial<Feed>) => setFeeds(f => ({ ...f, [l]: { ...f[l], ...p } }));

  // ---- map bootstrap -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let m: MlMap | null = null;
    import("maplibre-gl").then(ml => {
      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      if (cancelled || !el.current) return;
      lib.current = ml;
      try {
        m = new ml.Map({
          container: el.current, style: STYLE, center: [50, 22], zoom: 1.6, maxZoom: MAX_ZOOM, maxPitch: 80,
          // Render at 2x everywhere so labels and coastlines stay crisp; 3x on phones cost too much GPU for little gain.
          pixelRatio: 2,
          attributionControl: { compact: true },
          // Keep the camera in the URL (#zoom/lat/lon/bearing/pitch) so any view can be bookmarked or shared.
          hash: true,
        });
      } catch {
        // No WebGL2 (old browser, or the GPU was reset): say so instead of leaving a blank box.
        setGlFailed(true);
        return;
      }
      m.on("webglcontextlost", () => setGlFailed(true));
      m.on("webglcontextrestored", () => setGlFailed(false));
      m.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-left");
      m.addControl(new ml.GlobeControl(), "top-left");
      m.addControl(new ml.FullscreenControl(), "top-left");
      m.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-left");
      setZoom(m.getZoom()); // the URL hash may have opened the map at another zoom
      m.on("zoom", () => setZoom(m!.getZoom()));
      m.on("mousemove", e => setCursor({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
      m.on("style.load", () => {
        m!.setProjection({ type: "globe" });
        m!.setSky({ "sky-color": "#06101c", "horizon-color": "#1b3a5a", "fog-color": "#0a1622", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 0.6, 12, 0] });
      });
      m.on("load", () => {
        const mm = m!;
        const firstSymbol = mm.getStyle().layers.find(l => l.type === "symbol")?.id;
        mm.addSource("satellite", { type: "raster", tiles: [SATELLITE], tileSize: 256, maxzoom: 14, attribution: SAT_ATTRIBUTION });
        mm.addLayer({ id: "satellite", type: "raster", source: "satellite", paint: { "raster-fade-duration": 150 } }, firstSymbol);
        mm.addSource("dem", { type: "raster-dem", tiles: [TERRAIN], tileSize: 256, maxzoom: 14, encoding: "terrarium", attribution: TERRAIN_ATTRIBUTION });
        mm.addLayer({ id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#000" } }, firstSymbol);

        for (const [name, draw] of [["plane", PLANE], ["ship", SHIP], ["cam", CAM]] as const) mm.addImage(name, icon(draw), { sdf: true, pixelRatio: 2 });
        for (const s of ["nodes", "flights", "trails", "ships", "cams", "hazards", "events", "gkg", "me-acc", "night"]) mm.addSource(s, { type: "geojson", data: EMPTY });

        // Live day/night shading: the half of the planet in darkness right now.
        mm.addLayer({ id: "night", type: "fill", source: "night", paint: { "fill-color": "#000814", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.45, 6, 0.25, 9, 0] } }, firstSymbol);
        // Real 3D buildings from OpenStreetMap heights once you are close enough to see streets.
        mm.addLayer({ id: "buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14,
          paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 6], 0, "#1d2b3a", 60, "#2f4a66", 200, "#4f7aa6"],
            "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5, ["coalesce", ["get", "render_height"], 6]],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.88 } });
        mm.addLayer({ id: "me-acc", type: "fill", source: "me-acc", paint: { "fill-color": "#ff3b6b", "fill-opacity": 0.12 } });
        mm.addLayer({ id: "nodes-halo", type: "circle", source: "nodes", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 12, 10, 26], "circle-color": ["get", "color"], "circle-opacity": 0.2 } });
        mm.addLayer({ id: "nodes", type: "circle", source: "nodes", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 5, 10, 9], "circle-color": ["get", "color"], "circle-stroke-width": 2, "circle-stroke-color": "#0A0E1A" } });
        // Hazards: quakes sized by magnitude, other events by type, each with a soft warning halo.
        const HAZARD_COLOR: ExpressionSpecification = ["match", ["get", "kind"], "earthquake", "#ff6b3d", "wildfires", "#ff3b30", "volcanoes", "#d6336c", "severeStorms", "#4dabf7", "floods", "#339af0", "firePixel", "#ff922b", "#f59f00"];
        // World events from GDELT: small diamonds coloured by kind, sized by how widely the story is reported.
        const EVENT_COLOR: ExpressionSpecification = ["match", ["get", "category"], "conflict", "#ff4d6d", "protest", "#ffa94d", "tension", "#ffd43b", "cooperation", "#69db7c", "#adb5bd"];
        // GKG hotspots: hollow cyan rings sized by how many articles mention the place.
        mm.addLayer({ id: "gkg", type: "circle", source: "gkg", paint: {
          "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#22d3ee", "circle-stroke-opacity": 0.75,
          "circle-stroke-width": 1.5, "circle-radius": ["interpolate", ["linear"], ["get", "articles"], 1, 4, 10, 9, 60, 18] } });
        mm.addLayer({ id: "events", type: "circle", source: "events", paint: {
          "circle-color": EVENT_COLOR, "circle-opacity": ["case", ["==", ["get", "truth_status"], "verified"], 0.9, 0.25],
          "circle-stroke-color": ["case", ["==", ["get", "truth_status"], "verified"], "#0A0E1A", "#adb5bd"], "circle-stroke-width": 1,
          "circle-radius": ["interpolate", ["linear"], ["get", "mentions"], 1, 2.5, 20, 6, 100, 10] } });
        mm.addLayer({ id: "hazards-halo", type: "circle", source: "hazards", paint: {
          "circle-color": HAZARD_COLOR, "circle-opacity": 0.18, "circle-blur": 0.6,
          "circle-radius": ["case", ["==", ["get", "kind"], "earthquake"], ["interpolate", ["linear"], ["coalesce", ["get", "mag"], 3], 2.5, 10, 7, 40], 16] } });
        mm.addLayer({ id: "hazards", type: "circle", source: "hazards", paint: {
          "circle-color": HAZARD_COLOR, "circle-stroke-color": "#0A0E1A", "circle-stroke-width": 1.5,
          "circle-radius": ["case", ["==", ["get", "kind"], "earthquake"], ["interpolate", ["linear"], ["coalesce", ["get", "mag"], 3], 2.5, 3, 7, 11], 5] } });
        mm.addLayer({ id: "ships", type: "symbol", source: "ships",
          layout: { "icon-image": "ship", "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.45, 12, 0.9], "icon-rotate": ["get", "rot"], "icon-rotation-alignment": "map", "icon-allow-overlap": true },
          paint: { "icon-color": ["case", [">", ["get", "sog"], 0.5], "#4cd38a", "#8b98a8"], "icon-halo-color": "#0A0E1A", "icon-halo-width": 1 } });
        mm.addLayer({ id: "trails", type: "line", source: "trails", layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffd166", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1, 10, 2.5], "line-opacity": 0.45, "line-blur": 0.5 } });
        mm.addLayer({ id: "flights", type: "symbol", source: "flights",
          layout: { "icon-image": "plane", "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 12, 1], "icon-rotate": ["get", "track"], "icon-rotation-alignment": "map", "icon-allow-overlap": true,
            "text-field": ["step", ["zoom"], "", 7, ["coalesce", ["get", "callsign"], ""]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-optional": true },
          paint: { "icon-color": ["case", ["get", "ground"], "#8b98a8", "#ffd166"], "icon-halo-color": "#0A0E1A", "icon-halo-width": 1, "text-color": "#ffd166", "text-halo-color": "#0A0E1A", "text-halo-width": 1.2 } });
        mm.addLayer({ id: "cams", type: "symbol", source: "cams",
          layout: { "icon-image": "cam", "icon-size": 0.6, "icon-allow-overlap": true }, paint: { "icon-color": "#c792ea", "icon-halo-color": "#0A0E1A", "icon-halo-width": 1 } });
        mm.addLayer({ id: "nodes-label", type: "symbol", source: "nodes",
          layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 2, 12, 10, 16], "text-offset": [0, 1.4], "text-anchor": "top" },
          paint: { "text-color": "#ffffff", "text-halo-color": "#0A0E1A", "text-halo-width": 1.6 } });

        mm.on("click", "nodes", e => { const slug = e.features?.[0]?.properties?.slug; if (slug) onFocusRef.current(String(slug)); });
        for (const id of ["nodes", "flights", "ships", "cams", "hazards", "events", "gkg"]) {
          mm.on("mouseenter", id, () => { mm.getCanvas().style.cursor = "pointer"; });
          mm.on("mouseleave", id, () => { mm.getCanvas().style.cursor = ""; });
        }
        // Start with the credits folded into the (i) button so they do not cover the globe on phones.
        el.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
        map.current = mm;
        setReady(true);
      });
    });
    return () => { cancelled = true; popup.current?.remove(); meMarker.current?.remove(); meMarker.current = null; m?.remove(); map.current = null; setReady(false); };
  }, []);

  // ---- popups for live objects ---------------------------------------------------------------
  useEffect(() => {
    const m = map.current, ml = lib.current;
    if (!ready || !m || !ml) return;
    const show = (lngLat: Hit["lngLat"], node: HTMLElement) => {
      popup.current?.remove();
      popup.current = new ml.Popup({ closeButton: true, maxWidth: "260px", className: "omega-popup" }).setLngLat(lngLat).setDOMContent(node).addTo(m);
    };
    const onFlight = (e: Hit) => {
      const p = e.features?.[0]?.properties; if (!p) return;
      show(e.lngLat, card(String(p.callsign || p.reg || p.id), [
        [t("pop.type"), p.type as string], [t("pop.reg"), p.reg as string],
        [t("pop.alt"), p.ground ? t("pop.ground") : p.alt != null ? `${Number(p.alt).toLocaleString()} ft` : null],
        [t("pop.speed"), p.speed != null ? `${Math.round(Number(p.speed))} kt` : null], [t("pop.heading"), `${Math.round(Number(p.track))}°`],
      ]));
    };
    const onShip = (e: Hit) => {
      const p = e.features?.[0]?.properties; if (!p) return;
      show(e.lngLat, card(String(p.name || `MMSI ${p.mmsi}`), [["MMSI", String(p.mmsi)], [t("pop.speed"), `${Number(p.sog).toFixed(1)} kn`], [t("pop.heading"), `${Math.round(Number(p.rot))}°`]]));
    };
    const onCam = (e: Hit) => {
      const p = e.features?.[0]?.properties; if (!p) return;
      show(e.lngLat, card(String(p.title), [], p.preview as string | null, p.url as string | null));
    };
    const onHazard = (e: Hit) => {
      const p = e.features?.[0]?.properties; if (!p) return;
      show(e.lngLat, card(String(p.title), [[t("pop.kind"), t.has(`hazardKinds.${p.kind}`) ? t(`hazardKinds.${p.kind}`) : String(p.kind)],
        [t("pop.magnitude"), p.mag != null ? String(p.mag) : null], [t("pop.when"), new Date(String(p.at)).toLocaleString()], [t("pop.source"), String(p.source)]], null, p.url as string | null));
    };
    const onEvent = (e: Hit) => {
      const p = e.features?.[0]?.properties; if (!p) return;
      let host = ""; try { host = new URL(String(p.url)).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
      show(e.lngLat, card(String(p.place || t("eventKinds.other")), [[t("pop.kind"), t(`eventKinds.${p.category}`)], [t("pop.tone"), String(p.tone)],
        [t("pop.reports"), String(p.mentions)], [t("pop.source"), host]], null, p.url as string | null));
    };
    const onGkg = (e: Hit) => {
      const p = e.features?.[0]?.properties; if (!p) return;
      const list = (v: unknown) => { try { return (JSON.parse(String(v)) as string[]).join(", "); } catch { return ""; } };
      show(e.lngLat, card(String(p.place), [[t("pop.reports"), String(p.articles)], [t("pop.tone"), String(p.tone)],
        [t("pop.persons"), list(p.persons)], [t("pop.orgs"), list(p.orgs)], [t("pop.themes"), list(p.themes)]], null, p.url as string | null));
    };
    m.on("click", "flights", onFlight); m.on("click", "ships", onShip); m.on("click", "cams", onCam); m.on("click", "hazards", onHazard); m.on("click", "events", onEvent); m.on("click", "gkg", onGkg);
    return () => { m.off("click", "flights", onFlight); m.off("click", "ships", onShip); m.off("click", "cams", onCam); m.off("click", "hazards", onHazard); m.off("click", "events", onEvent); m.off("click", "gkg", onGkg); };
  }, [ready, t]);

  // ---- basemap, terrain and layer visibility -------------------------------------------------
  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    m.setLayoutProperty("satellite", "visibility", basemap === "satellite" ? "visible" : "none");
  }, [basemap, ready]);

  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    // Relief only matters once you are near the ground; skipping it on the whole-globe view keeps the GPU cool.
    let on: boolean | null = null;
    const apply = () => {
      const want = terrain && m.getZoom() >= 4;
      if (want === on) return;
      on = want;
      m.setTerrain(want ? { source: "dem", exaggeration: 1.5 } : null);
      m.setLayoutProperty("hillshade", "visibility", want ? "visible" : "none");
    };
    apply();
    m.on("zoomend", apply);
    if (terrain && m.getPitch() < 30 && m.getZoom() > 4) m.easeTo({ pitch: 55, duration: 600 });
    return () => { m.off("zoomend", apply); };
  }, [terrain, ready]);

  const { flights, ships, cams, hazards, events, gkg } = feeds;
  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    m.setLayoutProperty("flights", "visibility", flights.on ? "visible" : "none");
    m.setLayoutProperty("trails", "visibility", flights.on ? "visible" : "none");
    m.setLayoutProperty("ships", "visibility", ships.on ? "visible" : "none");
    m.setLayoutProperty("cams", "visibility", cams.on ? "visible" : "none");
    for (const id of ["hazards", "hazards-halo"]) m.setLayoutProperty(id, "visibility", hazards.on ? "visible" : "none");
    m.setLayoutProperty("events", "visibility", events.on ? "visible" : "none");
    m.setLayoutProperty("gkg", "visibility", gkg.on ? "visible" : "none");
  }, [flights.on, ships.on, cams.on, hazards.on, events.on, gkg.on, ready]);

  const kindsKey = eventKinds?.join(",") ?? "*";
  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    m.setFilter("events", eventKinds ? ["in", ["get", "category"], ["literal", eventKinds]] : null);
  }, [kindsKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("nodes") as GeoJSONSource).setData({ type: "FeatureCollection", features: nodes.map(n => ({
      type: "Feature", geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      properties: { slug: n.slug, name: n.name, color: COLOR[n.node_type] ?? "#e6edf3" },
    })) });
  }, [nodes, ready]);

  useEffect(() => {
    const n = nodes.find(x => x.slug === focus);
    if (n && ready && map.current) map.current.flyTo({ center: [n.lon, n.lat], zoom: n.node_type === "port" ? 12 : 9, pitch: 55, speed: 1.2, essential: true });
  }, [focus, nodes, ready]);

  // ---- day/night, external fly-to, cinematic spin, phone AR -----------------------------------
  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    const paint = () => (m.getSource("night") as GeoJSONSource | undefined)?.setData(night ? nightPolygon() : EMPTY);
    paint();
    const id = setInterval(paint, 60_000);
    return () => clearInterval(id);
  }, [night, ready]);

  useEffect(() => {
    if (target && ready && map.current) map.current.flyTo({ center: [target.lon, target.lat], zoom: target.zoom, pitch: 55, speed: 1.3, essential: true });
  }, [target, ready]);

  useEffect(() => {
    const m = map.current; if (!ready || !m || !spin) return;
    // Slow eastward drift while the globe is zoomed out and nobody is touching it.
    let raf = 0, last = performance.now(), held = false;
    const hold = () => { held = true; };
    const release = () => { held = false; last = performance.now(); };
    // Throttled to ~12 fps: smooth enough for a slow drift, far lighter on this laptop than redrawing every frame.
    const step = (now: number) => {
      if (now - last >= 80) {
        if (!held && m.getZoom() < 3.5 && !m.isMoving()) m.setCenter([m.getCenter().lng + ((now - last) / 1000) * 2.4, m.getCenter().lat]);
        last = now;
      }
      raf = requestAnimationFrame(step);
    };
    m.on("mousedown", hold); m.on("touchstart", hold); m.on("mouseup", release); m.on("touchend", release);
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); m.off("mousedown", hold); m.off("touchstart", hold); m.off("mouseup", release); m.off("touchend", release); };
  }, [spin, ready]);

  useEffect(() => { setCanAr(typeof DeviceOrientationEvent !== "undefined" && window.matchMedia("(pointer: coarse)").matches); }, []);

  useEffect(() => {
    const m = map.current; if (!ready || !m || ar !== "on") return;
    // AR mode: the phone becomes a window onto the globe. Compass heading turns the map, tilt sets the pitch.
    const onTurn = (e: DeviceOrientationEvent) => {
      const heading = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading ?? (e.alpha != null ? 360 - e.alpha : null);
      if (heading == null || e.beta == null) return;
      m.jumpTo({ bearing: heading, pitch: Math.max(0, Math.min(80, e.beta)) });
    };
    window.addEventListener("deviceorientation", onTurn);
    return () => window.removeEventListener("deviceorientation", onTurn);
  }, [ar, ready]);

  const toggleAr = async () => {
    if (ar === "on") return setAr("off");
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
    try { if (D.requestPermission && (await D.requestPermission()) !== "granted") return setAr("denied"); } catch { return setAr("denied"); }
    setSpin(false);
    setAr("on");
  };

  // ---- live feeds ----------------------------------------------------------------------------
  const refresh = useCallback(async (l: Layer) => {
    const m = map.current; if (!m || !feedsRef.current[l].on) return;
    if (feedsRef.current[l].count == null) patch(l, { state: "loading" });
    try {
      const r = await fetch(`/api/${l === "cams" ? "webcams" : l}?${viewQuery(m)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.configured === false) { patch(l, { state: "nokey", count: null }); onFeedRef.current?.(l, []); return; }
      if (!r.ok) throw new Error(String(r.status));
      const src = m.getSource(l) as GeoJSONSource | undefined;
      if (l === "flights") {
        // Trails: remember each aircraft's recent fixes so its path draws behind it.
        const run = ++tick.current;
        for (const f of j.flights as { id: string; lat: number; lon: number }[]) {
          const tr = trails.current.get(f.id) ?? { pts: [], seen: run };
          const last = tr.pts[tr.pts.length - 1];
          if (!last || last[0] !== f.lon || last[1] !== f.lat) tr.pts.push([f.lon, f.lat]);
          if (tr.pts.length > 14) tr.pts.shift();
          tr.seen = run;
          trails.current.set(f.id, tr);
        }
        for (const [id, tr] of trails.current) if (run - tr.seen > 2) trails.current.delete(id);
        (m.getSource("trails") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [...trails.current.values()]
          .filter(tr => tr.pts.length > 1).map(tr => ({ type: "Feature", geometry: { type: "LineString", coordinates: tr.pts }, properties: {} })) });
        onFeedRef.current?.("flights", (j.flights as { id: string; lat: number; lon: number; callsign: string | null; reg: string | null; type: string | null; altFt: number | null; track: number }[])
          .map(f => ({ id: f.id, lat: f.lat, lon: f.lon, label: f.callsign || f.reg || f.id, sub: [f.type, f.altFt != null ? `${f.altFt.toLocaleString()} ft` : null].filter(Boolean).join(" · "), heading: f.track })));
      }
      if (l === "ships") onFeedRef.current?.("ships", (j.ships as { mmsi: number; name: string | null; lat: number; lon: number; sog: number }[])
        .map(s => ({ id: String(s.mmsi), lat: s.lat, lon: s.lon, label: s.name || `MMSI ${s.mmsi}`, sub: `${s.sog.toFixed(1)} kn` })));
      if (l === "cams") onFeedRef.current?.("cams", (j.webcams as { id: string; title: string; lat: number; lon: number; preview: string | null; url: string | null }[])
        .map(c => ({ id: c.id, lat: c.lat, lon: c.lon, label: c.title, image: c.preview, url: c.url })));
      if (l === "flights") src?.setData({ type: "FeatureCollection", features: (j.flights as { id: string; lat: number; lon: number; track: number; callsign: string | null; reg: string | null; type: string | null; altFt: number | null; speedKt: number | null; ground: boolean }[]).map(f => ({
        type: "Feature", geometry: { type: "Point", coordinates: [f.lon, f.lat] },
        properties: { id: f.id, callsign: f.callsign, reg: f.reg, type: f.type, alt: f.altFt, speed: f.speedKt, track: f.track, ground: f.ground } })) });
      if (l === "ships") src?.setData({ type: "FeatureCollection", features: (j.ships as { mmsi: number; name: string | null; lat: number; lon: number; cog: number; sog: number; heading: number | null }[]).map(s => ({
        type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { mmsi: s.mmsi, name: s.name, sog: s.sog, rot: s.heading ?? s.cog } })) });
      if (l === "gkg") {
        const list = j.hotspots as { id: string; place: string; lat: number; lon: number; articles: number; tone: number; persons: string[]; orgs: string[]; themes: string[]; url: string }[];
        src?.setData({ type: "FeatureCollection", features: list.map(h => ({ type: "Feature", geometry: { type: "Point", coordinates: [h.lon, h.lat] },
          properties: { ...h, persons: JSON.stringify(h.persons), orgs: JSON.stringify(h.orgs), themes: JSON.stringify(h.themes) } })) });
        onFeedRef.current?.("gkg", list.map(h => ({ id: h.id, lat: h.lat, lon: h.lon, label: h.place,
          sub: [...h.persons.slice(0, 2), ...h.orgs.slice(0, 2)].join(" · "), url: h.url })), { topPersons: j.topPersons, topOrgs: j.topOrgs });
      }
      if (l === "events") {
        const list = j.events as { id: string; lat: number; lon: number; place: string; category: string; tone: number; mentions: number; url: string; at: string;
          truth: { score: number; status: string; flags: string[] } }[];
        src?.setData({ type: "FeatureCollection", features: list.map(ev => ({ type: "Feature", geometry: { type: "Point", coordinates: [ev.lon, ev.lat] }, properties: { ...ev, truth_status: ev.truth.status, truth_score: ev.truth.score } })) });
        onFeedRef.current?.("events", list.map(ev => ({ id: ev.id, lat: ev.lat, lon: ev.lon, label: ev.place || "—", kind: ev.category,
          truth: ev.truth,
          sub: `${t(`eventKinds.${ev.category}`)} · ${ev.mentions} · ${ev.tone}`, url: ev.url })));
      }
      if (l === "hazards") {
        const list = j.hazards as { id: string; kind: string; title: string; lat: number; lon: number; mag: number | null; at: string; url: string | null; source: string }[];
        src?.setData({ type: "FeatureCollection", features: list.map(h => ({ type: "Feature", geometry: { type: "Point", coordinates: [h.lon, h.lat] }, properties: { ...h } })) });
        onFeedRef.current?.("hazards", [...list].sort((a, b) => b.at.localeCompare(a.at)).map(h => ({ id: h.id, lat: h.lat, lon: h.lon, label: h.title,
          sub: [t.has(`hazardKinds.${h.kind}`) ? t(`hazardKinds.${h.kind}`) : h.kind, h.mag != null ? (h.kind === "earthquake" ? `M${h.mag.toFixed(1)}` : String(h.mag)) : null, h.source].filter(Boolean).join(" · "),
          url: h.url })), { firms: j.firms });
      }
      if (l === "cams") src?.setData({ type: "FeatureCollection", features: (j.webcams as { id: string; title: string; lat: number; lon: number; preview: string | null; url: string | null }[]).map(c => ({
        type: "Feature", geometry: { type: "Point", coordinates: [c.lon, c.lat] }, properties: { title: c.title, preview: c.preview, url: c.url } })) });
      patch(l, { state: l === "ships" && j.status !== "live" ? "loading" : "live", count: j.count ?? 0 });
    } catch {
      // Keep the last good picture on screen and mark it stale; a single slow poll should not blank the radar.
      patch(l, { state: feedsRef.current[l].count == null ? "error" : "stale" });
    }
  }, []);

  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    let debounce: ReturnType<typeof setTimeout>;
    const all = () => { refresh("flights"); refresh("ships"); refresh("cams"); };
    refresh("hazards"); refresh("events"); refresh("gkg");
    const onMove = () => { clearTimeout(debounce); debounce = setTimeout(all, 600); };
    m.on("moveend", onMove);
    all();
    const tFlights = setInterval(() => refresh("flights"), 15_000);
    const tShips = setInterval(() => refresh("ships"), 20_000);
    const tHazards = setInterval(() => { refresh("hazards"); refresh("events"); refresh("gkg"); }, 5 * 60_000);
    return () => { m.off("moveend", onMove); clearTimeout(debounce); clearInterval(tFlights); clearInterval(tShips); clearInterval(tHazards); };
  }, [ready, refresh]);

  const toggle = (l: Layer) => {
    const on = !feeds[l].on;
    patch(l, { on });
    if (on) setTimeout(() => refresh(l), 0);
  };

  // ---- my location (stays in this browser; never sent to any server) -------------------------
  const locate = () => {
    if (!navigator.geolocation) return setMe("denied");
    setMe("locating");
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      setMe({ lat, lon, acc: accuracy });
      const m = map.current, ml = lib.current; if (!m || !ml) return;
      if (!meMarker.current) {
        const dot = document.createElement("div"); dot.className = "omega-me";
        meMarker.current = new ml.Marker({ element: dot }).setLngLat([lon, lat]).addTo(m);
      } else meMarker.current.setLngLat([lon, lat]);
      const ring = Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * 2 * Math.PI;
        return [lon + (accuracy / (111_320 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (accuracy / 111_320) * Math.sin(a)];
      });
      (m.getSource("me-acc") as GeoJSONSource).setData({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} });
      m.flyTo({ center: [lon, lat], zoom: Math.min(17, Math.max(12, 21 - Math.log2(Math.max(accuracy, 20)))), pitch: 50, speed: 1.4, essential: true });
    }, () => setMe("denied"), { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
  };

  const zoomBy = (d: number) => map.current?.easeTo({ zoom: Math.min(MAX_ZOOM, Math.max(0, zoom + d)), duration: 300 });
  const dot = (s: Feed["state"]) => (s === "live" ? "bg-good animate-pulse" : s === "error" ? "bg-bad" : s === "nokey" || s === "stale" ? "bg-warn" : "bg-muted");
  const LAYERS: { id: Layer; color: string }[] = [{ id: "flights", color: "#ffd166" }, { id: "ships", color: "#4cd38a" }, { id: "cams", color: "#c792ea" }, { id: "hazards", color: "#ff6b3d" }, { id: "events", color: "#ff4d6d" }, { id: "gkg", color: "#22d3ee" }];
  const glass = "rounded-lg border border-white/10 bg-[#07101a]/80 shadow-lg backdrop-blur-md";

  return (
    <div className="relative">
      <div ref={el} className="h-[64dvh] min-h-[360px] w-full overflow-hidden rounded-[14px] bg-[#050b12] lg:h-[calc(100dvh-170px)]" />
      {glFailed && (
        <div className="absolute inset-0 z-20 grid place-items-center rounded-[14px] bg-[#050b12]/90 p-6 text-center">
          <div className="max-w-xs space-y-2">
            <p className="font-semibold">{t("gl.title")}</p>
            <p className="text-sm text-muted">{t("gl.body")}</p>
            <button onClick={() => location.reload()} className="mt-2 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-[#0A0E1A]">{t("gl.reload")}</button>
          </div>
        </div>
      )}

      {/* Physical right: the map canvas does not mirror in RTL, and MapLibre's own controls sit top-left. */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex w-[min(15rem,calc(100%-4.5rem))] flex-col items-stretch gap-2" dir="ltr">
        <div className={`pointer-events-auto flex overflow-hidden text-xs ${glass}`}>
          {(["satellite", "map"] as const).map(b => (
            <button key={b} onClick={() => setBasemap(b)} aria-pressed={basemap === b}
              className={`flex-1 px-3 py-1.5 ${basemap === b ? "bg-accent font-semibold text-[#0A0E1A]" : "text-ink hover:bg-white/5"}`}>{t(`layers.${b}`)}</button>
          ))}
          <button onClick={() => setTerrain(v => !v)} aria-pressed={terrain} title={t("terrain")}
            className={`border-s border-white/10 px-3 py-1.5 ${terrain ? "bg-accent/20 font-semibold text-accent" : "text-ink hover:bg-white/5"}`}>3D</button>
        </div>

        <section className={`pointer-events-auto overflow-hidden ${glass}`}>
          <button onClick={() => setPanelOpen(o => !o)} className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-muted">
            <span>{t("radar")}</span><span>{panelOpen ? "−" : "+"}</span>
          </button>
          {panelOpen && (
            <ul className="border-t border-white/10 text-sm">
              {LAYERS.map(({ id, color }) => {
                const f = feeds[id];
                return (
                  <li key={id}>
                    <button onClick={() => toggle(id)} aria-pressed={f.on} className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-white/5">
                      <span className="size-2.5 rounded-sm" style={{ background: f.on ? color : "transparent", outline: `1.5px solid ${color}` }} />
                      <span dir="auto" className={`flex-1 text-start ${f.on ? "text-ink" : "text-muted"}`}>{t(`feeds.${id}`)}</span>
                      {f.on && f.state === "nokey" ? <span className="text-[10px] text-warn">{t("needsKey")}</span>
                        : <span className="num text-xs text-muted">{f.on && f.count != null ? f.count.toLocaleString() : ""}</span>}
                      {f.on && <span className={`size-1.5 rounded-full ${dot(f.state)}`} />}
                    </button>
                  </li>
                );
              })}
              <li className="flex gap-1 border-t border-white/10 p-1.5 text-[11px]">
                {[
                  { on: night, set: () => setNight(v => !v), label: t("fx.night") },
                  { on: spin, set: () => setSpin(v => !v), label: t("fx.spin") },
                  ...(canAr ? [{ on: ar === "on", set: toggleAr, label: ar === "denied" ? t("fx.arDenied") : t("fx.ar") }] : []),
                ].map(b => (
                  <button key={b.label} onClick={b.set} aria-pressed={b.on}
                    className={`flex-1 rounded-md px-2 py-1.5 ${b.on ? "bg-accent/20 font-semibold text-accent" : "text-muted hover:bg-white/5"}`}>{b.label}</button>
                ))}
              </li>
              <li className="border-t border-white/10">
                <button onClick={locate} className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-white/5">
                  <span className="omega-me-sm" />
                  <span className="flex-1 text-start text-ink">{t("myLocation")}</span>
                  <span className="text-[10px] text-muted">{me === "locating" ? "…" : me === "denied" ? t("locationDenied") : me ? `±${Math.round(me.acc)} m` : ""}</span>
                </button>
              </li>
            </ul>
          )}
        </section>

        <div className={`pointer-events-auto flex items-center gap-1 self-end p-1 text-sm ${glass}`}>
          <button onClick={() => zoomBy(-1)} className="grid size-8 place-items-center rounded-md hover:bg-white/5" aria-label={t("zoomOut")}>−</button>
          <span className="num w-12 text-center text-xs text-muted">z{zoom.toFixed(1)}</span>
          <button onClick={() => zoomBy(1)} className="grid size-8 place-items-center rounded-md hover:bg-white/5" aria-label={t("zoomIn")}>+</button>
        </div>
      </div>

      {cursor && (
        <div className="num pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 rounded-md border border-white/10 bg-[#07101a]/75 px-2.5 py-1 font-mono text-[11px] text-muted backdrop-blur sm:block" dir="ltr">
          {Math.abs(cursor.lat).toFixed(4)}°{cursor.lat >= 0 ? "N" : "S"} {Math.abs(wrapLon(cursor.lon)).toFixed(4)}°{wrapLon(cursor.lon) >= 0 ? "E" : "W"}
        </div>
      )}
    </div>
  );
}
