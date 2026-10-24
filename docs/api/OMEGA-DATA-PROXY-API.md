# OMEGA local data proxy · API reference

Generated from [omega-data-proxy.openapi.json](omega-data-proxy.openapi.json) (OpenAPI 3.1.0, version 1.17.0) by `node scripts/build-api-docs.mjs`. Do not edit by hand.

Free, keyless public data for the OMEGA pages, cached on disk and bound to 127.0.0.1.

scripts/omega-data-proxy.mjs (ADR-089 to ADR-122). GET only except the local model bridge. CORS is added for local pages only; any other Origin gets 403 and an unknown Host gets 421. Every route reads one fixed public upstream; nothing here signs, sends or routes an order, holds a key or writes outside its cache. Generated Markdown: docs/api/OMEGA-DATA-PROXY-API.md (node scripts/build-api-docs.mjs). Every answer carries X-Content-Type-Options nosniff, Referrer-Policy no-referrer, Cross-Origin-Opener-Policy same-origin and Cross-Origin-Resource-Policy same-site; the private-network grant goes to http(s) loopback origins only, and a client that has not sent its headers within 10 s is cut off (ADR-122, found by scripts/self-shield.mjs). OMEGA_OFFLINE=1 refuses every upstream call (the self-shield sandbox).

Server: `http://127.0.0.1:8796` (local proxy (./start-omega.sh or start-omega.bat)).

## Routes

