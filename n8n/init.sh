#!/bin/sh
# One-shot seeder: imports credentials (n8n encrypts them at rest) and every workflow in
# /seed/workflows, then activates them. Each workflow is seeded once per volume and remembered by a
# marker file, so later `up`s leave your edits in the n8n editor alone, and a workflow added to the
# repo after the volume was created is picked up on the next `docker compose up`.
# To re-seed everything after changing .env or a workflow file:
#   docker compose run --rm -e OMEGA_RESEED=1 n8n-init && docker compose restart n8n
set -eu
: "${OMEGA_RELAY_TOKEN:?}" "${SENTINEL_DB_PASSWORD:?}" "${OMEGA_GATEWAY_TOKEN:?}"
export OMEGA_SEED_DIR="${OMEGA_SEED_DIR:-/seed}" OMEGA_N8N_DIR="${OMEGA_N8N_DIR:-/home/node/.n8n}"

umask 077
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Build credential + workflow JSON with node so secrets never pass through shell quoting.
node - "$WORK" <<'JS'
const fs = require("fs");
const out = process.argv[2];
const env = process.env;
const SEED = env.OMEGA_SEED_DIR, STATE = env.OMEGA_N8N_DIR;
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

// Marker per workflow id. ".omega-seeded" is the marker volumes seeded before this scheme carry.
const reseed = env.OMEGA_RESEED === "1";
const seeded = id => fs.existsSync(`${STATE}/.omega-seeded-${id}`) || (id === "omegaSentinel01" && fs.existsSync(`${STATE}/.omega-seeded`));
const todo = [];
for (const file of fs.readdirSync(`${SEED}/workflows`).filter(f => f.endsWith(".json")).sort()) {
  for (const wf of JSON.parse(fs.readFileSync(`${SEED}/workflows/${file}`, "utf8"))) {
    if (!reseed && seeded(wf.id)) continue;
    for (const n of wf.nodes) {
      if (n.type !== "n8n-nodes-base.telegram") continue;
      if (tg) n.parameters.chatId = String(env.TELEGRAM_CHAT_ID);
      else { n.disabled = true; n.parameters.chatId = ""; }
    }
    todo.push(wf);
  }
}
fs.writeFileSync(`${out}/creds.json`, JSON.stringify(creds));
fs.writeFileSync(`${out}/workflows.json`, JSON.stringify(todo));
fs.writeFileSync(`${out}/ids`, todo.map(w => w.id + "\n").join(""));
console.log(todo.length ? `seeding: ${todo.map(w => w.name).join(", ")}` : "omega already seeded");
if (todo.length) console.log(tg ? "telegram: enabled" : "telegram: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set, node disabled");
JS

[ -s "$WORK/ids" ] || exit 0
n8n import:credentials --input="$WORK/creds.json"
n8n import:workflow --input="$WORK/workflows.json"
while read -r id; do
  n8n update:workflow --id="$id" --active=true
  touch "$OMEGA_N8N_DIR/.omega-seeded-$id"
done < "$WORK/ids"
echo "omega seed complete"
