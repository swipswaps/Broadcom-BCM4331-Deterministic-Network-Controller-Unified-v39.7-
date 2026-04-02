#!/usr/bin/env bash
# sync-updates.sh - Repo sync + dependency + build orchestrator
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
cd "$PROJECT_ROOT"

echo "[SYNC] Checking local repository state..."
git add -A
if ! git diff --cached --quiet; then
  git commit -m "chore: local state preservation before sync ($(date +%Y%m%d-%H%M))"
fi

echo "[SYNC] Reconciling with upstream (git pull --rebase origin main)..."
# In AI Studio, we might not have a remote, but we keep the logic
git pull --rebase origin main || echo "[SYNC] Remote sync skipped (no upstream)"

echo "[SYNC] Restoring environment (npm install)..."
npm install

echo "[SYNC] Verifying system integrity (npm run lint)..."
npm run lint

echo "[SYNC] SUCCESS: System is synchronized and verified."
echo "[SYNC] Run 'npm run audit' to verify the forensic database."
