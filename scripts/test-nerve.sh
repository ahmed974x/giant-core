#!/usr/bin/env bash
# Runs the agents database layer (db/init/05 to 10), its tests (db/test/*_test.sql), the memory keeper (services/ameen),
# the second brain worker (services/mind) and the brain loop (services/loop) against a throw-away Postgres (no Docker).
#   scripts/test-nerve.sh            needs initdb/pg_ctl on PATH, or PG_BIN=/usr/lib/postgresql/16/bin
# The cluster lives in a temp folder and is removed afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
PG_BIN=${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | tail -1)")}
[ -x "$PG_BIN/initdb" ] || { echo "initdb not found; set PG_BIN" >&2; exit 2; }

if [ "$(id -u)" = 0 ]; then                       # initdb refuses root: re-run as the postgres user
  exec runuser -u postgres -- env PG_BIN="$PG_BIN" bash "$ROOT/scripts/test-nerve.sh"
fi

TMP=$(mktemp -d); trap '"$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
"$PG_BIN/initdb" -D "$TMP/data" -U omega_admin --auth=trust --locale=C.UTF-8 --encoding=UTF8 >"$TMP/initdb.log"
"$PG_BIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -c listen_addresses=''" -w -l "$TMP/log" start >/dev/null
export PGHOST=$TMP PGUSER=omega_admin POSTGRES_USER=omega_admin POSTGRES_DB=omega_test
"$PG_BIN/createdb" omega_test
# What 01-sentinel.sh normally provides: the PostgREST role and the api schema.
psql -q -v ON_ERROR_STOP=1 -d omega_test -c "CREATE ROLE web_anon NOLOGIN; CREATE SCHEMA api;"

export AMEEN_DB_PASSWORD=test-only HAKEEM_DB_PASSWORD=test-only   # creates the ameen and hakeem logins
for f in db/init/05-nerve.sh db/init/06-memory.sh db/init/07-brain.sh db/init/08-loop.sh db/init/09-market.sh db/init/10-vault.sh; do sh "$f"; sh "$f"; done   # second run must be a no-op
for t in nerve memory brain loop market vault; do
  psql -q -o /dev/null -v ON_ERROR_STOP=1 -d omega_test -f "db/test/${t}_test.sql" 2>&1 | sed "s/^psql:[^ ]* NOTICE:  //"
done

# The memory keeper and the second brain's worker against the same database (skipped when the test libraries are missing).
if python3 -c "import pg8000, pytest, networkx" 2>/dev/null; then
  LOOP_TEST_SOCKET="$TMP/.s.PGSQL.5432" python3 -m pytest -q -p no:cacheprovider services/loop
  AMEEN_TEST_SOCKET="$TMP/.s.PGSQL.5432" AMEEN_DB_USER=ameen python3 -m pytest -q -p no:cacheprovider services/ameen
  MIND_TEST_SOCKET="$TMP/.s.PGSQL.5432" python3 -m pytest -q -p no:cacheprovider services/mind
else
  echo "skip: services/ameen and services/mind tests need pg8000, networkx and pytest (pip install -r services/mind/requirements-dev.txt)"
fi
