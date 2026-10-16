#!/usr/bin/env bash
# Runs db/init/05-nerve.sh and db/test/nerve_test.sql against a throw-away Postgres (no Docker needed).
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
"$PG_BIN/initdb" -D "$TMP/data" -U omega_admin --auth=trust >"$TMP/initdb.log"
"$PG_BIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -c listen_addresses=''" -w -l "$TMP/log" start >/dev/null
export PGHOST=$TMP PGUSER=omega_admin POSTGRES_USER=omega_admin POSTGRES_DB=omega_test
"$PG_BIN/createdb" omega_test
# What 01-sentinel.sh normally provides: the PostgREST role and the api schema.
psql -q -v ON_ERROR_STOP=1 -d omega_test -c "CREATE ROLE web_anon NOLOGIN; CREATE SCHEMA api;"

sh db/init/05-nerve.sh
sh db/init/05-nerve.sh                            # second run must be a no-op
psql -q -o /dev/null -v ON_ERROR_STOP=1 -d omega_test -f db/test/nerve_test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  //"
