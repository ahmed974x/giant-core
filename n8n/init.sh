#!/bin/sh
# One-shot seeder: imports credentials (n8n encrypts them at rest) and every workflow in
# /seed/workflows (Market Sentinel, Whale Watch BTC + ETH), then activates them. Runs once per volume; later `up`s leave your edits in the n8n editor alone.
# To re-seed after changing .env or the workflow file:
#   docker compose run --rm -e OMEGA_RESEED=1 n8n-init && docker compose restart n8n
set -eu
: "${OMEGA_RELAY_TOKEN:?}" "${SENTINEL_DB_PASSWORD:?}"
MARK=/home/node/.n8n/.omega-seeded
if [ -f "$MARK" ] && [ "${OMEGA_RESEED:-0}" != "1" ]; then echo "omega already seeded"; exit 0; fi

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
];
fs.writeFileSync(`${out}/creds.json`, JSON.stringify(creds));

// Public chain endpoints (n8n nodes cannot read env, so the URLs are written into the workflows here).
const url = (v, dflt, name) => {
  const u = (v || dflt).replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s"'{}\\]+$/.test(u)) throw new Error(`${name} is not a plain http(s) URL`);
  return u;
};
const SOURCES = {
  __OMEGA_BTC_API__: url(env.OMEGA_BTC_API, "https://blockchain.info", "OMEGA_BTC_API"),
  __OMEGA_ETH_RPC_URL__: url(env.OMEGA_ETH_RPC_URL, "https://ethereum-rpc.publicnode.com", "OMEGA_ETH_RPC_URL"),
};

const all = [];
for (const file of fs.readdirSync("/seed/workflows").filter(f => f.endsWith(".json")).sort()) {
  let text = fs.readFileSync(`/seed/workflows/${file}`, "utf8");
  for (const [k, v] of Object.entries(SOURCES)) text = text.split(k).join(v);
  for (const wf of JSON.parse(text)) {
    for (const n of wf.nodes) {
      if (n.type !== "n8n-nodes-base.telegram") continue;
      if (tg) n.parameters.chatId = String(env.TELEGRAM_CHAT_ID);
      else { n.disabled = true; n.parameters.chatId = ""; }
    }
    all.push(wf);
  }
}
fs.writeFileSync(`${out}/workflow.json`, JSON.stringify(all));
fs.writeFileSync(`${out}/ids`, all.map(w => w.id).join("\n") + "\n");
console.log(`workflows: ${all.map(w => w.name).join(", ")}`);
console.log(`chain sources: ${Object.values(SOURCES).join(", ")}`);
console.log(tg ? "telegram: enabled" : "telegram: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set, node disabled");
JS

n8n import:credentials --input="$WORK/creds.json"
n8n import:workflow --input="$WORK/workflow.json"
while read -r id; do n8n update:workflow --id="$id" --active=true; done < "$WORK/ids"
touch "$MARK"
echo "omega seed complete"
