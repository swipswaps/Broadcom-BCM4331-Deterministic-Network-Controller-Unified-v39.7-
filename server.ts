import express from "express";
import { createServer as createViteServer } from "vite";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 3000;
const WORKSPACE_DIR = process.cwd();
const LOG_FILE = path.join(WORKSPACE_DIR, "verbatim_handshake.log");
const DB_FILE = path.join(WORKSPACE_DIR, "recovery_state.db");

// CRITICAL: Centralized logTee helper for server-side transparency
// This ensures that every backend decision is mirrored in the telemetry log.
const logTee = (msg: string) => {
  const ts = new Date().toISOString();
  const formatted = `[SERVER ${ts}] ${msg}`;
  console.log(formatted);
  try {
    fs.appendFileSync(LOG_FILE, formatted + "\n");
  } catch (e) {
    console.error(`[CRITICAL] Failed to write to log file: ${e}`);
  }
};

process.on('unhandledRejection', (reason, promise) => {
  logTee(`🚨 UNHANDLED REJECTION: ${reason} at ${promise}`);
});

process.on('uncaughtException', (err) => {
  logTee(`🚨 UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`);
});

// POINTS 1-4: Environment Resolution
// We log these immediately to ensure the audit trail starts with path context.
logTee(`Initializing Broadcom Control Center...`);
logTee(`WORKSPACE_DIR: ${WORKSPACE_DIR}`);
logTee(`LOG_FILE: ${LOG_FILE}`);
logTee(`DB_FILE: ${DB_FILE}`);

const FIX_SCRIPT = fs.existsSync("/usr/local/bin/fix-wifi") 
  ? "/usr/local/bin/fix-wifi" 
  : path.join(WORKSPACE_DIR, "fix-wifi.sh");
logTee(`FIX_SCRIPT_PATH: ${FIX_SCRIPT}`);

app.use(express.json());

let isFixing = false;
let lastFixError: string | null = null;
const metricsHistory: { timestamp: string; signal: number; rx: number; tx: number }[] = [];

