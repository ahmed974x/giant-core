// Self-shield (ADR-122): the rules OMEGA uses to attack itself in a sandbox and to judge the answers. Pure functions,
// no network, no file access; scripts/self-shield.mjs runs them against a throwaway copy of the local data proxy
// (127.0.0.1, a random port, a temporary home and cache, OMEGA_OFFLINE=1 so nothing reaches the internet) and over
// the repository's own pages and files. Tests: scripts/test-self-shield.mjs.
//
// Scope, fixed in code: the only network target is the sandboxed proxy on the loopback address that the runner
// started itself. There is no option for another host, no port scan, no flood: every probe is one request (the slow
// header probe holds one connection), and the whole run sends about forty requests.
//
// Contents
//   PROBES                 the attack catalogue: id, area, severity, the request, and the fix if the answer is wrong
//   judge(probe, answer)   pass / fail with the evidence, by fixed rules
//   lintPage(name, html)   static checks of one page: CSP directives, inline handlers, style attributes, SRI, rel
//   scanSecrets(name, txt) key-shaped strings (AWS, GitHub, Google, Groq, Cerebras, Anthropic, OpenAI, Slack, PEM)
//   score(findings)        0-100 posture score and the verdict
//   report(...) / markdown the omega-self-shield-v1 report and its Arabic Markdown
export const OMEGA_SHIELD = (() => {
  "use strict";
  const VERSION = "omega-self-shield-v1";
  const SEV = Object.freeze({ critical: 40, high: 20, medium: 8, low: 3 });
  const SEV_AR = Object.freeze({ critical: "حرجة", high: "عالية", medium: "متوسطة", low: "منخفضة" });

  /* ---------------- dynamic probes ---------------- */
  // Each probe is one request to the sandbox. `expect` is checked by judge(). `fix` says what closes the hole.
  // `raw` sends the path byte for byte (no URL normalising), which is what an attacker's client would do.
  const P = (id, area, severity, ar, req, expect, fix) => Object.freeze({ id, area, severity, ar, req: Object.freeze(req), expect: Object.freeze(expect), fix });
  const notOk = { statusNot: [200, 204, 206, 301, 302] };
  const PROBES = Object.freeze([
    // Path traversal and file disclosure through the static server
    P("trav-dotdot", "files", "critical", "قراءة ملف خارج المجلد بـ ../", { path: "/omega-ops-room-v1/../package.json", raw: true }, notOk, "staticFile() must refuse any path part that starts with a dot"),
    P("trav-encoded", "files", "critical", "تجاوز المجلد بترميز %2e%2e", { path: "/omega-ops-room-v1/%2e%2e/%2e%2e/etc/passwd", raw: true }, notOk, "decode before checking the parts, refuse dot parts"),
    P("trav-slash", "files", "critical", "تجاوز المجلد بشرطة مرمّزة %2f", { path: "/omega-ops-room-v1/..%2f..%2fpackage.json", raw: true }, notOk, "decode before splitting into parts"),
    P("trav-backslash", "files", "critical", "تجاوز المجلد بشرطة خلفية (ويندوز)", { path: "/omega-ops-room-v1/..%5c..%5cpackage.json", raw: true }, notOk, "refuse parts that contain a backslash"),
    P("trav-null", "files", "high", "قطع المسار ببايت صفري", { path: "/omega-ops-room-v1/omega-ops-room.html%00.png", raw: true }, notOk, "refuse paths with control characters"),
    P("file-dotgit", "files", "critical", "قراءة مجلد git", { path: "/omega-ops-room-v1/.git/config", raw: true }, notOk, "refuse dotfiles and dot folders"),
    P("file-source", "files", "high", "قراءة شيفرة السيرفر نفسه", { path: "/scripts/omega-data-proxy.mjs", raw: true }, notOk, "serve only the page folders, never scripts/"),
    P("file-env", "files", "critical", "قراءة ملف أسرار .env", { path: "/web/.env.local", raw: true }, notOk, "serve only the page folders, never web/"),
    P("file-data", "files", "high", "قراءة ملفات data الخاصة", { path: "/data/notes.json", raw: true }, notOk, "serve only data/public-intel-snapshot.json from data/"),
    // DNS rebinding and cross-origin reads
    P("host-rebind", "origin", "high", "إعادة ربط DNS باسم مضيف غريب", { path: "/health", headers: { Host: "evil.example:8796" } }, { status: [421] }, "check Host against the allowed names before routing"),
    P("cors-evil", "origin", "high", "قراءة البيانات من موقع غريب", { path: "/health", headers: { Origin: "https://evil.example" } }, { status: [403], noHeader: ["access-control-allow-origin"] }, "answer CORS only for local origins"),
    P("cors-evil-sub", "origin", "high", "موقع يتنكر باسم localhost", { path: "/health", headers: { Origin: "http://localhost.evil.example" } }, { status: [403], noHeader: ["access-control-allow-origin"] }, "anchor the origin pattern at both ends"),
    P("pna-null", "origin", "medium", "صفحة من موقع عام داخل iframe معزول (Origin null) تطلب إذن الشبكة الخاصة", { method: "OPTIONS", path: "/health", headers: { Origin: "null", "Access-Control-Request-Method": "GET", "Access-Control-Request-Private-Network": "true" } },
      { noHeader: ["access-control-allow-private-network"] }, "send Access-Control-Allow-Private-Network only to http(s) loopback origins; file:// pages are local already and need no grant"),
    // Server-side request forgery through the research route
    P("ssrf-host", "ssrf", "critical", "إجبار السيرفر على طلب موقع غريب", { path: "/research/openalex?url=" + encodeURIComponent("https://evil.example/works") }, { status: [400] }, "OMEGA_RESEARCH.allowed(): fixed host and path per source"),
    P("ssrf-loopback", "ssrf", "critical", "إجبار السيرفر على طلب خدمة داخلية", { path: "/research/openalex?url=" + encodeURIComponent("http://127.0.0.1:11434/api/tags") }, { status: [400] }, "https only, fixed host"),
    P("ssrf-userinfo", "ssrf", "high", "خداع المضيف بـ user@host", { path: "/research/openalex?url=" + encodeURIComponent("https://api.openalex.org@evil.example/works") }, { status: [400] }, "parse with URL and compare the hostname"),
    P("ssrf-proto", "ssrf", "high", "اسم مصدر من نموذج الكائن (__proto__)", { path: "/research/constructor?url=" + encodeURIComponent("https://api.openalex.org/works") }, { status: [400, 404] }, "own-property lookup of the source"),
    P("ssrf-port", "ssrf", "high", "منفذ غير معتاد على مضيف مسموح", { path: "/research/crossref?url=" + encodeURIComponent("https://api.crossref.org:8443/works") }, { status: [400] }, "refuse an explicit port"),
    // Local model bridge
    P("llm-null", "llm", "high", "صفحة من القرص أو iframe تستعمل النموذج المحلي", { method: "POST", path: "/llm/ollama/plan", headers: { Origin: "null", "Content-Type": "application/json" }, body: "{\"goal\":\"x\"}" }, { status: [403] }, "llmOrigin(): loopback http origins only, never null"),
    P("llm-evil", "llm", "high", "موقع غريب يستعمل النموذج المحلي", { method: "POST", path: "/llm/ollama/explain", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{\"facts\":[\"x\"]}" }, { status: [403] }, "refuse foreign origins before reading the body"),
    P("llm-simple", "llm", "medium", "طلب بسيط بلا preflight (text/plain)", { method: "POST", path: "/llm/ollama/plan", headers: { "Content-Type": "text/plain" }, body: "{\"goal\":\"x\"}" }, { status: [415] }, "require application/json so every cross-site call needs a preflight"),
    P("llm-big", "llm", "medium", "جسم طلب ضخم للنموذج المحلي", { method: "POST", path: "/llm/ollama/plan", headers: { "Content-Type": "application/json" }, body: "{\"goal\":\"" + "x".repeat(4000) + "\"}" }, { status: [413] }, "readBody() caps the body"),
    // Methods, headers, redirects, errors
    P("method-put", "http", "low", "طريقة PUT", { method: "PUT", path: "/health" }, { status: [405] }, "GET only outside /llm/"),
    P("method-trace", "http", "low", "طريقة TRACE", { method: "TRACE", path: "/health" }, { status: [405] }, "GET only outside /llm/"),
    P("redir-open", "http", "medium", "إعادة توجيه مفتوحة إلى موقع آخر", { path: "/omega-ops-room.html?//evil.example" }, { locationLocal: true }, "redirect only to fixed local paths"),
    P("hdr-page", "headers", "medium", "رؤوس الحماية على الصفحات", { path: "/omega-ops-room-v1/omega-oracle.html" },
      { status: [200], header: { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "same-site" } },
      "add Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Resource-Policy: same-site to every answer"),
    P("hdr-api", "headers", "low", "رؤوس الحماية على واجهات البيانات", { path: "/health" }, { status: [200], header: { "x-content-type-options": "nosniff", "cache-control": "no-store", "cross-origin-resource-policy": "same-site" } }, "add Cross-Origin-Resource-Policy: same-site"),
    P("err-leak", "http", "low", "تسريب مسارات الجهاز في رسالة الخطأ", { path: "/research/openalex?url=" + encodeURIComponent("https://api.openalex.org/works?search=x") }, { bodyNot: ["/home/", "\\Users\\", "    at "] }, "send the error message only, never a stack or a file path"),
    P("url-huge", "http", "low", "عنوان طلب طوله 20 ألف حرف", { path: "/health?" + "a".repeat(20000) }, { statusNot: [200, 500] }, "keep Node's header size limit"),
    P("slow-headers", "dos", "medium", "اتصال بطيء يرسل الرؤوس حرفاً حرفاً (Slowloris، اتصال واحد)", { slow: true, path: "/health" }, { closedWithinMs: 16000 }, "server.headersTimeout ≤ 10 s and server.requestTimeout ≤ 30 s"),
    P("alive", "http", "high", "السيرفر ما زال يعمل بعد كل الهجمات", { path: "/health" }, { status: [200] }, "no probe may crash the proxy")
  ]);

  // judge(): the answer is {status, headers (lower-case keys), body, closedMs, error}.
  function judge(probe, a) {
    const e = probe.expect, why = [];
    if (!a || a.error) return { id: probe.id, ok: !!e.closedWithinMs && a && a.closedMs !== undefined && a.closedMs <= e.closedWithinMs, evidence: a ? a.error || `closed after ${a.closedMs} ms` : "no answer" };
    const h = a.headers || {};
    if (e.status && !e.status.includes(a.status)) why.push(`HTTP ${a.status}, expected ${e.status.join(" or ")}`);
    if (e.statusNot && e.statusNot.includes(a.status)) why.push(`HTTP ${a.status} must not be served`);
    for (const k of e.noHeader || []) if (h[k] !== undefined) why.push(`header ${k}: ${String(h[k]).slice(0, 60)} must be absent`);
    for (const [k, v] of Object.entries(e.header || {})) if (String(h[k] || "").toLowerCase() !== String(v).toLowerCase()) why.push(`header ${k} is ${h[k] === undefined ? "missing" : JSON.stringify(h[k])}, expected ${v}`);
    for (const t of e.bodyNot || []) if (String(a.body || "").includes(t)) why.push(`body contains ${JSON.stringify(t)}`);
    if (e.locationLocal) { const loc = String(h.location || ""); if (loc && (!loc.startsWith("/") || loc.startsWith("//") || /^\/\\/.test(loc))) why.push(`Location ${loc.slice(0, 80)} leaves the site`); }
    if (e.closedWithinMs) { if (a.closedMs === undefined || a.closedMs > e.closedWithinMs) why.push(`connection still open after ${e.closedWithinMs} ms`); }
    return { id: probe.id, ok: !why.length, evidence: why.length ? why.join("; ") : `HTTP ${a.status ?? "closed"}${a.closedMs !== undefined ? ` after ${a.closedMs} ms` : ""}` };
  }

  /* ---------------- static checks ---------------- */
  const directive = (csp, name) => { const m = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`, "i").exec(csp || ""); return m ? m[1].trim() : null; };
  // lintPage(): findings for one HTML page. Rules from AGENTS.md §4 and DESIGN.md §8.
  function lintPage(name, html) {
    const out = [], f = (id, severity, ar, evidence, fix) => out.push({ id, area: "page", severity, ar, file: name, evidence, fix });
    const meta = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*?\scontent=(["'])([\s\S]*?)\1/i.exec(html);
    if (!meta) { f("csp-missing", "high", "الصفحة بلا سياسة أمان محتوى (CSP)", "no CSP meta", "add the strict CSP meta (AGENTS.md §4)"); return out; }
    const csp = meta[2];
    if (directive(csp, "default-src") !== "'none'") f("csp-default", "high", "default-src ليست 'none'", directive(csp, "default-src") || "absent", "default-src 'none'");
    if (/'unsafe-inline'|'unsafe-eval'|'wasm-unsafe-eval'/.test(csp)) f("csp-unsafe", "high", "CSP تسمح بشيفرة غير موثّقة", (csp.match(/'(?:wasm-)?unsafe-[a-z]+'/g) || []).join(" "), "remove unsafe-*, pin inline code by sha256");
    for (const [d, want] of [["object-src", "'none'"], ["base-uri", "'none'"], ["form-action", "'none'"]]) if (directive(csp, d) !== want) f("csp-" + d, "medium", `${d} ليست ${want}`, directive(csp, d) || "absent", `${d} ${want}`);
    for (const d of ["script-src", "connect-src", "img-src", "style-src", "font-src"]) {
      const v = directive(csp, d);
      if (v && /(^|\s)(\*|https?:|data:\s*\*|http:\/\/\*)(\s|$)/.test(v) && !(d === "img-src" && /^('self'\s+)?data:(\s|$)/.test(v)) && !(d === "font-src" && v === "data:")) f("csp-wild-" + d, "medium", `${d} تسمح بأي مضيف`, v.slice(0, 120), "name each host");
    }
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    const onAttr = /<[a-z][^>]*\son[a-z]+\s*=/i.exec(body);
    if (onAttr) f("inline-handler", "high", "معالج حدث داخل الوسم (on…=)", onAttr[0].slice(0, 80), "attach listeners in script");
    const styleAttr = /<[a-z][^>]*\sstyle\s*=/i.exec(body);
    if (styleAttr) f("style-attr", "medium", "خاصية style داخل الوسم", styleAttr[0].slice(0, 80), "use classes");
    for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) if (/^https?:/i.test(m[1]) && !/\sintegrity=/i.test(m[0])) f("sri-missing", "high", "سكربت خارجي بلا SRI", m[1].slice(0, 100), "add integrity and crossorigin");
    for (const m of body.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) if (!/rel=["'][^"']*noopener/i.test(m[0])) { f("blank-noopener", "low", "رابط نافذة جديدة بلا noopener", m[0].slice(0, 80), "rel=\"noopener noreferrer\""); break; }
    return out;
  }
  // Key shapes only, never the value. A PEM header counts only when key material follows it, so the detector tests
  // that carry a bare "BEGIN PRIVATE KEY" line are not flagged.: the finding shows the file, the line and the kind, and masks the match.
  const SECRET_RULES = Object.freeze([
    ["aws-access-key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/], ["github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/], ["github-fine-grained", /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
    ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/], ["groq-key", /\bgsk_[A-Za-z0-9]{48,}\b/], ["cerebras-key", /\bcsk-[a-z0-9]{40,}\b/], ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{30,}\b/],
    ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9]{40,}\b/], ["slack-token", /\bxox[abpr]-[A-Za-z0-9-]{20,}\b/], ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/]
  ]);
  function scanSecrets(name, text) {
    const out = [], lines = String(text).split("\n");
    for (let i = 0; i < lines.length && out.length < 5; i++) for (const [kind, re] of SECRET_RULES) {
      const m = re.exec(lines[i]);
      if (m && kind === "private-key" && !/^[A-Za-z0-9+/=]{40,}$/.test(String(lines[i + 1] || "").trim())) continue;
      if (m) out.push({ id: "secret-" + kind, area: "secrets", severity: "critical", ar: "نص يشبه مفتاحاً سرياً داخل المستودع", file: name, line: i + 1, evidence: `${kind}: ${m[0].slice(0, 4)}…${"*".repeat(8)}`, fix: "remove it, rotate the key, keep keys in the vault or dotenvx (ADR-042)" });
    }
    return out;
  }

  /* ---------------- verdict ---------------- */
  function score(findings) {
    const open = findings.filter(x => x.status === "fail");
    const lost = open.reduce((s, x) => s + (SEV[x.severity] || 0), 0);
    const value = Math.max(0, 100 - lost), worst = ["critical", "high", "medium", "low"].find(s => open.some(x => x.severity === s)) || null;
    return { value, worst, open: open.length, verdict: worst === "critical" || worst === "high" ? "block" : worst ? "watch" : "clear" };
  }
  function report(meta, findings) {
    const s = score(findings), by = k => findings.filter(x => x.status === k).length;
    return { format: VERSION, at: meta.at || null, sandbox: meta.sandbox || null, stages: meta.stages || [], score: s, pass: by("pass"), fail: by("fail"), skip: by("skip"),
      findings: findings.slice().sort((a, b) => (a.status === "fail" ? 0 : a.status === "skip" ? 1 : 2) - (b.status === "fail" ? 0 : b.status === "skip" ? 1 : 2) || (SEV[b.severity] || 0) - (SEV[a.severity] || 0)),
      scope: "Defensive self-test of this repository and its own local proxy in a sandbox (127.0.0.1, offline). No third party is contacted or tested." };
  }
  const VERDICT_AR = { clear: "سليم", watch: "يحتاج متابعة", block: "يوقف الدمج" };
  function markdown(r) {
    const L = [`# تقرير الدرع الذاتي · OMEGA self-shield`, "", `> ${r.at || ""} · الدرجة ${r.score.value}/100 · الحكم: ${VERDICT_AR[r.score.verdict]} · نجح ${r.pass} · فشل ${r.fail} · تخطّى ${r.skip}`, `> ${r.scope}`, ""];
    if (r.sandbox) L.push("## الصندوق المعزول", "", `- العنوان ${r.sandbox.url} · الشبكة الخارجية ${r.sandbox.offline ? "مقطوعة (OMEGA_OFFLINE=1)" : "؟"} · منزل ومخزن مؤقتان يُحذفان بعد الفحص`, "");
    L.push("## المراحل", "", "| المرحلة | الحالة | ملاحظة |", "|---|---|---|");
    for (const st of r.stages) L.push(`| ${st.name} | ${st.ok === true ? "✓" : st.ok === false ? "✗" : "تخطّى"} | ${st.note || ""} |`);
    L.push("", "## النتائج", "", "| الحالة | الخطورة | الفحص | الدليل | الإصلاح |", "|---|---|---|---|---|");
    const cell = t => String(t || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 220);
    for (const x of r.findings) L.push(`| ${x.status === "pass" ? "✓" : x.status === "fail" ? "✗" : "–"} | ${SEV_AR[x.severity] || x.severity} | ${cell(x.ar)} (${x.id}${x.file ? " · " + x.file + (x.line ? ":" + x.line : "") : ""}) | ${cell(x.evidence)} | ${x.status === "fail" ? cell(x.fix) : ""} |`);
    L.push("", "---", "فحص دفاعي للمستودع وللسيرفر المحلي نفسه فقط، في صندوق معزول بلا إنترنت. لا يُفحص أي طرف آخر ولا يُرسل أي شيء للخارج.");
    return L.join("\n");
  }
  return Object.freeze({ VERSION, SEV, SEV_AR, PROBES, judge, lintPage, scanSecrets, SECRET_RULES, score, report, markdown, directive });
})();
