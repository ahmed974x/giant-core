# ADR-095: Rate-limit shield for Binance, SEC EDGAR, OpenSky and GDELT

Date: 2026-10-20 · Status: Accepted (Ahmad's Phase 8 directive, 2026-10-20)

## Context
Ahmad asked that live prices never get the laptop's IP blocked and that SEC EDGAR, OpenSky and GDELT stop returning HTTP 429 or 403. The spot desk already read `data-api.binance.vision` (Binance's public market-data host). Futures data (premium, funding, open interest, long/short and taker ratios) went straight to `fapi.binance.com` from every open tab, the proxy kept only a disk cache, and an upstream 429 was retried on the next page poll.

## Decision
**Proxy (`scripts/omega-data-proxy.mjs`)**
1. A memory cache (200 entries, oldest out first) sits in front of the existing disk cache. Each route keeps its TTL: SEC tickers 24 h, SEC facts 12 h, OpenSky, GDACS and GDELT 15 min, NGA 30 min, AIS 5 min, Binance spot 30 s, futures 60 s, CoinGecko 2 min.
2. Requests for the same URL while one is in flight share that one upstream call.
3. Each host keeps a minimum gap between calls: SEC 200 ms (10 per second is SEC's published limit), GDELT 5 s (GDELT's guidance), OpenSky 10 s (its anonymous refresh), 250 ms elsewhere.
4. An upstream 429, 418 or 403 pauses that host for its `Retry-After`, with 60 s as the floor (300 s after a 418, which is Binance's IP-ban warning) and 15 min as the ceiling. While paused the proxy serves the stale copy, or answers 503 with `Retry-After` when it has none.
5. `X-Omega-Cache: HIT | MISS | STALE` on every data answer, exposed to local pages through CORS.
6. New route `/market/fapi/<premium|funding|oi|top|global|taker>/<SYMBOL>`, fixed URL templates only, `fapi.binance.com` added to `ALLOWED_UPSTREAM`. The `--check` table adds Binance futures.
7. SEC still requires `OMEGA_SEC_UA`; ADR-094 lets it come from `~/.omega/sec-ua.txt` so the contact stays off git.

**Ops Room desk**
1. The desk's `getJson` pauses a host after 429 or 418, honouring `Retry-After` when the browser can read it (60 s, 300 s after 418, at most 15 min), and waits for the next minute when `x-mbx-used-weight-1m` is above 4800 of Binance's 6000.
2. Futures calls go through the proxy when it answers `/health`, so all tabs share one cached copy, and fall back to Binance directly when it does not.

## Consequences
- These are public market-data GET endpoints only. Nothing here signs a request or places, changes or cancels an order.
- Tested with a mocked upstream (fetch replaced before the proxy loads): first call MISS, second HIT, five concurrent calls produced one upstream request, a mocked 429 with `Retry-After: 120` paused the host and the next call got 503 `Retry-After: 120` without reaching upstream, two GDELT routes back to back were spaced 5 s apart. Live limits are checked on the laptop with `node scripts/omega-data-proxy.mjs --check`.
