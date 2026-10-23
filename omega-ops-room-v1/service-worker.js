// OMEGA Ops Room service worker (ADR-097).
// Caches the app shell of this folder (the two pages, the manifest and the icons) so the Ops Room and
// THE CHAIN open offline and install as an app. Pages are network-first, so a new version shows as soon
// as the server has it; the cached copy is used only when the network fails. Live data is never cached
// here: proxy routes (/osiris, /market, /sec, /stooq) sit outside this scope, and requests to other
// origins pass straight through, so an offline layer still says OFFLINE instead of showing old numbers.
"use strict";
const VERSION = "omega-ops-shell-2026-10-23-p14b";
const SHELL = ["omega-ops-room.html", "the-chain.html", "manifest.json", "icons/omega-180.png", "icons/omega-192.png", "icons/omega-512.png", "icons/omega-maskable-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("omega-ops-shell-") && k !== VERSION).map(k => caches.delete(k))))
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
  const name = url.pathname.slice(scope.length) || "omega-ops-room.html";
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
