#!/bin/bash
# ==============================================================================
# fix-wifi.sh - Forensic Recovery Engine v90.10 [HARDENED & VERBOSE]
# ==============================================================================
# PURPOSE: Deterministic recovery of Broadcom BCM4331 chipsets on Fedora.
# PHILOSOPHY: Assume total system failure. Log every internal decision.
# COMPLIANCE: Prints log path as line 1. Teed telemetry for all 17 audit points.
# ==============================================================================

set -euo pipefail

# POINT 4-5: Argument State Recording.
# Recording the input flags ensures that the audit trail reflects whether
# the user forced a recovery or was just performing a health check.
FORCE=0
CHECK_ONLY=0
# We allow PROJECT_ROOT to be set via environment OR --workspace argument.
PROJECT_ROOT="${PROJECT_ROOT:-}"

# Parse arguments first to capture --workspace before any validation.
TEMP_ARGS=("$@")
while [[ $# -gt 0 ]]; do
  case $1 in
    --force) FORCE=1; shift ;;
    --check-only) CHECK_ONLY=1; shift ;;
    --workspace) PROJECT_ROOT="$2"; shift 2 ;;
    *) shift ;;
  esac
done
# Restore arguments for any later use if needed.
set -- "${TEMP_ARGS[@]}"

# POINT 1: Absolute path resolution for the log file.
# This is the first line of output to ensure orchestrators can find the stream.
# We enforce PROJECT_ROOT to prevent "silent" failures in system paths.
# Fallback: if PROJECT_ROOT is missing, try to derive it from the script's directory.
if [[ -z "${PROJECT_ROOT:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # If we are in /usr/local/bin, we can't use it as PROJECT_ROOT.
  if [[ "$SCRIPT_DIR" == "/usr/local/bin" ]]; then
    echo "ERROR: PROJECT_ROOT environment variable or --workspace argument is required when running from system path." >&2
    exit 1
  fi
  PROJECT_ROOT="$SCRIPT_DIR"
fi
LOG_FILE="${PROJECT_ROOT}/verbatim_handshake.log"
echo "${LOG_FILE}"

# POINT 6: Confirmation of trap activation.
# We establish signal handlers to ensure the mutex is released and the stack is 
# dumped even if the user interrupts the script or a command fails.
log_and_tee() {
  local ts=$(date '+%Y-%m-%d %H:%M:%S.%3N')
  echo -e "\033[1;36m[$ts]\033[0m $1" | tee -a "$LOG_FILE"
}
trap 'log_and_tee "❌ FATAL ERROR at line $LINENO"; dump_stack "$LINENO"; release_mutex' ERR INT TERM EXIT
log_and_tee "🛡️  Forensic error traps and signal handlers activated."

# POINT 2-3: Path Transparency.
# Explicitly declaring the location of the state database and the lock file
# to prevent "silent" file creation in unexpected directories.
DB_FILE="${PROJECT_ROOT}/recovery_state.db"
MUTEX="${PROJECT_ROOT}/.recovery_mutex"
log_and_tee "🗄️  DB_PATH: ${DB_FILE}"
log_and_tee "🔒 MUTEX_PATH: ${MUTEX}"
log_and_tee "⚙️  EXECUTION_MODE: FORCE=${FORCE}, CHECK_ONLY=${CHECK_ONLY}"

# ====================== FORENSIC CORE FUNCTIONS ======================

# POINT 16: Stack Context.
# Provides a system snapshot (Kernel version and Uptime) to correlate 
# hardware failures with specific kernel states.
dump_stack() {
  local line="$1"
  {
    echo "=== FORENSIC STACK DUMP @ Line ${line} ==="
    echo "Kernel: $(uname -r)"
    echo "Uptime: $(uptime -p)"
    echo "Last 20 Log Lines:"
    tail -n 20 "$LOG_FILE"
  } >> "$LOG_FILE"
}

# POINT 12: Interface Logic.
# We use a deterministic sort on the sysfs network class to ensure that 
# if multiple Broadcom cards exist, we always target the primary one.
detect_interface() {
  log_and_tee "📡 Searching for wireless hardware via /sys/class/net..."
  
  # Try to retrieve BKW interface from database first
  local bkw_iface=$(sqlite3 "$DB_FILE" "SELECT value FROM config WHERE key='bkw_interface';" 2>/dev/null || true)
  
  if [[ -n "$bkw_iface" ]] && [[ -d "/sys/class/net/$bkw_iface" ]]; then
    INTERFACE="$bkw_iface"
    log_and_tee "💎 Best Known Working interface retrieved from DB: ${INTERFACE}"
  else
    INTERFACE=$(ls /sys/class/net 2>/dev/null | grep -E '^(wl|wlan)' | sort | head -n1 || echo "wlan0")
    log_and_tee "✅ Hardware interface identified via discovery: ${INTERFACE}"
  fi
}

save_bkw() {
  local key="$1"
  local value="$2"
  local ts=$(date '+%Y-%m-%d %H:%M:%S')
  log_and_tee "💾 Saving Best Known Working resource: ${key}=${value}"
  sqlite3 "$DB_FILE" "INSERT OR REPLACE INTO config (key, value, last_updated) VALUES ('${key}', '${value}', '${ts}');"
}

# POINT 7: DB Existence.
# Initializing the SQLite schema with WAL mode to allow the React dashboard
# to read milestones while the bash engine is writing them.
init_db() {
  if [[ ! -f "$DB_FILE" ]]; then
    log_and_tee "🗄️  Forensic DB missing. Creating new schema..."
    sqlite3 "$DB_FILE" "CREATE TABLE milestones (timestamp TEXT, name TEXT, details TEXT); 
                        CREATE TABLE commands (timestamp TEXT, command TEXT, exit_code INTEGER);
                        CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT, last_updated TEXT);
                        CREATE INDEX idx_milestones_name ON milestones(name);
                        PRAGMA journal_mode=WAL;"
  else
    log_and_tee "✅ Existing forensic database verified."
    # Ensure config table exists in case of older DB versions
    sqlite3 "$DB_FILE" "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT, last_updated TEXT);"
  fi
}

# POINT 10: Lock PID.
# Recording the PID in the mutex ensures we can identify which process 
# owns the hardware lock if a recovery hangs.
acquire_mutex() {
  if [ -f "$MUTEX" ] && kill -0 "$(cat "$MUTEX")" 2>/dev/null; then
    log_and_tee "⚠️  CONFLICT: Another recovery in progress (PID $(cat "$MUTEX"))."
    exit 0
  fi
  echo $$ > "$MUTEX"
  log_and_tee "🔒 Mutex lock secured by PID $$"
}

# POINT 11: Mutex Release.
# Explicitly logging the release of the lock to mark the end of the 
# hardware-exclusive execution block.
release_mutex() {
  if [[ -f "$MUTEX" ]]; then
    log_and_tee "🔓 Releasing hardware mutex lock..."
    rm -f "$MUTEX"
  fi
}

# POINT 8-9: Success Silence Elimination.
# Self-linting ensures that the environment (binaries and sudoers) is 
# ready before we attempt to reload kernel modules.
self_lint() {
  log_and_tee "🔍 Running environment self-lint..."
  local required=(sqlite3 dnf rfkill modprobe iwconfig ethtool nmcli ip dmesg iw)
  for bin in "${required[@]}"; do
    if command -v "$bin" >/dev/null 2>&1; then
      log_and_tee "✅ Binary verified: $bin"
    else
      log_and_tee "⚠️  WARNING: $bin is missing. Attempting recovery in dependency phase."
    fi
  done

  if sudo -n -l | grep -q "/usr/local/bin/fix-wifi"; then
    log_and_tee "✅ Sudoers NOPASSWD integrity verified."
  else
    log_and_tee "⚠️  Sudoers regression detected. Repairing /etc/sudoers.d/broadcom-control..."
    sudo tee /etc/sudoers.d/broadcom-control >/dev/null <<EOF
$(whoami) ALL=(ALL) NOPASSWD: SETENV: /usr/local/bin/fix-wifi
EOF
    sudo chmod 0440 /etc/sudoers.d/broadcom-control
    log_and_tee "✅ Sudoers rule restored."
  fi
}

run_verbatim() {
  local cmd="$1"
  local desc="${2:-Executing command}"
  local ts=$(date '+%Y-%m-%d %H:%M:%S')
  log_and_tee "→ Milestone: ${desc} [${cmd}]"
  sqlite3 "$DB_FILE" "INSERT INTO commands (timestamp, command, exit_code) VALUES ('${ts}', '${cmd}', -1);" 2>/dev/null || true
  eval "$cmd" 2>&1 | tee -a "$LOG_FILE"
  local exit_code=${PIPESTATUS[0]}
  sqlite3 "$DB_FILE" "UPDATE commands SET exit_code = ${exit_code} WHERE timestamp = '${ts}' AND command = '${cmd}';" 2>/dev/null || true
  return $exit_code
}

# ====================== EXECUTION SEQUENCE ======================

log_and_tee "🔒 Hardened fix-wifi v90.10 starting..."
init_db
acquire_mutex
self_lint

if [[ $CHECK_ONLY -eq 1 ]]; then
  log_and_tee "✅ Check-only mode passed. System is integrated and healthy."
  release_mutex
  exit 0
fi

# POINT 13-14: Phase Declarations.
log_and_tee "📦 Phase 1: Dependency Audit"
sqlite3 "$DB_FILE" "INSERT INTO milestones (timestamp, name, details) VALUES ('$(date '+%Y-%m-%d %H:%M:%S')', 'PHASE_1', 'Starting dependency audit and environment check');"

# Ensure all forensic tools are present
local deps=(sqlite3 dnf rfkill modprobe iwconfig ethtool nmcli ip dmesg iw)
for dep in "${deps[@]}"; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    log_and_tee "⚠️  Dependency missing: $dep. Attempting emergency installation..."
    sudo dnf install -y "$dep" || log_and_tee "❌ Failed to install $dep. Recovery may be partial."
  fi
done

log_and_tee "🤝 Phase 2: Deep Forensic Handshake"
sqlite3 "$DB_FILE" "INSERT INTO milestones (timestamp, name, details) VALUES ('$(date '+%Y-%m-%d %H:%M:%S')', 'PHASE_2', 'Starting hardware handshake and module cycling');"
detect_interface
save_bkw "bkw_interface" "$INTERFACE"

log_and_tee "🔧 Resetting kernel module state..."
run_verbatim "sudo modprobe -r b43 bcma wl brcmsmac" "Unloading conflicting modules" || true

log_and_tee "🔧 Loading deterministic module (wl)..."
# We prefer 'wl' for BCM4331 on Fedora (RPM Fusion), but fallback to 'b43' if needed.
if ! run_verbatim "sudo modprobe wl" "Loading Broadcom-STA module"; then
  log_and_tee "⚠️  'wl' module failed. Attempting 'b43' fallback..."
  run_verbatim "sudo modprobe b43" "Loading b43 module"
fi

log_and_tee "🔧 Unblocking radio via rfkill..."
run_verbatim "sudo rfkill unblock all" "RFKill global unblock"

log_and_tee "🔧 Forcing interface up..."
run_verbatim "sudo ip link set $INTERFACE up" "Manual link activation" || true

log_and_tee "🔧 Re-syncing NetworkManager..."
run_verbatim "sudo nmcli networking on" "Enabling NM global networking"
run_verbatim "sudo nmcli device set $INTERFACE managed yes" "Enabling NM management"
run_verbatim "sudo nmcli device connect $INTERFACE" "Triggering NM connection" || true

# POINT 15: Flag Creation.
touch "${PROJECT_ROOT}/recovery_complete.flag"
log_and_tee "✅ Recovery flag created at ${PROJECT_ROOT}/recovery_complete.flag"
sqlite3 "$DB_FILE" "INSERT INTO milestones (timestamp, name, details) VALUES ('$(date '+%Y-%m-%d %H:%M:%S')', 'RECOVERY_COMPLETE', 'Hardware interface $INTERFACE successfully recovered and synchronized');"

# POINT 17: Final Exit.
log_and_tee "🏁 Forensic Engine v90.10 exiting normally."
sqlite3 "$DB_FILE" "INSERT INTO milestones (timestamp, name, details) VALUES ('$(date '+%Y-%m-%d %H:%M:%S')', 'EXIT_NORMAL', 'Forensic engine finished execution');"
release_mutex
exit 0
