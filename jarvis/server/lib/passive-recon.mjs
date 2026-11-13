// Passive recon (ADR-152): what a domain already publishes about itself, read with no key and no probe.
//   RDAP (RFC 7480 / 9083)        registration status, DNSSEC, dates and name servers, from rdap.org
//   Certificate Transparency      names on logged certificates, from crt.sh's public JSON
//   Security headers              the six response headers of the home page, graded 0-100
//   security.txt (RFC 9116)       Contact, Expires, Encryption and Canonical at /.well-known/security.txt
// The parsers are pure, read their input once with simple bounded patterns, and are inlined into the page.
// createPassiveRecon fetches through fetch-public.mjs (SSRF shield, 3 redirects, 2 MB, 10 s, robots.txt for
// the site's own paths). Nothing is scanned, guessed or sent beyond these four GETs. The same parsers are in
// .claude/skills/replica-passive-recon/passive_recon.py.

export const RECON_LIMITS = { ctRows: 5000, names: 200, sectxtBytes: 32768, findings: 40 };
const DAY = 86400000;
const finding = (level, id, text, value) => (value === undefined ? { level, id, text } : { level, id, text, value });
const lower = v => String(v == null ? "" : v).trim().toLowerCase();
// crt.sh writes UTC times without a zone; Date.parse would read those as local time, so add the Z.
export const utcMs = v => { const s = String(v == null ? "" : v).trim(); return Date.parse(/T\d{2}:\d{2}/.test(s) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s + "Z" : s); };

// A domain name only: no IP address, no port, no path. Each label 1-63 of a-z, 0-9 and "-", not at either
// end; the last is letters (or an xn-- punycode label). Returns the name or null.
export function normalizeDomain(raw) {
  let s = lower(raw);
  if (s.includes("://")) { try { s = new URL(s).hostname; } catch (e) { return null; } }
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  if (s.endsWith(".")) s = s.slice(0, -1);
  if (s.length < 3 || s.length > 253 || s.includes(":")) return null;
  const labels = s.split(".");
  if (labels.length < 2) return null;
  for (const l of labels) if (!l.length || l.length > 63 || !/^[a-z0-9-]+$/.test(l) || l[0] === "-" || l[l.length - 1] === "-") return null;
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,63}$/.test(tld) || /^xn--[a-z0-9-]+$/.test(tld) ? s : null;
}

// RFC 9083 domain object.
export function parseRdap(j, now = Date.now()) {
  const out = { statuses: [], dnssec: null, registered: null, expires: null, daysLeft: null, nameservers: [], findings: [] };
  if (!j || typeof j !== "object") { out.findings.push(finding("high", "rdap-missing", "No RDAP record was returned.")); return out; }
  out.statuses = (Array.isArray(j.status) ? j.status : []).slice(0, 20).map(lower);
  if (j.secureDNS && typeof j.secureDNS.delegationSigned === "boolean") out.dnssec = j.secureDNS.delegationSigned;
  for (const e of (Array.isArray(j.events) ? j.events : []).slice(0, 50)) {
    const t = utcMs(e && e.eventDate);
    if (Number.isNaN(t)) continue;
    const a = lower(e.eventAction);
    if (a === "registration") out.registered = new Date(t).toISOString();
    else if (a === "expiration") out.expires = new Date(t).toISOString();
  }
  out.nameservers = (Array.isArray(j.nameservers) ? j.nameservers : []).slice(0, 20).map(n => lower(n && n.ldhName)).filter(Boolean);
  const keys = new Set(out.statuses.map(s => s.replace(/\s+/g, "")));
  if (out.expires) {
    out.daysLeft = Math.floor((Date.parse(out.expires) - now) / DAY);
    if (out.daysLeft < 0) out.findings.push(finding("high", "domain-expired", "The domain expired " + -out.daysLeft + " days ago."));
    else if (out.daysLeft <= 30) out.findings.push(finding("medium", "domain-expiring", "The domain expires in " + out.daysLeft + " days."));
  } else out.findings.push(finding("low", "rdap-no-expiry", "The record gives no expiry date."));
  if (out.dnssec === false) out.findings.push(finding("medium", "dnssec-off", "DNSSEC is off: the delegation is not signed."));
  else if (out.dnssec === null) out.findings.push(finding("low", "dnssec-unknown", "The record does not say whether DNSSEC is on."));
  if (keys.has("redemptionperiod") || keys.has("pendingdelete")) out.findings.push(finding("high", "status-deleting", "The domain is being deleted."));
  if (keys.has("clienthold") || keys.has("serverhold")) out.findings.push(finding("high", "status-hold", "The domain is on hold and does not resolve."));
  if (!keys.has("clienttransferprohibited") && !keys.has("servertransferprohibited")) out.findings.push(finding("low", "transfer-unlocked", "No transfer lock on the domain."));
  return out;
}

