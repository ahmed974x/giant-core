#!/bin/sh
# One-shot migration step (the db-migrate service). Postgres runs db/init/* only when it creates an
# empty volume, so an existing volume never sees a newer script. This runs every script on each
# `docker compose up`; each one checks whether its schema exists and skips itself if so.
set -eu
: "${PGHOST:?}" "${POSTGRES_USER:?}" "${POSTGRES_DB:?}"

# Wait for the real server. On a brand-new volume Postgres first runs the init scripts on a
# socket-only server; TCP opens only after that finishes, so this also waits out first boot.
tries=0
until pg_isready -q -h "$PGHOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do
  tries=$((tries + 1))
  [ "$tries" -ge 90 ] && { echo "db-migrate: timescale not reachable after 3 minutes" >&2; exit 1; }
  sleep 2
done

for f in /db/init/*.sh; do
  echo "db-migrate: $(basename "$f")"
  sh "$f"
done
echo "db-migrate: schema up to date"
