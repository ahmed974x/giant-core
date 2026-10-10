// OMEGA PRIME service worker (ADR-025): installable app shell that still opens with no connection.
// - Static assets (/_next/static, icons, fonts, the MapLibre worker): cache-first, they are content-hashed.
// - Pages: network-first, falling back to the last copy, then to the offline page.
// - /api and /relay: never cached, so live data, approvals and the PIN never sit in a cache.
const VERSION = "omega-v2";
const SHELL = ["/ar", "/en", "/offline.html", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/relay/")) return;   // always live

  const isStatic = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/maplibre/") || /\.(png|svg|woff2?)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    })));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match("/offline.html"))));
  }
});

// Phone alerts (ADR-035): show what Director 00 or Phoenix pushed, and open the right screen on tap.
self.addEventListener("push", event => {
  let note = { title: "OMEGA PRIME", body: "", url: "/ar", tag: undefined };
  try { note = { ...note, ...event.data.json() }; } catch { /* plain or empty push */ }
  event.waitUntil(self.registration.showNotification(note.title, {
    body: note.body, tag: note.tag, icon: "/icon-192.png", badge: "/icon-192.png", lang: "ar", dir: "auto", data: { url: note.url },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/ar", self.location.origin);
  if (url.origin !== self.location.origin) return;   // only ever open OMEGA itself
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === url.origin);
    return open ? open.navigate(url.href).then(c => c && c.focus()) : self.clients.openWindow(url.href);
  }));
});