// crt.sh JSON rows: { name_value (names split by newlines), not_after, issuer_name }. One pass, Sets for
// the names, at most RECON_LIMITS.ctRows rows read.
export function parseCt(rows, now = Date.now()) {
  const all = Array.isArray(rows) ? rows : [];
  const list = all.slice(0, RECON_LIMITS.ctRows);
  const names = new Set(), wild = new Set(), issuers = new Map();
  let expired = 0, active = 0, expiringSoon = 0;
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const na = utcMs(r.not_after);
    if (!Number.isNaN(na)) { if (na < now) expired++; else { active++; if (na - now < 14 * DAY) expiringSoon++; } }
    for (const part of String(r.name_value == null ? "" : r.name_value).split("\n")) {
      const n = lower(part);
      if (!n || n.length > 253) continue;
      names.add(n);
      if (n.startsWith("*.")) wild.add(n);
    }
    const iss = String(r.issuer_name == null ? "" : r.issuer_name).slice(0, 120);
    if (iss) issuers.set(iss, (issuers.get(iss) || 0) + 1);
  }
  const findings = [];
  if (all.length > list.length) findings.push(finding("low", "ct-truncated", "Only the first " + list.length + " certificates were read."));
  const broad = [...wild].filter(w => !w.slice(2).includes("."));
  if (broad.length) findings.push(finding("high", "ct-broad-wildcard", "A wildcard covers a whole top-level domain: " + broad[0]));
  if (wild.size >= 5) findings.push(finding("medium", "ct-many-wildcards", "Wildcard names on certificates: " + wild.size + "."));
  else if (wild.size) findings.push(finding("low", "ct-wildcards", "Wildcard names on certificates: " + wild.size + "."));
  if (expiringSoon) findings.push(finding("medium", "ct-expiring", "Certificates in use that expire within 14 days: " + expiringSoon + "."));
  if (list.length && !active) findings.push(finding("medium", "ct-no-active", "No logged certificate is still valid."));
  const top = [...issuers].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([name, count]) => ({ name, count }));
  return { certificates: list.length, nameCount: names.size, names: [...names].sort().slice(0, RECON_LIMITS.names), wildcards: [...wild].sort(), expired, active, expiringSoon, issuers: top, findings };
}

