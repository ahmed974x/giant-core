// Agent threads (ADR-124): draws each link in data-links as a cubic Bézier between two nodes of the stage.
// Links are declared in the page ("from>to:kind"), so the drawing shows only links the page states. No network, no timers:
// it redraws on resize and highlights a node's threads on hover, focus or tap.
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  function setup(fig) {
    var stage = fig.querySelector(".th-stage"), svg = fig.querySelector(".th-svg");
    if (!stage || !svg) return;
    var links = (stage.getAttribute("data-links") || "").split(/\s+/).filter(Boolean).map(function (t) {
      var m = /^([\w-]+)>([\w-]+):(\w+)$/.exec(t);
      return m ? { from: m[1], to: m[2], kind: m[3] } : null;
    }).filter(function (l) { return l && document.getElementById(l.from) && document.getElementById(l.to); });
    var paths = [], pinned = null;
    function box(el, s) { var r = el.getBoundingClientRect(); return { l: r.left - s.left, r: r.right - s.left, t: r.top - s.top, b: r.bottom - s.top, x: (r.left + r.right) / 2 - s.left, y: (r.top + r.bottom) / 2 - s.top }; }
    function draw() {
      var s = stage.getBoundingClientRect();
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.setAttribute("viewBox", "0 0 " + Math.max(1, s.width) + " " + Math.max(1, s.height));
      paths = [];
      links.forEach(function (l) {
        var a = box(document.getElementById(l.from), s), b = box(document.getElementById(l.to), s);
        var dx = b.x - a.x, dy = b.y - a.y, d, ex, ey;
        if (Math.abs(dx) > Math.max(24, Math.abs(dy) * 0.35)) {
          var x1 = dx > 0 ? a.r : a.l, x2 = dx > 0 ? b.l : b.r, k = (x2 - x1) * 0.5;
          d = "M" + x1 + " " + a.y + " C" + (x1 + k) + " " + a.y + " " + (x2 - k) + " " + b.y + " " + x2 + " " + b.y;
          ex = x2; ey = b.y;
        } else {
          // stacked nodes (phone): an arc out to the side with more free room, taller arcs bulge further, so threads stay apart
          var roomL = Math.min(a.l, b.l), roomR = s.width - Math.max(a.r, b.r), sg = roomR >= roomL ? 1 : -1;
          var xa = sg > 0 ? a.r : a.l, xb = sg > 0 ? b.r : b.l, edge = sg > 0 ? Math.max(xa, xb) : Math.min(xa, xb);
          var bulge = Math.max(10, Math.min(Math.max(roomL, roomR) - 8, 12 + Math.abs(dy) * 0.2));
          d = "M" + xa + " " + a.y + " C" + (edge + sg * bulge) + " " + a.y + " " + (edge + sg * bulge) + " " + b.y + " " + xb + " " + b.y;
          ex = xb; ey = b.y;
        }
        var p = document.createElementNS(NS, "path");
        p.setAttribute("d", d); p.setAttribute("class", "th-link " + l.kind);
        var c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", ex); c.setAttribute("cy", ey); c.setAttribute("r", "3"); c.setAttribute("class", "th-end " + l.kind);
        svg.appendChild(p); svg.appendChild(c);
        paths.push({ l: l, els: [p, c] });
      });
    }
    function focus(id) {
      fig.classList.toggle("focus", !!id);
      var on = {};
      if (id) on[id] = true;
      paths.forEach(function (o) {
        var hit = !!id && (o.l.from === id || o.l.to === id);
        if (hit) { on[o.l.from] = true; on[o.l.to] = true; }
        o.els.forEach(function (e) { e.classList.toggle("on", hit); });
      });
      Array.prototype.forEach.call(fig.querySelectorAll(".th-node"), function (n) { n.classList.toggle("on", !!on[n.id]); });
    }
    Array.prototype.forEach.call(fig.querySelectorAll(".th-node"), function (n) {
      n.addEventListener("mouseenter", function () { focus(n.id); });
      n.addEventListener("mouseleave", function () { focus(pinned); });
      n.addEventListener("focus", function () { focus(n.id); });
      n.addEventListener("blur", function () { focus(pinned); });
      // a tap pins the node's threads (touch has no hover); a second tap on the same node clears them
      n.addEventListener("click", function () { pinned = pinned === n.id ? null : n.id; focus(pinned); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-thread]"), function (card) {
      var id = card.getAttribute("data-thread");
      card.addEventListener("mouseenter", function () { focus(id); });
      card.addEventListener("mouseleave", function () { focus(pinned); });
    });
    draw();
    if ("ResizeObserver" in window) new ResizeObserver(draw).observe(stage); else window.addEventListener("resize", draw);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  }
  function init() { Array.prototype.forEach.call(document.querySelectorAll(".threads"), setup); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
