import express from "express";
import { createServer as createViteServer } from "vite";
import { exec, execSync } from "child_process";
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

const execAsync = (cmd: string, timeout = 30000) => {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    exec(cmd, { timeout }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
};

// POINTS 5-8: Hardened Rapid Repair Logic
// The server autonomously checks its own environment on boot.
const rapidRepair = async () => {
  logTee("🔍 Starting rapid system health check...");
  try {
    if (!fs.existsSync("/usr/local/bin/fix-wifi")) {
      logTee("⚠️  Fix script missing from system path. Attempting restoration...");
      await execAsync(`sudo cp fix-wifi.sh /usr/local/bin/fix-wifi && sudo chmod +x /usr/local/bin/fix-wifi`);
      logTee("✅ Fix script restored to /usr/local/bin/fix-wifi");
    }
    
    logTee("Executing health check: fix-wifi --check-only");
    await execAsync(`sudo -n PROJECT_ROOT="${WORKSPACE_DIR}" "${FIX_SCRIPT}" --check-only --workspace "${WORKSPACE_DIR}"`);
    logTee("✅ System health verified. Sudoers and dependencies are intact.");
  } catch (err) {
    logTee(`❌ Rapid repair failed: ${err}. Triggering full setup recovery...`);
    try {
      await execAsync(`PROJECT_ROOT=${WORKSPACE_DIR} ./setup-system.sh`);
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

  try {
    const iwOutput = execSync("iw dev | grep Interface | awk '{print $2}' | xargs -I {} iw dev {} link").toString();
    const signalMatch = iwOutput.match(/signal:\s+(-?\d+)\s+dBm/);
    if (signalMatch) signal = parseInt(signalMatch[1]);

    const statsOutput = execSync("cat /proc/net/dev | grep -E 'wl|wlan'").toString();
    const stats = statsOutput.trim().split(/\s+/);
    if (stats.length > 10) {
      traffic = { rx: parseInt(stats[1]), tx: parseInt(stats[9]) };
    }

    execSync("ping -c 1 -W 1 8.8.8.8");
    connectivity = true;
  } catch {
    // Connectivity failure is a valid state
  }

  const timestamp = new Date().toLocaleTimeString();
  metricsHistory.push({ timestamp, signal, ...traffic });
  if (metricsHistory.length > 50) metricsHistory.shift();

  res.json({
    isFixing,
    lastFixError,
    signal,
    traffic,
    connectivity,
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
        dbMilestones = execSync(`sqlite3 "${DB_FILE}" "SELECT timestamp, name, details FROM milestones ORDER BY timestamp ASC;"`).toString();
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
    await execAsync(cmd);
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
  });
}

startServer();
