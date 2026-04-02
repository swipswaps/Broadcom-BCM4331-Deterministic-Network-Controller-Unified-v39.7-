# 🛰️ Broadcom BCM4331 Deterministic Network Controller (Unified v39.7)

**Hardened, forensic-grade, self-healing Wi-Fi recovery suite** for BCM4331 [14e4:4331] on Fedora 43+ (X11/GNOME).

### Quick Start (Recommended)

```bash
git clone https://github.com/swipswaps/bcm4331-fedora-deterministic-network-controller.git
cd bcm4331-fedora-deterministic-network-controller

npm run setup          # one-time (sudoers + execute bits)
npm run cold-start     # nuclear recovery if Wi-Fi dead
npm run dev            # live dashboard → http://localhost:3000
```

### Full User Guide

1.  **One-time system setup**
    `npm run setup` → installs dependencies, creates passwordless sudoers drop-in, sets execute bits.
2.  **Nuclear recovery** (use when "Enable Networking" is grayed out)
    `npm run cold-start` → runs full forensic sweep + driver reload.
3.  **Live dashboard**
    `npm run dev` → real-time metrics, telemetry, one-click fix.
4.  **Autonomous mode**
    `sudo systemctl enable --now fix-wifi.timer` → PID self-healing every 5 min.
5.  **Offline bundle**
    `./prepare-bundle.sh` → creates air-gapped firmware bundle.

### Troubleshooting Matrix

| Symptom | Likely Cause | Fix Command | Expected Result |
| :--- | :--- | :--- | :--- |
| "sudo: a password is required" | No NOPASSWD rule | `npm run setup` | sudo -n commands succeed |
| Telemetry shows "(unavailable)" | Missing sudoers / permissions | `npm run setup` | Full dmesg/journalctl data |
| Dashboard blank / no logs | fix-wifi.log owned by root | `npm run setup` | Live log stream appears |
| "Enable Networking" grayed out | NM applet state | `npm run cold-start` | Networking re-enabled |
| Script says "another recovery running" | Mutex lock | `rm -f .recovery_mutex` | Recovery proceeds |
| No Wi-Fi interface detected | Driver unloaded | `npm run cold-start` | b43 reloaded + interface up |
| `npm run dev` fails with module error | Missing dep | `npm install` | Server starts on 3000 |

### License
MIT
Consolidated & Hardened April 2026 by swipswaps
