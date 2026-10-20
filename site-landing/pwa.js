// NABD install support (ADR-097): links the manifest and registers the service worker, only where the
// browser allows both (http or https, secure context). Opened from disk the page works as before.
(function () {
  "use strict";
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  var link = function (rel, href, type) { var l = document.createElement("link"); l.rel = rel; l.href = href; if (type) l.type = type; document.head.appendChild(l); };
  link("manifest", "manifest.json");
  link("apple-touch-icon", "icons/nabd-180.png");
  link("icon", "icons/nabd.svg", "image/svg+xml");
  if (window.isSecureContext && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js", { scope: "./" }).catch(function () { /* install stays off; the page works without it */ });
  }
})();
