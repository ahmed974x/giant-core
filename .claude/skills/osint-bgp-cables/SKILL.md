---
name: osint-bgp-cables
description: Use when adding or changing an OSIRIS layer for internet routing, outages, submarine cables, satellites, space weather or exploited vulnerabilities. Passive, keyless public sources only, through the proxy, direct and snapshot tiers.
---

# Passive cyber and space intel for OSIRIS

Rules from AGENTS.md §1 and §3 and DESIGN.md §6 apply first. This skill covers the cyber and space layers of ADR-108.

## 1. What is allowed

Passive reading of public, keyless, documented APIs. Nothing else.

| Need | Source | Notes |
|---|---|---|
| BGP visibility of backbones | RIPEstat `routing-status` (`stat.ripe.net`), with `sourceapp=omega-giant-core` | 1 s between calls per host |
| Country internet outages | IODA v2 `outages/events` (Georgia Tech) | no browser CORS: proxy or snapshot only |
| Exploited vulnerabilities | CISA KEV JSON feed | no browser CORS: proxy or snapshot only |
| Satellites | CelesTrak GP JSON (`GROUP=stations`, `visual`) | CelesTrak asks for at most one pull per group every 2 hours; keep the 2 h caches |
| Space weather | NOAA SWPC planetary K index | |
| Natural events | NASA EONET v3 open events | |
| Cables | hand-drawn approximate corridors in the page | TeleGeography data is licensed, never vendor it |

Never: port scanning or banner grabbing (ZMap, Masscan, Nmap, Sn1per or similar), search-engine dorking, spoofed user agents, scraping behind logins, CAPTCHA solving, anti-bot bypass, or any source that needs a key or payment. A request for any of these is declined in one line and the passive source above is offered instead.

## 2. How a source is wired

1. Add a compact shape with a `format` tag in `scripts/lib/brain2-math.mjs` (`shape.x`) and its URL builder (`urls.x`). The shape throws on input it does not recognise.
2. Run `node scripts/build-brain2-inline.mjs` to copy the library into the Ops Room, then `--check` must pass.
3. Proxy: add a route in `scripts/omega-data-proxy.mjs` with a TTL and the shape as transform; add the host to `ALLOWED_UPSTREAM`.
4. Snapshot: add the source to `scripts/fetch-public-intel-snapshot.mjs` with a name, URL, `pick` and `count`.
5. Page: a `cascade(key, [proxy, direct (CORS hosts only), snapshot])` call; add the host to the page's CSP `connect-src` only when it is fetched directly.
6. The source table row names the tier; snapshot rows show "as of" in amber and are ignored after 6 hours.
7. Offline means OFFLINE or «تعذر التحقق منها», never simulated points.

## 3. The threat index

CSTI (cyber and space threat index, 0–100) is the mean of the parts that have data: space (Kp 4→0, Kp 9→100), KEV (8 per addition in 7 days, +10 per ransomware-linked), BGP (lowest backbone visibility 98%→0, 80%→100), IODA (10 per country outage in 24 h). It is PWSI's fifth component and the risk judge treats CSTI at or above the PWSI limit as a hard stop. It carries `[INFERENCE]` and says how many of its 4 parts it used.

## 4. Map

Every point opens a callout with its raw source and time. Cable corridors and shipping lanes are labelled approximate. Orbits use two-body motion with J2 drift, labelled "not SGP4".

## 5. Checks

`node --check` on changed scripts, the Ops Room self-test (`?selftest=1`) check "Orbits, space weather & cyber radar", SkillSpector strict, three sizes.