// The six headers, 100 points in all. CSP loses points for 'unsafe-inline', 'unsafe-eval', a bare * source
// and no default-src; HSTS earns full points at a year or more.
export const HEADER_POINTS = [["content-security-policy", 30], ["strict-transport-security", 20], ["permissions-policy", 15], ["cross-origin-opener-policy", 15], ["x-content-type-options", 10], ["referrer-policy", 10]];
const SAFE_REFERRER = new Set(["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"]);
export function gradeHeaders(headers) {
  const h = headers && typeof headers === "object" ? headers : {};
  const get = k => { const v = h[k]; return v == null ? "" : String(Array.isArray(v) ? v.join(", ") : v).trim().slice(0, 2000); };
  const checks = HEADER_POINTS.map(([name, max]) => {
    const v = get(name), lv = v.toLowerCase();
    let points = 0, fix = null;
    if (!v) fix = "missing";
    else if (name === "content-security-policy") {
      points = max;
      const tokens = new Set(lv.split(/[\s;]+/));
      if (tokens.has("'unsafe-inline'")) { points -= 8; fix = "unsafe-inline"; }
      if (tokens.has("'unsafe-eval'")) { points -= 8; fix = fix || "unsafe-eval"; }
      if (tokens.has("*")) { points -= 8; fix = fix || "wildcard-source"; }
      if (!lv.includes("default-src")) { points -= 6; fix = fix || "no-default-src"; }
      points = Math.max(0, points);
    } else if (name === "strict-transport-security") {
      const m = /max-age\s*=\s*"?(\d{1,12})/.exec(lv), age = m ? Number(m[1]) : 0;
      points = age >= 31536000 ? max : age >= 15552000 ? 15 : age > 0 ? 8 : 0;
      fix = age < 31536000 ? "short-max-age" : !lv.includes("includesubdomains") ? "no-subdomains" : null;
    } else if (name === "x-content-type-options") { points = lv === "nosniff" ? max : 3; fix = lv === "nosniff" ? null : "not-nosniff"; }
    else if (name === "referrer-policy") { const last = lv.split(",").map(x => x.trim()).filter(Boolean).pop() || ""; points = SAFE_REFERRER.has(last) ? max : last === "unsafe-url" ? 0 : 5; fix = SAFE_REFERRER.has(last) ? null : "weak-referrer"; }
    else if (name === "cross-origin-opener-policy") { points = lv === "same-origin" ? max : lv === "same-origin-allow-popups" ? 10 : 3; fix = lv === "same-origin" ? null : "weak-coop"; }
    else points = max;
    return { header: name, present: !!v, value: v.slice(0, 300), points, max, fix };
  });
  const score = checks.reduce((n, c) => n + c.points, 0);
  return { score, grade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F", checks };
}

// RFC 9116, line by line. A PGP-signed file is read between the signed-message header and the signature.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
export function parseSecurityTxt(text, now = Date.now()) {
  const out = { present: text != null, fields: {}, contacts: [], expires: null, valid: false, findings: [] };
  if (text == null) { out.findings.push(finding("high", "sectxt-missing", "No security.txt at /.well-known/security.txt.")); return out; }
  let inSig = false;
  for (const line of String(text).slice(0, RECON_LIMITS.sectxtBytes).split("\n")) {
    const t = line.trim();
    if (t.startsWith("-----BEGIN PGP SIGNATURE")) { inSig = true; continue; }
    if (inSig) { if (t.startsWith("-----END PGP SIGNATURE")) inSig = false; continue; }
    if (!t || t[0] === "#" || t.startsWith("-----BEGIN PGP SIGNED MESSAGE") || t.toLowerCase().startsWith("hash:")) continue;
    const i = t.indexOf(":");
    if (i < 1) continue;
    const key = t.slice(0, i).trim().toLowerCase(), val = t.slice(i + 1).trim();
    const list = out.fields[key] || (out.fields[key] = []);
    if (list.length < 20) list.push(val.slice(0, 300));
  }
  out.contacts = out.fields.contact || [];
  if (!out.contacts.length) out.findings.push(finding("high", "sectxt-no-contact", "No Contact line; RFC 9116 requires one."));
  for (const c of out.contacts) {
    const lc = c.toLowerCase();
    if (lc.startsWith("http://")) out.findings.push(finding("medium", "sectxt-contact-http", "A Contact link uses plain http.", c));
    else if (!lc.startsWith("mailto:") && !lc.startsWith("https://") && !lc.startsWith("tel:")) out.findings.push(finding("medium", "sectxt-contact-uri", "A Contact is not a mailto:, https: or tel: link.", c));
  }
  const exp = out.fields.expires || [];
  if (!exp.length) out.findings.push(finding("high", "sectxt-no-expires", "No Expires line; RFC 9116 requires one."));
  else {
    if (exp.length > 1) out.findings.push(finding("medium", "sectxt-many-expires", "Expires appears " + exp.length + " times; it must appear once."));
    const t = ISO.test(exp[0]) ? Date.parse(exp[0]) : NaN;
    if (Number.isNaN(t)) out.findings.push(finding("high", "sectxt-bad-expires", "Expires is not an ISO 8601 date and time: " + exp[0]));
    else {
      out.expires = new Date(t).toISOString();
      if (t < now) out.findings.push(finding("high", "sectxt-expired", "Expires is in the past: " + out.expires.slice(0, 10)));
      else if (t - now > 366 * DAY) out.findings.push(finding("low", "sectxt-long-expiry", "Expires is more than a year ahead; RFC 9116 advises less."));
    }
  }
  const can = out.fields.canonical || [];
  if (can.length && !can.some(c => c.toLowerCase().startsWith("https://"))) out.findings.push(finding("low", "sectxt-canonical-http", "No Canonical link uses https."));
  if (!(out.fields.encryption || []).length) out.findings.push(finding("low", "sectxt-no-encryption", "No Encryption key is named."));
  out.valid = !out.findings.some(f => f.level === "high");
  return out;
}

// One report from the four parts; a part that could not be read is a stated gap, never a guess.
export function reconReport({ domain, rdap, ct, headers, securityTxt, gaps = [], now = Date.now(), sample = false }) {
  const r = {
    domain, at: new Date(now).toISOString(), sample,
    rdap: rdap === undefined ? null : parseRdap(rdap, now),
    ct: ct === undefined ? null : parseCt(ct, now),
    headers: headers === undefined ? null : gradeHeaders(headers),
    securityTxt: securityTxt === undefined ? null : parseSecurityTxt(securityTxt, now),
    gaps: gaps.slice(0, 4),
  };
  const all = ["rdap", "ct", "securityTxt"].flatMap(k => (r[k] ? r[k].findings : []));
  r.counts = { high: all.filter(f => f.level === "high").length, medium: all.filter(f => f.level === "medium").length, low: all.filter(f => f.level === "low").length };
  return r;
}

// Teaching example for the sample page (no network): made-up records for the reserved example.com.
export const SAMPLE_NOW = Date.parse("2026-11-07T00:00:00Z");
export const SAMPLE_INPUT = {
  domain: "example.com",
  rdap: { objectClassName: "domain", ldhName: "EXAMPLE.COM", status: ["client delete prohibited", "client update prohibited"], secureDNS: { delegationSigned: false },
    events: [{ eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" }, { eventAction: "expiration", eventDate: "2026-11-28T04:00:00Z" }],
    nameservers: [{ ldhName: "A.IANA-SERVERS.NET" }, { ldhName: "B.IANA-SERVERS.NET" }] },
  ct: [
    { name_value: "example.com\nwww.example.com", not_after: "2027-03-01T23:59:59", issuer_name: "C=US, O=Example CA, CN=Example TLS RSA CA" },
    { name_value: "*.example.com\nexample.com", not_after: "2026-11-15T23:59:59", issuer_name: "C=US, O=Example CA, CN=Example TLS RSA CA" },
    { name_value: "mail.example.com", not_after: "2025-01-10T23:59:59", issuer_name: "C=US, O=Other CA, CN=Other DV CA" },
  ],
  headers: { "strict-transport-security": "max-age=15552000", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'", "referrer-policy": "no-referrer-when-downgrade" },
  securityTxt: "Contact: mailto:security@example.com\nContact: security team, room 4\nExpires: 2026-06-30T00:00:00Z\n",
};
export const sampleReport = () => reconReport({ ...SAMPLE_INPUT, now: SAMPLE_NOW, sample: true });

// Live: four GETs through the injected fetcher (fetchPublicResource on the server, a stub in tests).
export function createPassiveRecon({ fetchResource, now = () => Date.now() }) {
  const json = text => { try { return JSON.parse(text); } catch (e) { throw new Error("The answer is not JSON."); } };
  return async function run(raw) {
    const domain = normalizeDomain(raw);
    if (!domain) { const e = new Error("Give a domain name such as example.com: no address, port or path."); e.status = 400; throw e; }
    const gaps = [];
    const part = async (check, fn) => { try { return await fn(); } catch (e) { gaps.push({ check, error: String(e && e.message || e).slice(0, 200) }); return undefined; } };
    const [rdap, ct, headers, securityTxt] = await Promise.all([
      part("rdap", async () => { const r = await fetchResource("https://rdap.org/domain/" + domain, { accept: "application/rdap+json, application/json" }); if (r.status === 404) return null; if (r.status !== 200) throw new Error("RDAP answered HTTP " + r.status + "."); return json(r.text); }),
      part("ct", async () => { const r = await fetchResource("https://crt.sh/?q=" + encodeURIComponent("%." + domain) + "&output=json", { accept: "application/json" }); if (r.status !== 200) throw new Error("crt.sh answered HTTP " + r.status + "."); return json(r.text); }),
      part("headers", async () => (await fetchResource("https://" + domain + "/", { accept: "text/html", robots: true })).headers),
      part("securityTxt", async () => { const r = await fetchResource("https://" + domain + "/.well-known/security.txt", { accept: "text/plain", robots: true }); return r.status === 200 && /text\/plain/i.test(String(r.headers["content-type"] || "")) ? r.text : null; }),
    ]);
    return reconReport({ domain, rdap, ct, headers, securityTxt, gaps, now: now() });
  };
}
