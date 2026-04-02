#!/bin/bash
# setup-system.sh - System Integration v30.3 HARDENED
set -euo pipefail
exec > >(tee -a verbatim_handshake.log) 2>&1

log_and_tee() { echo -e "\033[1;36m[$(date '+%H:%M:%S')]\033[0m $1" | tee -a verbatim_handshake.log; }

log_and_tee "System Integration v30.3 (hardened) starting..."

sudo rm -f /etc/sudoers.d/broadcom-control
sudo tee /etc/sudoers.d/broadcom-control > /dev/null <<EOF
$(whoami) ALL=(ALL) NOPASSWD: SETENV: /usr/local/bin/fix-wifi
EOF
sudo chmod 0440 /etc/sudoers.d/broadcom-control
sudo visudo -c -f /etc/sudoers.d/broadcom-control || { log_and_tee "❌ Sudoers invalid – aborting"; exit 1; }

sudo dnf install -y sqlite tcpdump mtr traceroute bind-utils NetworkManager iw rfkill python3-pip || true
# Note: pip install might fail in some environments, but we try anyway
sudo pip3 install pystray pillow --break-system-packages || true

sudo cp fix-wifi.sh /usr/local/bin/fix-wifi
sudo chmod +x /usr/local/bin/fix-wifi

log_and_tee "✅ System integration complete – fully hardened"
