import type { MetadataRoute } from "next";

// Installable app (ADR-025): home-screen icon, standalone window, quick actions, and the phone's share sheet.
// "Share to OMEGA" from any app opens the Send screen with the text or link filled in.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "OMEGA PRIME",
    short_name: "OMEGA",
    description: "Global logistics & market intelligence, with Director 00 in your pocket",
    start_url: "/ar",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#071526",
    theme_color: "#071526",
    lang: "ar",
    dir: "rtl",
    categories: ["business", "finance", "news"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Send to Director 00", short_name: "Send", url: "/ar/send", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Approval inbox", short_name: "Inbox", url: "/ar#inbox", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Earth", short_name: "Earth", url: "/ar/earth", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
    share_target: { action: "/ar/send", method: "GET", params: { title: "title", text: "text", url: "url" } },
  } as MetadataRoute.Manifest;
}
