// Founder-only access for jarvis/server (ADR-141). node:crypto only; no third-party code.
//   - With no JARVIS_FOUNDER_KEY the server behaves as before: it answers on 127.0.0.1 only, for the
//     person at this computer.
//   - With JARVIS_FOUNDER_KEY set, every page and API call needs the founder's signed session cookie.
//     The key is never stored: at start it is stretched with scrypt (N 2^15, r 8, p 1) under a fresh
//     random salt, and a login is checked by stretching the typed key the same way and comparing with
//     timingSafeEqual. Sessions are HMAC-SHA256 signed with a random per-start secret, expire after
//     12 hours and live in an HttpOnly, SameSite=Strict cookie (Secure when the request came over
//     HTTPS through the reverse proxy). A restart signs everyone out.
//   - Failed logins are limited per client address: 5 in 10 minutes, then 429 until the window passes.
//   - JARVIS_PUBLIC_HOST (e.g. jarvis.example.com) lets a reverse proxy on the same machine (Caddy)
//     reach the server, which still binds 127.0.0.1. It is refused at start without a founder key, so
//     the server is never reachable through a public name without the gate.
//   - Opening Jarvis to the public is not a setting here: the access mode stays "founder_private" in the
//     database (access_settings_founder_private_locked) and a request to change it is a locked approval.
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export class GateError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const COOKIE = "jarvis_founder";
const SESSION_MS = 12 * 60 * 60 * 1000;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function checkPublicHost(raw) {
  const h = String(raw || "").trim().toLowerCase();
  if (!h) return null;
  if (!HOST_RE.test(h) || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h)) throw new GateError(400, "JARVIS_PUBLIC_HOST must be a public DNS name such as jarvis.example.com (no scheme, port or path).");
  return h;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function createFounderGate({ key = process.env.JARVIS_FOUNDER_KEY, publicHost = process.env.JARVIS_PUBLIC_HOST, now = () => Date.now() } = {}) {
  const enabled = typeof key === "string" && key.length > 0;
  if (enabled && key.length < 12) throw new GateError(400, "JARVIS_FOUNDER_KEY must be at least 12 characters.");
  const host = checkPublicHost(publicHost);
  if (host && !enabled) throw new GateError(400, "JARVIS_PUBLIC_HOST needs JARVIS_FOUNDER_KEY: Jarvis is never reachable through a public name without the founder gate.");
  const salt = randomBytes(16);
  const stretched = enabled ? scryptSync(String(key), salt, 32, SCRYPT) : null;
  const secret = randomBytes(32);
  const fails = new Map(); // client address -> [times]

  const sign = payload => createHmac("sha256", secret).update(payload).digest("base64url");
  const newSession = () => {
    const payload = (now() + SESSION_MS) + "." + randomBytes(12).toString("base64url");
    return payload + "." + sign(payload);
  };
  function validSession(token) {
    const m = /^(\d{10,16})\.([\w-]{16})\.([\w-]{43})$/.exec(String(token || ""));
    if (!m) return false;
    const expect = Buffer.from(sign(m[1] + "." + m[2]));
    const got = Buffer.from(m[3]);
    return expect.length === got.length && timingSafeEqual(expect, got) && Number(m[1]) > now();
  }
  const cookie = (value, secure, maxAgeS) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${secure ? "; Secure" : ""}`;

  return {
    enabled, publicHost: host, cookieName: COOKIE,
    // Hosts the server answers to: loopback always, the public name only behind the gate.
    hosts: port => [`127.0.0.1:${port}`, `localhost:${port}`, ...(host ? [host] : [])],
    origins: port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(host ? [`https://${host}`] : [])],
    // True when this request carries a valid founder session (always true when the gate is off).
    allowed(req) { return !enabled || validSession(parseCookies(req.headers.cookie)[COOKIE]); },
    // Only Caddy on this machine sets X-Forwarded-Proto; it is read only when a public host is set.
    secureRequest(req) { return !!host && String(req.headers["x-forwarded-proto"] || "") === "https"; },
    login(req, typed) {
      if (!enabled) return { ok: true, cookie: null };
      const who = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
      const t = now(), recent = (fails.get(who) || []).filter(x => t - x < 10 * 60 * 1000);
      if (recent.length >= 5) throw new GateError(429, "Too many wrong keys. Wait 10 minutes and try again.");
      const tryKey = String(typed || "");
      const ok = tryKey.length > 0 && tryKey.length <= 1024 && timingSafeEqual(scryptSync(tryKey, salt, 32, SCRYPT), stretched);
      if (!ok) {
        recent.push(t); fails.set(who, recent);
        if (fails.size > 10000) fails.delete(fails.keys().next().value);
        throw new GateError(401, "That is not the founder key.");
      }
      fails.delete(who);
      return { ok: true, cookie: cookie(newSession(), this.secureRequest(req), SESSION_MS / 1000) };
    },
    logout(req) { return cookie("", this.secureRequest(req), 0); },
  };
}

