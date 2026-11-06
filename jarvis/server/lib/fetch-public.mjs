// One careful GET of one public page (ADR-134). Used by the Studio's clean-room cloner and the
// web.read tool. Node standard library only.
//   - http(s) only, standard ports only; no credentials in the URL; no cookies sent or kept
//   - every DNS answer is checked inside the socket's own lookup, so a name cannot resolve to a
//     private, loopback, link-local or reserved address between the check and the connection
//   - robots.txt is read first and obeyed for our user agent and for *
//   - an honest user agent; no browser disguise, no retries against a refusal, no anti-bot bypass
//   - at most 3 redirects (each one checked again), 2 MB, 10 s, text/html only
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

export const USER_AGENT = "JarvisCleanClone/1.0 (local tool in giant-core; one request per click; reads structure only)";
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10000;

export class FetchError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function v4Blocked(ip) {
  const p = ip.split(".").map(Number);
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) ||
    (a === 192 && b === 0 && p[2] === 2) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && p[2] === 100) ||
    (a === 203 && b === 0 && p[2] === 113) || a >= 224;
}
// An IPv6 address as eight 16-bit groups, whatever its spelling (zero runs, a dotted IPv4 tail, a zone).
export function v6Groups(ip) {
  let x = String(ip).toLowerCase().replace(/%.*$/, "");
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(x);
  if (tail) {
    const o = tail.slice(1).map(Number);
    x = x.slice(0, tail.index) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const [head, rest] = x.includes("::") ? x.split("::") : [x, null];
  const h = head ? head.split(":") : [], r = rest ? rest.split(":") : [];
  const groups = rest === null ? h : [...h, ...Array(8 - h.length - r.length).fill("0"), ...r];
  return groups.map(g => parseInt(g || "0", 16));
}
const v4From = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");

// Private, loopback, link-local, metadata, CGNAT, documentation, multicast and reserved ranges, in every
// IPv6 form that can carry an IPv4 address (mapped ::ffff:0:0/96, compatible ::/96, SIIT ::ffff:0:0:0/96,
// NAT64 64:ff9b::/96 and 64:ff9b:1::/48, 6to4 2002::/16, Teredo 2001::/32), so neither a URL literal nor
// a DNS answer can reach 127.0.0.1, 10/8, 172.16/12, 192.168/16 or 169.254.169.254 through another spelling.
export function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) return v4Blocked(ip);
  if (!net.isIPv6(ip)) return true;
  const g = v6Groups(ip);
  if (g.length !== 8 || g.some(n => !(n >= 0 && n <= 0xffff))) return true;
  const zeros = n => g.slice(0, n).every(v => v === 0);
  if (zeros(8)) return true;                                                        // ::
  if (zeros(7) && g[7] === 1) return true;                                          // ::1
  if (zeros(5) && g[5] === 0xffff) return v4Blocked(v4From(g[6], g[7]));            // ::ffff:a.b.c.d (mapped)
  if (zeros(4) && g[4] === 0xffff && g[5] === 0) return v4Blocked(v4From(g[6], g[7])); // ::ffff:0:a.b.c.d (SIIT)
  if (zeros(6)) return true;                                                        // ::a.b.c.d (compatible, deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;                                // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g[0] === 0x2002) return true;                                                 // 6to4 carries an IPv4 address
  if (g[0] === 0x2001 && g[1] === 0) return true;                                   // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                              // documentation
  if (g[0] === 0x2001 && g[1] < 0x200) return true;                                 // other IETF special-purpose (2001::/23)
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                      // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;        // link-local, old site-local
  if ((g[0] & 0xff00) === 0xff00) return true;                                      // multicast
  if (g[0] === 0x100 && !g[1] && !g[2] && !g[3]) return true;                      // discard-only 100::/64 (ADR-146: was never true)
  return false;
}

export function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (e) { throw new FetchError("bad_url", "That is not a full address. Start it with https://"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new FetchError("bad_url", "Only http:// and https:// addresses can be read.");
  if (u.username || u.password) throw new FetchError("bad_url", "Addresses with a user name or password are refused.");
  if (u.port && !["80", "443"].includes(u.port)) throw new FetchError("bad_url", "Only the standard web ports (80 and 443) are allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !net.isIP(host)) throw new FetchError("blocked", "Local names are refused; use a public address.");
  if (/(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)) throw new FetchError("blocked", "Local and internal names are refused.");
  if (net.isIP(host) && isBlockedAddress(host)) throw new FetchError("blocked", "Private, loopback and reserved addresses are refused.");
  u.hash = "";
  return u;
}

// dns.lookup wrapper that refuses any blocked address, used by the socket itself.
export function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIP(addrs) }];
    const bad = list.find(a => isBlockedAddress(a.address));
    if (bad || !list.length) return cb(new FetchError("blocked", "The name resolves to a private or reserved address, so it is refused."));
    if (options && options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function getOnce(u, { lookup, accept }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, {
      method: "GET", lookup, timeout: TIMEOUT_MS, agent: false,
      headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Encoding": "identity" },
    }, res => {
      const chunks = [];
      let size = 0;
      res.on("data", c => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new FetchError("too_big", "The page is larger than 2 MB, so it was not read.")); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), bytes: size }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new FetchError("timeout", "The site did not answer within 10 seconds.")));
    req.on("error", e => reject(e instanceof FetchError ? e : new FetchError("network", "Could not reach the site (" + (e.code || e.message) + ").")));
    req.end();
  });
}

async function follow(url, opts) {
  let u = url;
  for (let hop = 0; hop <= 3; hop++) {
    const r = await getOnce(u, opts);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (hop === 3) throw new FetchError("redirects", "Too many redirects.");
      u = checkUrl(new URL(r.headers.location, u).toString());
      continue;
    }
    return { ...r, url: u };
  }
  throw new FetchError("redirects", "Too many redirects.");
}

// Minimal robots.txt reader: the group for our agent if present, else *. Longest match wins.
export function robotsAllows(text, path, agent = "JarvisCleanClone") {
  const groups = [];
  let cur = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2];
    if (key === "user-agent") {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val });
  }
  const mine = groups.filter(g => g.agents.some(a => a !== "*" && agent.toLowerCase().includes(a)));
  const rules = (mine.length ? mine : groups.filter(g => g.agents.includes("*"))).flatMap(g => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const pat = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (pat.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

export async function fetchPublicPage(raw, { lookup = safeLookup } = {}) {
  const u = checkUrl(raw);
  let robots = "no robots.txt";
  try {
    const r = await follow(new URL("/robots.txt", u), { lookup, accept: "text/plain" });
    if (r.status === 200) {
      robots = robotsAllows(r.body.toString("utf8"), u.pathname + u.search) ? "allowed" : "disallowed";
    }
  } catch (e) { if (e.code === "blocked") throw e; robots = "unreadable (treated as allowed)"; }
  if (robots === "disallowed") throw new FetchError("robots", "The site's robots.txt asks tools not to read this page, so it was not read. Paste the HTML of a page you may use instead.");
  const r = await follow(u, { lookup, accept: "text/html,application/xhtml+xml" });
  if (r.status !== 200) throw new FetchError("status", "The site answered " + r.status + ", so nothing was read.");
  const type = String(r.headers["content-type"] || "");
  if (!/text\/html|application\/xhtml/i.test(type)) throw new FetchError("type", "That address is not a web page (" + (type.split(";")[0] || "unknown type") + ").");
  return { html: r.body.toString("utf8"), url: r.url.toString(), host: r.url.hostname, bytes: r.bytes, robots, fetchedAt: new Date().toISOString() };
}
