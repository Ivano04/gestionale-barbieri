#!/bin/bash
set -euo pipefail
# Windows workspace: the TEST deploy packs committed main, backs up the database,
# applies fiscal migrations and keeps the previous image for rollback.
cd "$(dirname "$0")/.."
if command -v pwsh >/dev/null 2>&1; then
  exec pwsh -NoProfile -File scripts/deploy-test.ps1 "$@"
elif command -v powershell.exe >/dev/null 2>&1; then
  exec powershell.exe -NoProfile -File scripts/deploy-test.ps1 "$@"
else
  echo "Run scripts/deploy-test.ps1 from PowerShell on the configured workspace." >&2
  exit 1
fi
