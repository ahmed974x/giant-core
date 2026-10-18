// NABD profit-split calculator (ADR-089). Math simulation only: it sends nothing, stores nothing and accepts no money.
// Per period:  fee = rate × max(0, NAV_before − HWM × (1 + hurdle)),  NAV ← NAV_before − fee,  HWM ← max(HWM, NAV).
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  if (!$("cAmount")) return;
  var ar = document.documentElement.lang === "ar";
  var nf = function (v, d) { d = d === undefined ? 2 : d; return Number.isFinite(v) ? new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : "—"; };
  var signed = function (v) { return (v > 0 ? "+" : "") + nf(v); };
  var NS = "http://www.w3.org/2000/svg";
  function mk(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function simulate(amount, ratePct, hurdlePct, returns) {
    var nav = amount, hwm = amount, gross = amount, fees = 0, protectedPeriods = 0;
    var rows = [{ p: 0, r: 0, gross: gross, before: amount, fee: 0, nav: nav, hwm: hwm }];
    returns.forEach(function (r, i) {
      gross *= 1 + r / 100;
      var before = nav * (1 + r / 100);
      var fee = ratePct / 100 * Math.max(0, before - hwm * (1 + hurdlePct / 100));
      if (r > 0 && fee === 0) protectedPeriods++;
      nav = before - fee; fees += fee; hwm = Math.max(hwm, nav);
      rows.push({ p: i + 1, r: r, gross: gross, before: before, fee: fee, nav: nav, hwm: hwm });
    });
    return { rows: rows, fees: fees, nav: nav, gross: gross, protectedPeriods: protectedPeriods };
  }

  function draw(S, amount) {
    var svg = $("cChart");
    while (svg.firstChild) svg.firstChild.remove();
    var W = 720, H = 240, L = 72, R = 14, T = 14, B = 30;
    var vals = [];
    S.rows.forEach(function (r) { vals.push(r.gross, r.nav, r.hwm); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.1 || amount * 0.05;
    var x = function (i) { return L + i * (W - L - R) / Math.max(1, S.rows.length - 1); };
    var y = function (v) { return T + (hi + pad - v) / (hi - lo + 2 * pad) * (H - T - B); };
    for (var k = 0; k <= 4; k++) {
      var v = lo - pad + (hi - lo + 2 * pad) * k / 4;
      svg.append(mk("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": "grid-line" }));
      svg.append(mk("text", { x: L - 8, y: y(v) + 4, "class": "axis", "text-anchor": "end" }, nf(v, 0)));
    }
    var every = Math.max(1, Math.ceil(S.rows.length / 12));
    S.rows.forEach(function (r, i) { if (i % every === 0 || i === S.rows.length - 1) svg.append(mk("text", { x: x(i), y: H - 9, "class": "axis", "text-anchor": "middle" }, "P" + r.p)); });
    function path(key, cls, step) {
      var d = "";
      S.rows.forEach(function (r, i) { d += i ? (step ? " H" + x(i) + " V" + y(r[key]) : " L" + x(i) + " " + y(r[key])) : "M" + x(0) + " " + y(r[key]); });
      svg.append(mk("path", { d: d, "class": cls }));
    }
    path("gross", "l-gross"); path("hwm", "l-hwm", true); path("nav", "l-net");
    S.rows.forEach(function (r, i) { if (r.fee > 0) svg.append(mk("circle", { cx: x(i), cy: y(r.nav), r: 3.5, "class": "fee-dot" })); });
  }

  function render() {
    var amount = parseFloat($("cAmount").value), rate = parseFloat($("cFee").value), hurdle = parseFloat($("cHurdle").value) || 0;
    var returns = $("cReturns").value.split(/[,،;\s]+/).filter(Boolean).map(Number).filter(function (r) { return Number.isFinite(r) && r > -100; }).slice(0, 120);
    var bad = { cAmount: !(amount > 0), cFee: !(rate >= 0 && rate <= 100), cHurdle: !(hurdle >= 0), cReturns: !returns.length };
    Object.keys(bad).forEach(function (id) { $(id).setAttribute("aria-invalid", bad[id] ? "true" : "false"); });
    var anyBad = Object.keys(bad).some(function (id) { return bad[id]; });
    $("cError").hidden = !anyBad;
    if (anyBad) return;
    var S = simulate(amount, rate, hurdle, returns);
    var profit = S.nav - amount;
    $("cNav").textContent = nf(S.nav);
    $("cProfit").textContent = signed(profit);
    $("cProfit").className = "num " + (profit > 0 ? "pos" : profit < 0 ? "neg" : "");
    $("cFees").textContent = nf(S.fees) + "  (" + nf(S.gross - amount > 0 ? S.fees / (S.gross - amount) * 100 : 0, 1) + "%)";
    $("cGross").textContent = nf(S.gross);
    $("cHwm").textContent = nf(S.rows[S.rows.length - 1].hwm);
    $("cProtected").textContent = String(S.protectedPeriods);
    draw(S, amount);
    var body = $("cTable").tBodies[0];
    while (body.firstChild) body.firstChild.remove();
    S.rows.forEach(function (r) {
      var tr = document.createElement("tr");
      [r.p ? "P" + r.p : (ar ? "البداية" : "Start"), r.p ? (r.r >= 0 ? "+" : "") + nf(r.r) : "—", nf(r.before), nf(r.fee), nf(r.nav), nf(r.hwm)].forEach(function (c, j) {
        var td = document.createElement("td");
        td.textContent = c;
        if (j === 1 && r.r < 0) td.className = "neg";
        if (j === 3 && r.fee > 0) td.className = "fee";
        tr.append(td);
      });
      body.append(tr);
    });
  }
  ["cAmount", "cFee", "cHurdle", "cReturns"].forEach(function (id) { $(id).addEventListener("input", render); });
  render();
})();
