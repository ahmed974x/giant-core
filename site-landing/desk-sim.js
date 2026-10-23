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
  // SHA-256 in plain JavaScript (FIPS 180-4) for pages that are not a secure context, for example plain
  // http on the home network, where crypto.subtle is undefined (ADR-096). Same output as WebCrypto.
  var K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256Pure(bytes) {
    var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(total), i, off;
    m.set(bytes); m[len] = 0x80;
    var dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len << 3) >>> 0);
    var H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64);
    for (off = 0; off < total; off += 64) {
      for (i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        w[i] = (w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10))) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
        var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
    }
    var out = new Uint8Array(32), ov = new DataView(out.buffer);
    for (i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
    return out;
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
  function sha256(text) {
    var bytes = new TextEncoder().encode(text);
    if (window.isSecureContext && window.crypto && crypto.subtle) return crypto.subtle.digest("SHA-256", bytes).then(hex);
    return Promise.resolve(hex(sha256Pure(bytes)));
  }
  function seal(list, r) {
    r.prev_hash = list.length ? list[list.length - 1].hash : GENESIS;
    r.seq = list.length + 1;
    r.invoice = "SIM-" + String(r.seq).padStart(5, "0");
    return sha256(JSON.stringify(canon(r))).then(function (x) { r.hash = x; list.push(r); });
  }
  // Merkle checkpoints from the Ops Room (ADR-096): each one must follow the one before it and match its
  // own hash; the first kept receipt then links to the last checkpoint's last_hash.
  function verifyCheckpoints(cps) {
    var prev = GENESIS, prevCp = GENESIS, seq = 0, i = 0;
    function step() {
      if (i >= cps.length) return Promise.resolve({ ok: true, tip: prev, folded: seq });
      var c = cps[i];
      if (!c || c.format !== "omega-merkle-checkpoint-v1" || c.first_prev_hash !== prev || c.prev_checkpoint !== prevCp || c.from_seq !== seq + 1 || c.count !== c.to_seq - c.from_seq + 1)
        return Promise.resolve({ ok: false, at: i, why: T("نقطة التحقق لا تتبع السابقة", "checkpoint does not follow the one before it") });
      return sha256(JSON.stringify(canon(c))).then(function (x) {
        if (x !== c.hash) return { ok: false, at: i, why: T("تغيّرت نقطة التحقق بعد إنشائها", "checkpoint was changed after it was made") };
        prev = c.last_hash; prevCp = c.hash; seq = c.to_seq; i++;
        return step();
      });
    }
    return step();
  }
  function verify(list, cps) {
    return verifyCheckpoints(cps || []).then(function (b) {
      if (!b.ok) return { ok: false, at: -1, why: T("نقطة التحقق ", "checkpoint ") + (b.at + 1) + " · " + b.why };
      return verifyList(list, b.tip, b.folded);
    });
  }
  function verifyList(list, start, folded) {
    var prev = start, i = 0;
    function step() {
      if (i >= list.length) return Promise.resolve({ ok: true, n: list.length, folded: folded, tip: prev });
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

  var ledger = [], runs = 0;
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
    // ADR-102: spline lines, a glow under the total, glowing dots where a sweep moved profit, glass loupe.
    var V = window.OMEGA_VIS;
    var tot = function (p) { return p.trading + p.safe; }, safeOf = function (p) { return p.safe; };
    var line = function (f) { return pts.map(function (p, i) { return [x(i), y(f(p))]; }); };
    var path = function (f) { return V ? V.spline(line(f)) : line(f).map(function (q, i) { return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" "); };
    var fill = V ? mk("path", { d: V.area(line(tot), H - B), "class": "v-area" }) : null;
    if (fill) svg.append(fill);
    svg.append(mk("path", { d: path(tot), "class": "l-gross" }), mk("path", { d: path(safeOf), "class": "l-net" }));
    if (!V) return;
    fill.setAttribute("fill", V.gradient(svg, "blue"));
    pts.forEach(function (p, i) { if (p.out > 0) svg.append(V.glow(x(i), y(p.safe), "green", 4)); });
    V.loupe(svg, {
      W: W, H: H, T: Tp, B: B, n: pts.length, x: x,
      rows: function (i) { var p = pts[i]; return [[T("الصفقة", "Trade"), i ? "#" + i : T("البداية", "start")], [T("المجموع", "Total"), nf(tot(p))], [T("المحفظة المحمية", "Safe vault"), nf(p.safe)], [T("مُرحّل", "Swept"), nf(p.out || 0)]]; },
      dots: function (i) { return [[y(tot(pts[i])), "blue"], [y(pts[i].safe), "green"]]; }
    });
  }
  function renderLedger() {
    var tb = $("sLedger").tBodies[0];
    tb.replaceChildren.apply(tb, ledger.map(function (r) {
      var tr = h("tr");
      tr.append(h("td", "num", String(r.seq)), h("td", "", r.type), h("td", "num", nf(r.amount)), h("td", "reason", r.reason), h("td", "num hash", r.hash.slice(0, 16) + "…"));
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
    // ADR-113: each run builds its own list and shows it only if no newer run started meanwhile.
    var list = [], token = ++runs;
    var chain = Promise.resolve();
    S.events.forEach(function (e) { chain = chain.then(function () { return seal(list, { ts: new Date().toISOString(), mode: "simulation", type: e.type, amount: e.amount, before: e.before, after: e.after, reason: e.reason }); }); });
    chain.then(function () { if (token !== runs) return; ledger = list; renderLedger(); setText("sLedgerCount", String(ledger.length)); say("sVerifyOut", true, T("سلسلة جديدة جاهزة. اضغط «تحقق» لفحصها.", "New chain ready. Press Verify to check it.")); })
      .catch(function () { if (token === runs) say("sVerifyOut", false, T("تعذّر حساب البصمة. أعد تحميل الصفحة، وإذا تكرر الخطأ جرّب متصفحاً آخر.", "Hashing failed. Reload the page; if it happens again, try another browser.")); });
  }
  function report(r, label) {
    if (r.ok) say("sVerifyOut", true, label + T(": السلسلة سليمة، عدد الإيصالات ", ": chain intact, receipts ") + r.n + (r.folded ? T(" بعد نقاط تحقق تضم ", " after checkpoints holding ") + r.folded : "") + T("، البصمة الأخيرة ", ", tip ") + r.tip.slice(0, 16) + "…");
    else if (r.at < 0) say("sVerifyOut", false, label + T(": السلسلة مكسورة · ", ": chain broken · ") + r.why);
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
      try { data = JSON.parse(String(rd.result)); } catch (e) { say("sVerifyOut", false, T("الملف ليس JSON صالحاً. صدّر السلسلة من غرفة العمليات واختر ذلك الملف.", "The file is not valid JSON. Export the chain from the Ops Room and pick that file.")); return; }
      var list = data && data.format === "omega-receipt-chain-v1" && Array.isArray(data.receipts) ? data.receipts : null;
      if (!list) { say("sVerifyOut", false, T("الملف ليس سلسلة إيصالات OMEGA (omega-receipt-chain-v1). اختر ملف التصدير من غرفة العمليات.", "The file is not an OMEGA receipt chain (omega-receipt-chain-v1). Pick the export from the Ops Room.")); return; }
      verify(list, Array.isArray(data.checkpoints) ? data.checkpoints : []).then(function (r) { report(r, f.name); });
    };
    rd.readAsText(f);
  });
  run();
})();
