#!/bin/bash
# Mantém o pipeline do Summit em dia. Chamado pelo agendador do macOS.
cd "$HOME/projuris-summit-2026" || exit 1
[ -f .env ] || exit 1
export $(grep '^HUBSPOT_TOKEN=' .env | xargs)
echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
/Users/marcoscosta/.local/node/bin/node sincroniza-deals.mjs 2>&1
