#!/usr/bin/env bash
# OMEGA code quality + security gate. One command for every language in the repo.
#   scripts/quality.sh           check only (what CI runs); non-zero exit on any problem
#   scripts/quality.sh --fix     apply every safe autofix first, then check
#
# Tools: Ruff (Python lint + import order + bandit security), Biome (JS/TS lint + security),
# node --check (JS parse), a committed-secrets scan, and the plugin-registry validator.
# Install once:  python -m venv tools-quality/.venv && tools-quality/.venv/Scripts/pip install -r tools-quality/requirements.txt
#                (cd tools-quality && npm ci)
set -uo pipefail
cd "$(dirname "$0")/.."

FIX=0; [ "${1:-}" = "--fix" ] && FIX=1
fail=0
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

# Resolve Ruff and Biome whether installed in the venv (local) or on PATH (CI).
RUFF="tools-quality/.venv/Scripts/ruff"; [ -x "$RUFF" ] || RUFF="tools-quality/.venv/bin/ruff"; [ -x "$RUFF" ] || RUFF="ruff"
BIOME="tools-quality/node_modules/.bin/biome"; [ -x "$BIOME" ] || BIOME="npx --no-install @biomejs/biome"

step "Ruff · Python lint + security"
if [ "$FIX" = 1 ]; then $RUFF check --fix . || fail=1; else $RUFF check . || fail=1; fi

step "Biome · JS/TS lint + security"
if [ "$FIX" = 1 ]; then $BIOME lint --write . || fail=1; else $BIOME lint . || fail=1; fi

step "node --check · parse every service script"
while IFS= read -r f; do node --check "$f" || fail=1; done < <(git ls-files 'services/**/*.js' 'n8n/**/*.js' | grep -v node_modules)

step "Secret scan · nothing sensitive committed"
if git ls-files | grep -qE '(^|/)\.env$'; then echo "ERROR: a .env file is tracked"; fail=1; fi
if git grep -nIE '(sk-ant-[A-Za-z0-9]{10}|sb_secret_[A-Za-z0-9]{10}|ghp_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)' -- ':!*.md' ':!tools-quality'; then
  echo "ERROR: a secret-shaped string is committed"; fail=1
fi

step "Plugin registry · every plugin.json valid"
python scripts/plugins.py --check || fail=1

if [ "$fail" = 0 ]; then printf '\n\033[32m✓ quality gate passed\033[0m\n'; else printf '\n\033[31m✗ quality gate found problems\033[0m\n'; fi
exit $fail
