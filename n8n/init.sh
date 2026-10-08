#!/bin/sh
# One-shot seeder: imports credentials (n8n encrypts them at rest) and the OMEGA workflows, then
# activates them. Each workflow is seeded once per volume, so later `up`s leave your edits in the n8n
# editor alone, and a volume seeded before a workflow existed picks that workflow up on the next `up`.
# To re-seed everything after changing .env or a workflow file:
#   docker compose run --rm -e OMEGA_RESEED=1 n8n-init && docker compose restart n8n
set -eu
: "${OMEGA_RELAY_TOKEN:?}" "${SENTINEL_DB_PASSWORD:?}" "${OMEGA_GATEWAY_TOKEN:?}"
STATE=/home/node/.n8n
MARK=$STATE/.omega-seeded              # Market Sentinel (kept from the first release)
NEWS_MARK=$STATE/.omega-seeded-news    # News Sentiment
RESEED=${OMEGA_RESEED:-0}
need_sentinel=1; need_news=1
if [ -f "$MARK" ] && [ "$RESEED" != "1" ]; then need_sentinel=0; fi
if [ -f "$NEWS_MARK" ] && [ "$RESEED" != "1" ]; then need_news=0; fi
if [ "$need_sentinel$need_news" = "00" ]; then echo "omega already seeded"; exit 0; fi

umask 077
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Build credential + workflow JSON with node so secrets never pass through shell quoting.
node - "$WORK" <<'JS'
const fs = require("fs");
const out = process.argv[2];
const env = process.env;
const tg = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
const creds = [
  { id: "omegaRelayAuth", name: "OMEGA relay token", type: "httpHeaderAuth",
    data: { name: "X-Omega-Token", value: env.OMEGA_RELAY_TOKEN } },
  { id: "omegaTimescale", name: "OMEGA Timescale (sentinel_writer)", type: "postgres",
    data: { host: "timescale", port: 5432, database: env.POSTGRES_DB || "omega",
            user: "sentinel_writer", password: env.SENTINEL_DB_PASSWORD, ssl: "disable", sshTunnel: false } },
  { id: "omegaTelegram", name: "OMEGA Telegram bot", type: "telegramApi",
    data: { accessToken: env.TELEGRAM_BOT_TOKEN || "not-configured", baseUrl: "https://api.telegram.org" } },
  { id: "omegaCortexAuth", name: "OMEGA Cortex gateway token", type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Bearer ${env.OMEGA_GATEWAY_TOKEN}` } },
];
fs.writeFileSync(`${out}/creds.json`, JSON.stringify(creds));

for (const file of ["market-sentinel", "news-sentiment"]) {
  const wf = JSON.parse(fs.readFileSync(`/seed/workflows/${file}.json`, "utf8"));
  for (const n of wf[0].nodes) {
    if (n.type !== "n8n-nodes-base.telegram") continue;
    if (tg) n.parameters.chatId = String(env.TELEGRAM_CHAT_ID);
    else { n.disabled = true; n.parameters.chatId = ""; }
  }
  fs.writeFileSync(`${out}/${file}.json`, JSON.stringify(wf));
}
console.log(tg ? "telegram: enabled" : "telegram: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set, node disabled");
JS

n8n import:credentials --input="$WORK/creds.json"
if [ "$need_sentinel" = "1" ]; then
  n8n import:workflow --input="$WORK/market-sentinel.json"
  n8n update:workflow --id=omegaSentinel01 --active=true
  touch "$MARK"
fi
if [ "$need_news" = "1" ]; then
  n8n import:workflow --input="$WORK/news-sentiment.json"
  n8n update:workflow --id=omegaNews01 --active=true
  touch "$NEWS_MARK"
fi
echo "omega seed complete"
