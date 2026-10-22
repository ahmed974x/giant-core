// NABD portal service worker (ADR-097).
// Caches this folder's pages, style, scripts, fonts, manifest and icons so the NABD portal opens
// offline and installs as an app. Pages are network-first, so a new version shows as soon
// as the server has it; the cached copy is used only when the network fails. Live data is never cached
// here: the portal fetches no market data, and requests to other origins pass straight through.
"use strict";
const VERSION = "nabd-shell-2026-10-22";
const SHELL = ["index.html", "en.html", "style.css", "vis.js", "suite.js", "calc.js", "desk-sim.js", "pwa.js", "manifest.json", "fonts/cairo-arabic-wght-normal.woff2", "fonts/cairo-latin-wght-normal.woff2", "fonts/jetbrains-mono-latin-wght-normal.woff2", "icons/nabd.svg", "icons/nabd-180.png", "icons/nabd-192.png", "icons/nabd-512.png", "icons/nabd-maskable-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("nabd-shell-") && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  const name = url.pathname.slice(scope.length) || "index.html";
  if (!SHELL.includes(name)) return;
  const key = new URL(name, self.registration.scope).href;
  event.respondWith(
    fetch(req, { cache: "no-store" })
      .then(res => {
        if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then(cache => cache.put(key, copy)); }
        return res;
      })
      .catch(() => caches.match(key).then(hit => hit || Response.error()))
  );
});
