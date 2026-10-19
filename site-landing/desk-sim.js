// NABD locked-base simulator and SHA-256 receipt verifier (ADR-091).
// Browser-only math: it sends nothing, stores nothing and accepts no money.
// Each trade return moves the trading balance; profit above the locked base is swept to the safe
// vault, either after every profitable trade (mode A) or once the balance reaches a target (mode B).
// Every step issues a receipt whose hash covers its content and the previous hash.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  if (!$("sBase")) return;
  var ar = document.documentElement.lang === "ar";
  var T = function (a, e) { return ar ? a : e; };
  var nf = function (v, d) { d = d === undefined ? 2 : d; return Number.isFinite(v) ? new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : "—"; };
  var h = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  var NS = "http://www.w3.org/2000/svg";
  function mk(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  var GENESIS = new Array(65).join("0");
  var FEE = 0.001;

  // Same canonical form as the Ops Room ledger: keys sorted, numbers rounded to 8 decimals, "hash" left out.
  function canon(v) {
    if (typeof v === "number") return Number.isFinite(v) ? Number(v.toFixed(8)) : null;
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") { var o = {}; Object.keys(v).sort().forEach(function (k) { if (k !== "hash") o[k] = canon(v[k]); }); return o; }
    return v;
  }
  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }
  function seal(list, r) {
    r.prev_hash = list.length ? list[list.length - 1].hash : GENESIS;
    r.seq = list.length + 1;
    r.invoice = "SIM-" + String(r.seq).padStart(5, "0");
    return sha256(JSON.stringify(canon(r))).then(function (x) { r.hash = x; list.push(r); });
  }
  function verify(list) {
    var prev = GENESIS, i = 0;
    function step() {
      if (i >= list.length) return Promise.resolve({ ok: true, n: list.length, tip: prev });
      var r = list[i];
      if (!r || typeof r !== "object" || typeof r.hash !== "string") return Promise.resolve({ ok: false, at: i, why: T("الإيصال ناقص", "receipt is malformed") });
      if (r.prev_hash !== prev) return Promise.resolve({ ok: false, at: i, why: T("بصمة السابق لا تطابق", "prev_hash does not match the receipt before it") });
      return sha256(JSON.stringify(canon(r))).then(function (x) {
        if (x !== r.hash) return { ok: false, at: i, why: T("تغيّر محتواه بعد إصداره", "content was changed after it was issued") };
        prev = r.hash; i++;
        return step();
      });
    }
    return step();
  }

  function simulate(base, mode, target, returns) {
    var trading = base, safe = 0, sweeps = 0, swept = 0, rows = [], events = [];
    events.push({ type: "LOCK", amount: base, before: { trading: 0, safe: 0 }, after: { trading: base, safe: 0 }, reason: T("تعليق المبلغ الأساسي", "Lock the base") });
    returns.forEach(function (r, i) {
      var before = trading;
      trading = Math.max(0, trading * (1 + r / 100) - trading * FEE * 2);
      events.push({ type: "SIM_TRADE", amount: trading - before, before: { trading: before, safe: safe }, after: { trading: trading, safe: safe }, reason: T("صفقة افتراضية ", "Hypothetical trade ") + nf(r, 1) + "%" });
      var over = trading - base, out = 0;
      if (over > 0.005 && (mode === "every" || trading >= target)) {
        out = over; trading -= over; safe += over; sweeps++; swept += over;
        events.push({ type: "SWEEP", amount: out, before: { trading: trading + out, safe: safe - out }, after: { trading: trading, safe: safe }, reason: T("ترحيل الربح فوق المبلغ المعلّق", "Sweep profit above the locked base") });
      }
      rows.push({ i: i + 1, r: r, before: before, after: trading + out, out: out, trading: trading, safe: safe });
    });
    return { rows: rows, events: events, trading: trading, safe: safe, sweeps: sweeps, swept: swept };
  }

  var ledger = [];
  function setText(id, v) { $(id).textContent = v; }
  function draw(S, base) {
    var svg = $("sChart");
    while (svg.firstChild) svg.firstChild.remove();
    var W = 720, H = 220, L = 64, R = 14, Tp = 14, B = 28;
    var pts = [{ trading: base, safe: 0 }].concat(S.rows);
    var hi = Math.max.apply(null, pts.map(function (p) { return p.trading + p.safe; }).concat([base * 1.1]));
    var x = function (i) { return L + i * (W - L - R) / Math.max(1, pts.length - 1); };
    var y = function (v) { return Tp + (hi - v) / hi * (H - Tp - B); };
    [0, 0.5, 1].forEach(function (f) {
      var v = hi * f;
      svg.append(mk("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), "class": "grid-line" }), mk("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", "class": "axis" }, nf(v, 0)));
    });
    svg.append(mk("line", { x1: L, x2: W - R, y1: y(base), y2: y(base), "class": "l-hwm" }));
    var path = function (f) { return pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(f(p)).toFixed(1); }).join(" "); };
    svg.append(mk("path", { d: path(function (p) { return p.trading + p.safe; }), "class": "l-gross" }), mk("path", { d: path(function (p) { return p.safe; }), "class": "l-net" }));
  }
  function renderLedger() {
    var tb = $("sLedger").tBodies[0];
    tb.replaceChildren.apply(tb, ledger.map(function (r) {
      var tr = h("tr");
      tr.append(h("td", "num", String(r.seq)), h("td", "", r.type), h("td", "num", nf(r.amount)), h("td", "", r.reason), h("td", "num hash", r.hash.slice(0, 16) + "…"));
      return tr;
    }));
  }
  function say(id, ok, text) { var n = $(id); n.textContent = text; n.className = "sim-status " + (ok ? "pos" : "neg"); }

  function run() {
    var base = parseFloat($("sBase").value), mode = $("sMode").value === "target" ? "target" : "every";
    var target = parseFloat($("sTarget").value);
    var returns = $("sReturns").value.split(/[,،\s]+/).filter(Boolean).map(Number);
    var bad = !(base > 0) || !returns.length || returns.some(function (r) { return !Number.isFinite(r) || r <= -100; }) || (mode === "target" && !(target > base));
    $("sError").hidden = !bad;
    if (bad) return;
    var S = simulate(base, mode, target, returns);
    setText("sLocked", nf(base));
    setText("sTrading", nf(S.trading));
    setText("sSafe", nf(S.safe));
    setText("sSweeps", String(S.sweeps));
    setText("sTotal", nf(S.trading + S.safe));
    var tb = $("sTable").tBodies[0];
    tb.replaceChildren.apply(tb, S.rows.map(function (r) {
      var tr = h("tr");
      tr.append(h("td", "num", String(r.i)), h("td", "num " + (r.r < 0 ? "neg" : "pos"), nf(r.r, 1)), h("td", "num", nf(r.before)), h("td", "num", nf(r.after)), h("td", "num", r.out ? nf(r.out) : "—"), h("td", "num", nf(r.safe)));
      return tr;
    }));
    draw(S, base);
    ledger = [];
    var chain = Promise.resolve();
    S.events.forEach(function (e) { chain = chain.then(function () { return seal(ledger, { ts: new Date().toISOString(), mode: "simulation", type: e.type, amount: e.amount, before: e.before, after: e.after, reason: e.reason }); }); });
    chain.then(function () { renderLedger(); setText("sLedgerCount", String(ledger.length)); say("sVerifyOut", true, T("سلسلة جديدة جاهزة. اضغط «تحقق» لفحصها.", "New chain ready. Press Verify to check it.")); })
      .catch(function () { say("sVerifyOut", false, T("المتصفح منع حساب البصمة هنا. افتح الصفحة من https أو من ملف محلي.", "This browser blocks hashing here. Open the page over https or from a local file.")); });
  }
  function report(r, label) {
    if (r.ok) say("sVerifyOut", true, label + T(": السلسلة سليمة، عدد الإيصالات ", ": chain intact, receipts ") + r.n + T("، البصمة الأخيرة ", ", tip ") + r.tip.slice(0, 16) + "…");
    else say("sVerifyOut", false, label + T(": السلسلة مكسورة عند الإيصال ", ": chain broken at receipt ") + (r.at + 1) + " · " + r.why);
  }

  ["sBase", "sMode", "sTarget", "sReturns"].forEach(function (id) { $(id).addEventListener("input", run); });
  $("sVerify").addEventListener("click", function () { verify(ledger).then(function (r) { report(r, T("السلسلة المعروضة", "Chain on screen")); }); });
  $("sTamper").addEventListener("click", function () {
    if (ledger.length < 2) return;
    var copy = JSON.parse(JSON.stringify(ledger));
    copy[1].amount = copy[1].amount + 1;
    verify(copy).then(function (r) { report(r, T("نسخة عُدّل فيها الإيصال 2 بمقدار 1", "Copy with receipt 2 changed by 1")); });
  });
  $("sFile").addEventListener("change", function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { say("sVerifyOut", false, T("الملف أكبر من 5 ميغابايت", "File is larger than 5 MB")); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var data;
      try { data = JSON.parse(String(rd.result)); } catch (e) { say("sVerifyOut", false, T("الملف ليس JSON صالحاً", "The file is not valid JSON")); return; }
      var list = data && data.format === "omega-receipt-chain-v1" && Array.isArray(data.receipts) ? data.receipts : null;
      if (!list) { say("sVerifyOut", false, T("الملف ليس سلسلة إيصالات OMEGA", "The file is not an OMEGA receipt chain")); return; }
      verify(list).then(function (r) { report(r, f.name); });
    };
    rd.readAsText(f);
  });
  run();
})();