| Method | Path | Summary | Cache | Upstream |
|---|---|---|---|---|
| GET | `/health` | Proxy is up | — | — |
| GET | `/sec/tickers` | SEC company tickers | 24 h | https://www.sec.gov/files/company_tickers.json |
| GET | `/sec/facts/{cik}` | SEC XBRL company facts | 12 h | https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json |
| GET | `/stooq/{symbol}` | Stooq daily candles (CSV) | 6 h | https://stooq.com/q/d/l/?s={symbol}&i=d |
| GET | `/osiris/aviation` | OpenSky states over the Gulf and Red Sea | 15 min | https://opensky-network.org/api/states/all |
| GET | `/osiris/gdacs` | GDACS disaster alerts | 15 min | https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP |
| GET | `/osiris/gdelt` | GDELT shipping and energy headlines | 15 min | https://api.gdeltproject.org/api/v2/doc/doc |
| GET | `/osiris/ais` | Digitraffic AIS positions | 5 min | https://meri.digitraffic.fi/api/ais/v1/locations |
| GET | `/osiris/nga` | NGA broadcast warnings by strait | 30 min | https://msi.nga.mil/api/publications/broadcast-warn |
| GET | `/osiris/gdelt-sea` | GDELT headlines naming a strait | 15 min | https://api.gdeltproject.org/api/v2/doc/doc |
| GET | `/osiris/eonet` | NASA EONET natural events | 30 min | https://eonet.gsfc.nasa.gov/api/v3/events |
| GET | `/osiris/kp` | NOAA planetary K index | 15 min | https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json |
| GET | `/osiris/cams` | Open public cameras (ADR-125) | 1 h | https://api.tfl.gov.uk/Place/Type/JamCam, https://tie.digitraffic.fi/api/weathercam/v1/stations, https://api.data.gov.sg/v1/transport/traffic-images |
| GET | `/market/oilgold` | Oil and gold daily series (ADR-125) | 6 h | https://fred.stlouisfed.org/graph/fredgraph.csv, https://data-api.binance.vision/api/v3/klines |
| GET | `/osiris/marine` | Open-Meteo Marine at the five straits | 30 min | https://marine-api.open-meteo.com/v1/marine |
| GET | `/cyber/kev` | CISA Known Exploited Vulnerabilities | 1 h | https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json |
| GET | `/cyber/ioda` | IODA country outages | 15 min | https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events |
| GET | `/cyber/infocon` | SANS ISC InfoCON | 15 min | https://isc.sans.edu/api/infocon?json |
| GET | `/cyber/circl` | CIRCL Vulnerability-Lookup | 30 min | https://vulnerability.circl.lu/api/last |
| GET | `/market/llama` | DefiLlama liquidity set | 15 min | https://stablecoins.llama.fi and https://api.llama.fi |
| GET | `/market/deribit/options/BTC` | Deribit BTC option book summary | 2 min | https://www.deribit.com/api/v2/public/get_book_summary_by_currency |
| GET | `/market/deribit/dvol/BTC` | Deribit DVOL | 15 min | https://www.deribit.com/api/v2/public/get_volatility_index_data |
| GET | `/market/binance/{symbol}` | Binance 24 h ticker | 30 s | https://data-api.binance.vision/api/v3/ticker/24hr |
| GET | `/market/fapi/{kind}/{symbol}` | Binance USD-M futures public data | 1 min | https://fapi.binance.com |
| GET | `/market/coingecko/{id}` | CoinGecko simple price | 2 min | https://api.coingecko.com/api/v3/simple/price |
| GET | `/market/depth/{symbol}` | Binance order book | 5 s | https://data-api.binance.vision/api/v3/depth |
| GET | `/market/trades/{symbol}` | Binance aggregate trades | 5 s | https://data-api.binance.vision/api/v3/aggTrades |
| GET | `/market/klines/{symbol}/{interval}` | Binance candles (ADR-116) | 1 min | https://data-api.binance.vision/api/v3/klines |
| GET | `/osiris/celestrak/{group}` | CelesTrak GP elements | 2 h | https://celestrak.org/NORAD/elements/gp.php |
| GET | `/cyber/ripe/{asn}` | RIPEstat routing status | 15 min | https://stat.ripe.net/data/routing-status/data.json |
| GET | `/cyber/internetdb/{ip}` | Shodan InternetDB of a public resolver | 6 h | https://internetdb.shodan.io/{ip} |
| GET | `/osiris/adsb/sqk/{code}` | adsb.lol emergency squawks | 2 min | https://api.adsb.lol/v2/sqk/{code} |
| GET | `/osiris/adsb/zone/{zone}` | adsb.lol aircraft near a strait | 5 min | https://api.adsb.lol/v2/point/{lat}/{lon}/150 |
| GET | `/research/{source}` | ORACLE research source (ADR-114, ADR-115, ADR-122) | 6 h | one fixed API path per source |
| GET | `/llm/ollama/status` | Local Ollama model status (ADR-112) | — | — |
| POST | `/llm/ollama/explain` | Explain page readings with the local model | — | — |
| POST | `/llm/ollama/research` | Write an ORACLE brief from numbered sources | — | — |
| POST | `/llm/ollama/plan` | Plan a paper mission for PRIME | — | — |
| GET | `/data/public-intel-snapshot.json` | Hourly public intel snapshot (ADR-104) | — | — |

## Meta

### GET `/health`

Always answers; says whether the SEC contact User-Agent is set.

Example: `/health`

Answers: 200 ok.

### GET `/data/public-intel-snapshot.json`

The one file served from data/; rows older than 6 hours are ignored by the pages.

Answers: 200 snapshot; 404 no snapshot on this machine.

## Filings

### GET `/sec/tickers`

CIK, ticker and name for every SEC filer. Needs OMEGA_SEC_UA.

Example: `/sec/tickers`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/sec/facts/{cik}`

All reported XBRL facts of one company. Needs OMEGA_SEC_UA.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `cik` | path | `^\d{10}$` | 10-digit CIK with leading zeros |

Example: `/sec/facts/0000320193`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

## Market

### GET `/stooq/{symbol}`

Daily OHLCV history as CSV.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `symbol` | path | `^[a-z0-9.\-^]{1,20}$` | Stooq symbol, lower case |

Example: `/stooq/aapl.us`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/oilgold`

WTI and Brent daily spot (U.S. EIA via the keyless FRED CSV) and gold via PAXGUSDT daily candles, last 260 trading days, in one omega-oilgold-v1 set. A series that fails is listed under missing.