const runCommand = (cmd: string, env: Record<string, string> = {}): Promise<void> => {
  return new Promise((resolve, reject) => {
    // Use shell: true to handle sudo and environment variables in the command string
    const child = spawn(cmd, [], { 
      env: { ...process.env, ...env }, 
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'] 
    });

    child.stdout?.on('data', (data) => {
      data.toString().split('\n').forEach((line: string) => {
        if (line.trim()) {
          // We only console.log here because the script itself (fix-wifi.sh) 
          // is already teeing its output to the LOG_FILE.
          console.log(`[STDOUT] ${line}`);
        }
      });
    });

    child.stderr?.on('data', (data) => {
      data.toString().split('\n').forEach((line: string) => {
        if (line.trim()) {
          console.error(`[STDERR] ${line}`);
        }
      });
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
};

// POINTS 5-8: Hardened Rapid Repair Logic
// The server autonomously checks its own environment on boot.
const rapidRepair = async () => {
  logTee("🔍 Starting rapid system health check...");
  try {
    const localSetupPath = path.join(WORKSPACE_DIR, "setup-system.sh");
    const localFixPath = path.join(WORKSPACE_DIR, "fix-wifi.sh");

    // Ensure scripts are executable
    execSync(`chmod +x "${localFixPath}" "${localSetupPath}"`);

    if (!fs.existsSync("/usr/local/bin/fix-wifi")) {
      logTee("⚠️  Fix script missing from system path. Attempting restoration via setup-system.sh...");
      await runCommand(`PROJECT_ROOT="${WORKSPACE_DIR}" bash "${localSetupPath}"`);
      logTee("✅ System setup recovery completed via rapidRepair.");
    } else {
      logTee("Executing health check: fix-wifi --check-only");
      await runCommand(`sudo -n PROJECT_ROOT="${WORKSPACE_DIR}" "${FIX_SCRIPT}" --check-only --workspace "${WORKSPACE_DIR}"`);
      logTee("✅ System health verified. Sudoers and dependencies are intact.");
    }
  } catch (err: unknown) {
    const error = err as { message?: string };
    logTee(`❌ Rapid repair failed: ${error.message || String(error)}. Triggering full setup recovery...`);
    try {
      const localSetupPath = path.join(WORKSPACE_DIR, "setup-system.sh");
      await runCommand(`PROJECT_ROOT="${WORKSPACE_DIR}" bash "${localSetupPath}"`);
      logTee("✅ Full setup recovery completed.");
    } catch (setupErr) {
      logTee(`🚨 CRITICAL: System recovery failed. Manual intervention required: ${setupErr}`);
    }
  }
};

// POINT 9: API Routes - Status
app.get("/api/status", async (req, res) => {
  let signal = 0;
  let traffic = { rx: 0, tx: 0 };
  let connectivity = false;
  let bkwInterface = "Unknown";

  try {
    // Retrieve BKW interface from database
    try {
      if (fs.existsSync(DB_FILE)) {
        bkwInterface = execSync(`sqlite3 "${DB_FILE}" "SELECT value FROM config WHERE key='bkw_interface';"`, { timeout: 1000, encoding: 'utf8' }).trim() || "Unknown";
      }
    } catch (dbErr) {
      console.warn(`Failed to retrieve BKW interface from DB: ${dbErr}`);
    }

    // Use timeouts to prevent hanging the server if system commands stall
    const iwOutput = execSync("iw dev | grep Interface | awk '{print $2}' | xargs -I {} iw dev {} link", { timeout: 2000, encoding: 'utf8' }).toString();
    const signalMatch = iwOutput.match(/signal:\s+(-?\d+)\s+dBm/);
    if (signalMatch) signal = parseInt(signalMatch[1]);

    // Handle grep failure gracefully (it returns exit code 1 if no matches found)
    const statsOutput = execSync("cat /proc/net/dev | grep -E 'wl|wlan' || true", { timeout: 1000, encoding: 'utf8' }).toString();
    if (statsOutput.trim()) {
      const stats = statsOutput.trim().split(/\s+/);
      if (stats.length > 10) {
        traffic = { rx: parseInt(stats[1]), tx: parseInt(stats[9]) };
      }
    }

    try {
      execSync("ping -c 1 -W 1 8.8.8.8", { timeout: 1500 });
      connectivity = true;
    } catch {
      connectivity = false;
    }
  } catch (err) {
    // Log but don't crash; partial data is better than an error page
    console.warn(`Status fetch partial failure: ${err}`);
  }

  const timestamp = new Date().toLocaleTimeString();
  metricsHistory.push({ timestamp, signal, ...traffic });
  if (metricsHistory.length > 50) metricsHistory.shift();

  res.setHeader('Content-Type', 'application/json');
  res.json({
    isFixing,
    lastFixError,
    signal,
    traffic,
    connectivity,
    bkwInterface,
    metricsHistory,
    timestamp: new Date().toISOString()
  });
});

// POINT 10: API Routes - Audit
app.get('/api/audit', async (req, res) => {
  logTee("GET /api/audit - Fetching forensic evidence");
  try {
    const log = fs.existsSync(LOG_FILE) ? await fs.promises.readFile(LOG_FILE, 'utf8') : "No logs found.";
    let dbMilestones = "No database found.";
    if (fs.existsSync(DB_FILE)) {
      try {
        // Explicitly use pipe separator for consistent parsing in App.tsx
        dbMilestones = execSync(`sqlite3 -separator "|" "${DB_FILE}" "SELECT timestamp, name, details FROM milestones ORDER BY timestamp ASC;"`).toString();
      } catch (dbErr) {
        dbMilestones = `Error reading database: ${dbErr}`;
      }
    }
    res.json({ 
      status: 'RECOVERY_COMPLETE', 
      verbatimLogSnippet: log.slice(-8000), 
      dbMilestones,
      message: "Full telemetry log + forensic evidence loaded"
    });
  } catch (e) {
    logTee(`Error during audit fetch: ${e}`);
    res.status(200).json({ status: 'READY', message: 'Run cold-start for full recovery' });
  }
});

// POINTS 11-14: API Routes - Fix
app.post("/api/fix", async (req, res) => {
  logTee("POST /api/fix - Recovery request received");
  if (isFixing) {
    logTee("⚠️  Fix requested while already in progress. Ignoring.");
    return res.status(400).json({ error: "Fix already in progress" });
  }

  isFixing = true;
  lastFixError = null;

  res.json({ message: "Recovery initiated" });

  const cmd = `sudo -n PROJECT_ROOT="${WORKSPACE_DIR}" "${FIX_SCRIPT}" --workspace "${WORKSPACE_DIR}" --force`;
  logTee(`🚀 Spawning recovery process: ${cmd}`);

  try {
    await runCommand(cmd);
    logTee("✅ Recovery process completed successfully.");
  } catch (err: unknown) {
    lastFixError = err instanceof Error ? err.message : String(err);
    logTee(`❌ Recovery process failed: ${lastFixError}`);
  } finally {
    isFixing = false;
  }
});

// POINTS 15-16: SSE for real-time logs
app.get("/api/events", (req, res) => {
  logTee("SSE /api/events - Client connected for real-time telemetry");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data: { type: string; content: string }) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(async () => {
    if (fs.existsSync(LOG_FILE)) {
      const log = await fs.promises.readFile(LOG_FILE, 'utf8');
      sendEvent({ type: "log", content: log.slice(-2000) });
    }
  }, 2000);

  req.on("close", () => {
    logTee("SSE /api/events - Client disconnected");
    clearInterval(interval);
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    logTee("Starting server in DEVELOPMENT mode (Vite middleware enabled)");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    logTee("Starting server in PRODUCTION mode (Static serving enabled)");
    const distPath = path.join(WORKSPACE_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // POINT 17: Port Binding
  app.listen(PORT, "0.0.0.0", () => {
    logTee(`📡 Broadcom Control Center listening on http://localhost:${PORT}`);
    rapidRepair();
    
    // Heartbeat and Telemetry logging
    setInterval(async () => {
      const ts = new Date().toISOString();
      let signal = 0;
      let traffic = { rx: 0, tx: 0 };
      let connectivity = false;
      let bkwInterface = "Unknown";

      try {
        if (fs.existsSync(DB_FILE)) {
          bkwInterface = execSync(`sqlite3 "${DB_FILE}" "SELECT value FROM config WHERE key='bkw_interface';"`, { timeout: 1000, encoding: 'utf8' }).trim() || "Unknown";
        }
        const iwOutput = execSync("iw dev | grep Interface | awk '{print $2}' | xargs -I {} iw dev {} link", { timeout: 2000, encoding: 'utf8' }).toString();
        const signalMatch = iwOutput.match(/signal:\s+(-?\d+)\s+dBm/);
        if (signalMatch) signal = parseInt(signalMatch[1]);
        const statsOutput = execSync("cat /proc/net/dev | grep -E 'wl|wlan' || true", { timeout: 1000, encoding: 'utf8' }).toString();
        if (statsOutput.trim()) {
          const stats = statsOutput.trim().split(/\s+/);
          if (stats.length > 10) {
            traffic = { rx: parseInt(stats[1]), tx: parseInt(stats[9]) };
          }
        }
        try {
          execSync("ping -c 1 -W 1 8.8.8.8", { timeout: 1500 });
          connectivity = true;
        } catch {
          connectivity = false;
        }
      } catch {
        // Silent fail for background telemetry
      }

      logTee(`📡 Forensic Telemetry Snapshot [${ts}]: Signal=${signal}dBm, RX=${traffic.rx}B, TX=${traffic.tx}B, Connectivity=${connectivity ? "ONLINE" : "OFFLINE"}, BKW_IFACE=${bkwInterface}`);
    }, 30000);
  });
}

startServer();
