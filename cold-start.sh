#!/bin/bash
# cold-start.sh - Nuclear Orchestrator v30.3 HARDENED
set -euo pipefail
exec > >(tee -a verbatim_handshake.log) 2>&1

log_and_tee() {
  echo -e "\033[1;36m[$(date '+%H:%M:%S')]\033[0m $1" | tee -a verbatim_handshake.log
}

log_and_tee "Cold-Start Nuclear Orchestrator v30.3 (hardened) starting..."

if [ -f "recovery_complete.flag" ] && [ "${1:-}" != "--force" ]; then
  log_and_tee "Idempotent skip – already complete"
  exit 0
fi

acquire_mutex() {
  if [ -f ".recovery_mutex" ] && kill -0 "$(cat .recovery_mutex)" 2>/dev/null; then
    log_and_tee "⚠️  Another recovery in progress – skipping"
    exit 0
  fi
  echo $$ > ".recovery_mutex"
}

retry_command() {
  local cmd="$1" desc="${2:-Command}" max=5
  for i in $(seq 1 $max); do
    log_and_tee "→ [RETRY $i/$max] $desc"
    if eval "$cmd" 2>&1 | tee -a verbatim_handshake.log; then
      return 0
    fi
    sleep $((2**i))
  done
  log_and_tee "❌ Failed after $max retries: $desc"
  return 1
}

acquire_mutex

sudo fuser -k 3000/tcp 24678/tcp 2>/dev/null || true
retry_command "sudo -n /usr/local/bin/fix-wifi --workspace \"$(pwd)\" --force" "Nuclear recovery"

touch recovery_complete.flag
rm -f ".recovery_mutex"

log_and_tee "Cold-Start COMPLETE – dashboard ready at http://localhost:3000"