Example: `/market/oilgold`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/llama`

Stablecoin supply, chain TVL and DEX volume with the liquidity flow index (omega-llama-v1).

Example: `/market/llama`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/deribit/options/BTC`

IV and open interest per instrument, compact form.

Example: `/market/deribit/options/BTC`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/deribit/dvol/BTC`

Hourly DVOL candles, last 48 h.

Example: `/market/deribit/dvol/BTC`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/binance/{symbol}`

Spot 24 h ticker of one symbol.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `symbol` | path | `^[A-Z0-9]{5,20}$` | Binance spot symbol, upper case |

Example: `/market/binance/BTCUSDT`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/fapi/{kind}/{symbol}`

premium (falls back to OKX then Deribit for BTCUSDT and ETHUSDT, `venue` names it), funding, open interest, top-trader and global long/short and taker ratios.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `kind` | path | `premium`, `funding`, `oi`, `top`, `global`, `taker` | which public series |
| `symbol` | path | `^[A-Z0-9]{5,20}$` | Binance spot symbol, upper case |

Example: `/market/fapi/premium/BTCUSDT`, `/market/fapi/oi/ETHUSDT`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/coingecko/{id}`

USD price with 24 h change.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `id` | path | `^[a-z0-9-]{2,40}$` | CoinGecko coin id |

Example: `/market/coingecko/bitcoin`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/depth/{symbol}`

100 levels per side, for the MCP bridge.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `symbol` | path | `^[A-Z0-9]{5,20}$` | Binance spot symbol, upper case |

Example: `/market/depth/BTCUSDT`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/trades/{symbol}`

Last 300 aggregate trades.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `symbol` | path | `^[A-Z0-9]{5,20}$` | Binance spot symbol, upper case |

Example: `/market/trades/BTCUSDT`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/market/klines/{symbol}/{interval}`

Last 300 spot candles for the TRADE LAB market lens.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `symbol` | path | `^[A-Z0-9]{5,20}$` | Binance spot symbol, upper case |
| `interval` | path | `1h`, `4h`, `1d` | candle size |

Example: `/market/klines/BTCUSDT/4h`, `/market/klines/ETHUSDT/1d`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

## Osiris

### GET `/osiris/aviation`

Aircraft state vectors in the box 10–32° N, 30–62° E.

Example: `/osiris/aviation`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/gdacs`

Orange and red alerts as omega-alerts-v1; falls back to GDACS search, then EMSC M6+ (+ ReliefWeb). `via` names the source.

Example: `/osiris/gdacs`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/gdelt`

GDELT DOC 2.0 article list, last 6 h.

Example: `/osiris/gdelt`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/ais`

Baltic AIS positions compacted to [lon, lat, sog].

Example: `/osiris/ais`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/nga`

NGA MSI warnings sorted into Hormuz, Bab el-Mandeb, Suez, Malacca and Panama.

Example: `/osiris/nga`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/gdelt-sea`

Last 24 h of articles that name one of the five straits.

Example: `/osiris/gdelt-sea`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/eonet`

Open events of the last 30 days, compact form.

Example: `/osiris/eonet`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/kp`

Kp readings, compact form.

Example: `/osiris/kp`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/cams`

TfL JamCams, Fintraffic road weather cameras and Singapore LTA cameras in one omega-cams-v1 list: name, position and one still-image URL on an allowlisted https host. A group that fails is named, never filled.

Example: `/osiris/cams`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/marine`

Waves, swell, currents and sea temperature at one sea point per strait.

Example: `/osiris/marine`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/celestrak/{group}`

Mean elements of a fixed group.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `group` | path | `stations`, `visual` | satellite group |

Example: `/osiris/celestrak/stations`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/adsb/sqk/{code}`

Aircraft squawking 7500, 7600 or 7700 worldwide (ODbL).

| Parameter | In | Rule | Description |
|---|---|---|---|
| `code` | path | `7500`, `7600`, `7700` | emergency squawk |

