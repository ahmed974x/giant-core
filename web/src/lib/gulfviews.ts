// Gulf live views (ADR-051): no keyless government camera feed exists for the Gulf, so these are hand-picked pages
// that publish live views for the public (official broadcaster streams and webcam sites). The globe links out to the
// page; nothing is embedded, copied or scraped, and nothing private or unsecured is ever listed.
import type { Webcam } from "./opencams.ts";

const VIEWS: { id: string; title: string; lat: number; lon: number; url: string }[] = [
  { id: "makkah-official", title: "Makkah, Masjid al-Haram live (Saudi Broadcasting Authority, official)", lat: 21.4225, lon: 39.8262, url: "https://www.aloula.sa/" },
  { id: "makkah-restream", title: "Makkah and Madinah live (MakkahLive re-stream)", lat: 21.43, lon: 39.84, url: "https://makkahlive.net/" },
  { id: "madinah-official", title: "Madinah, Masjid an-Nabawi live (Saudi Broadcasting Authority, official)", lat: 24.4672, lon: 39.6111, url: "https://www.aloula.sa/" },
  { id: "dubai-princess", title: "Dubai Marina from Princess Tower (SkylineWebcams)", lat: 25.0886, lon: 55.1474, url: "https://www.skylinewebcams.com/en/webcam/united-arab-emirates/dubai/dubai/dubai.html" },
  { id: "dubai-palm", title: "Dubai, Palm Jumeirah live views (Geocam)", lat: 25.1124, lon: 55.139, url: "https://www.geocam.ru/en/in/dubai/" },
  { id: "abudhabi", title: "Abu Dhabi live views (SCS webcams)", lat: 24.4539, lon: 54.3773, url: "https://webcam.scs.com.ua/en/asia/uae/" },
  { id: "uae-tabi", title: "UAE live webcams directory (tabi.cam)", lat: 25.2048, lon: 55.2708, url: "https://tabi.cam/united-arab-emirates/" },
];

export function gulfViews(): Webcam[] {
  return VIEWS.map(v => ({ id: `gulf-${v.id}`, title: v.title, lat: v.lat, lon: v.lon, preview: null, url: v.url, status: "link", source: "gulf-live" }));
}