// The sign-in page: no framework, one small script pinned by its hash in this page's own CSP.
const LOGIN_SCRIPT = `document.getElementById("f").addEventListener("submit",async e=>{e.preventDefault();const m=document.getElementById("m");m.textContent="";try{const r=await fetch("/api/founder/login",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-jarvis":"1"},body:JSON.stringify({key:document.getElementById("k").value})});if(r.ok){location.replace("/");return}const j=await r.json().catch(()=>({}));m.textContent=j.error||("HTTP "+r.status)}catch(err){m.textContent="The server did not answer."}});`;
const LOGIN_STYLE = `:root{color-scheme:dark light;--bg:oklch(17% 0.01 260);--fg:oklch(96% 0.005 260);--muted:oklch(80% 0.01 260);--card:oklch(23% 0.012 260);--line:oklch(38% 0.012 260);--accent:oklch(77.6% 0.119 248.9);--on:oklch(18% 0.02 250);--bad:oklch(78% 0.13 25)}@media (prefers-color-scheme:light){:root{--bg:oklch(97% 0.004 260);--fg:oklch(22% 0.01 260);--muted:oklch(45% 0.01 260);--card:oklch(100% 0 0);--line:oklch(86% 0.006 260);--accent:oklch(53.5% 0.19 257);--on:oklch(99% 0 0);--bad:oklch(50% 0.19 25)}}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,"Readex Pro",sans-serif}main{width:min(420px,100%);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:24px;display:grid;gap:12px}h1{margin:0;font-size:20px}p{margin:0;color:var(--muted)}label{font-weight:600}input{width:100%;min-height:44px;padding:8px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit}button{min-height:44px;border:0;border-radius:12px;background:var(--accent);color:var(--on);font:inherit;font-weight:600;cursor:pointer}#m{color:var(--bad);min-height:1.5em}[lang=ar]{font-family:"Readex Pro",system-ui,sans-serif}`;

export function loginPage(sha256Base64) {
  const hs = sha256Base64(LOGIN_SCRIPT), hc = sha256Base64(LOGIN_STYLE);
  const csp = `default-src 'none'; script-src 'sha256-${hs}'; style-src 'sha256-${hc}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'`;
  const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>Jarvis · Founder sign-in</title><style>${LOGIN_STYLE}</style></head><body><main><h1>Jarvis</h1><p>Founder-only for now. Enter the founder key to continue.</p><p lang="ar" dir="rtl">المنصة خاصة بالمؤسس حالياً. أدخل مفتاح المؤسس للمتابعة.</p><form id="f"><label for="k">Founder key · مفتاح المؤسس</label><input id="k" name="founder-key" type="password" autocomplete="current-password" required minlength="12" maxlength="1024"><p id="m" role="alert" aria-live="polite"></p><button type="submit">Sign in · دخول</button></form></main><script>${LOGIN_SCRIPT}</script></body></html>`;
  return { html, csp };
}