Example: `/osiris/adsb/sqk/7700`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/osiris/adsb/zone/{zone}`

Aircraft within 150 nm of a strait or the Taiwan Strait.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `zone` | path | `hormuz`, `bab`, `suez`, `malacca`, `panama`, `taiwan` | strait key |

Example: `/osiris/adsb/zone/hormuz`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

## Cyber

### GET `/cyber/kev`

Count and the last 30 days.

Example: `/cyber/kev`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/cyber/ioda`

Georgia Tech IODA outage events, last 24 h.

Example: `/cyber/ioda`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/cyber/infocon`

Internet Storm Center threat level.

Example: `/cyber/infocon`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/cyber/circl`

Latest published records cut to id, CVSS and CWE.

Example: `/cyber/circl`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/cyber/ripe/{asn}`

Visibility of one of five tier-1 backbones.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `asn` | path | `AS3356`, `AS1299`, `AS174`, `AS2914`, `AS6453` | AS number with AS prefix |

Example: `/cyber/ripe/AS3356`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

### GET `/cyber/internetdb/{ip}`

A lookup of Shodan's weekly data for one of four fixed public resolvers; never an address taken from input, never a scan.

| Parameter | In | Rule | Description |
|---|---|---|---|
| `ip` | path | `1.1.1.1`, `8.8.8.8`, `9.9.9.9`, `208.67.222.222` | one of four public resolvers |

Example: `/cyber/internetdb/1.1.1.1`

Answers: 200 Upstream answer or its compact OMEGA form. Header X-Omega-Cache is HIT, MISS or STALE.; 502 the upstream did not answer and no cached copy exists.

## Research

### GET `/research/{source}`

`url` must be that source's own https host and API path (OMEGA_RESEARCH.allowed in scripts/lib/deep-research.mjs); anything else is refused with 400. arXiv is paced at one call per 3 s, NVD at one per 6.5 s, Zenodo at one per 2.1 s and PubMed at one per 0.4 s. PubMed has two fixed paths (esearch, esummary).

| Parameter | In | Rule | Description |
|---|---|---|---|
| `source` | path | `wikipedia`, `openalex`, `crossref`, `europepmc`, `arxiv`, `semanticscholar`, `gdelt`, `wayback`, `doaj`, `dblp`, `wikidata`, `nvd`, `clinicaltrials`, `pubmed`, `zenodo`, `osti`, `epss` | research source |
| `url` | query | uri | the upstream API address |

Answers: 200 upstream answer (Atom XML for arXiv); 400 not an allowed request for this research source; 502 the upstream did not answer and no cached copy exists.

## Local model

### GET `/llm/ollama/status`

Loopback sockets and pages from http://127.0.0.1 only; Ollama must be on a loopback address and :cloud models are refused.

Answers: 200 model chosen and models seen; 403 not this machine, or not a page from 127.0.0.1.

### POST `/llm/ollama/explain`

Used by the Ops Room neural flow and, from ADR-116, the TRADE LAB desk manager. Fixed paper-only system prompt; the answer changes nothing.

Body (`application/json`): `["facts","question"]`

Answers: 200 answer; 403 not this machine, or not a page from 127.0.0.1; 415 send Content-Type: application/json; 429 the local model is already answering.

### POST `/llm/ollama/research`

Every sentence must carry a source number; the page checks them.

Body (`application/json`): `["question","sources"]`

Answers: 200 answer; 403 not this machine, or not a page from 127.0.0.1; 415 send Content-Type: application/json; 429 the local model is already answering.

### POST `/llm/ollama/plan`

The local model writes a JSON plan that may use only the core's read-only tools; the proxy checks it with OMEGA_CORE.checkPlan and the Ops Room checks it again before it runs (ADR-121).

Body (`application/json`): `["goal"]`

Answers: 200 answer; 403 not this machine, or not a page from 127.0.0.1; 415 send Content-Type: application/json; 422 the model's plan was refused by the checker; 429 the local model is already answering.
