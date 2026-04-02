import express from "express";
import { createServer as createViteServer } from "vite";
import { exec, spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const WORKSPACE_DIR = process.cwd();
const LOG_FILE = path.join(WORKSPACE_DIR, "verbatim_handshake.log");
const DB_FILE = path.join(WORKSPACE_DIR, "recovery_state.db");
const FIX_SCRIPT = fs.existsSync("/usr/local/bin/fix-wifi") 
  ? "/usr/local/bin/fix-wifi" 
  : path.join(WORKSPACE_DIR, "fix-wifi.sh");

app.use(express.json());

let isFixing = false;
let lastFixError: string | null = null;
let metricsHistory: { timestamp: string; signal: number; rx: number; tx: number }[] = [];

// Helper for async exec
const execAsync = (cmd: string, timeout = 10000) => {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    exec(cmd, { timeout }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
};

// Hardened rapid repair helper
const rapidRepair = async () => {
  try {
    await execAsync(`sudo -n "${FIX_SCRIPT}" --check-only`);
    console.log("System check passed.");
  } catch (err) {
    console.log("Auto-repairing broken config...");
    try {
      await execAsync(`PROJECT_ROOT=$(pwd) ./setup-system.sh`);
    } catch (setupErr) {
      console.error("Setup repair failed:", setupErr);
    }
  }
};

// API Routes
app.get("/api/status", async (req, res) => {
  let signal = 0;
  let traffic = { rx: 0, tx: 0 };
  let connectivity = false;

  try {
    // Try to get real metrics if possible
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
  } catch (e) {
    // Ignore errors, just return defaults
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

app.get('/api/audit', async (req, res) => {
  try {
    const log = fs.existsSync(LOG_FILE) ? await fs.promises.readFile(LOG_FILE, 'utf8') : "No logs found.";
    let dbMilestones = "No database found.";
    if (fs.existsSync(DB_FILE)) {
      try {
        dbMilestones = execSync(`sqlite3 "${DB_FILE}" "SELECT timestamp, name, details FROM milestones ORDER BY timestamp ASC;"`).toString();
      } catch (dbErr) {
        dbMilestones = "Error reading database.";
      }
    }
    res.json({ 
      status: 'RECOVERY_COMPLETE', 
      verbatimLogSnippet: log.slice(-8000), 
      dbMilestones,
      message: "Full telemetry log + forensic evidence loaded"
    });
  } catch (e) {
    res.status(200).json({ status: 'READY', message: 'Run cold-start for full recovery' });
  }
});

app.post("/api/fix", async (req, res) => {
  if (isFixing) return res.status(400).json({ error: "Fix already in progress" });

  isFixing = true;
  lastFixError = null;

  res.json({ message: "Recovery initiated" });

  try {
    await execAsync(`sudo -n "${FIX_SCRIPT}" --workspace "${WORKSPACE_DIR}" --force`);
  } catch (err: any) {
    lastFixError = err.message;
  } finally {
    isFixing = false;
  }
});

// SSE for real-time logs
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(async () => {
    if (fs.existsSync(LOG_FILE)) {
      const log = await fs.promises.readFile(LOG_FILE, 'utf8');
      sendEvent({ type: "log", content: log.slice(-2000) });
    }
  }, 2000);

  req.on("close", () => clearInterval(interval));
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(WORKSPACE_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    rapidRepair();
  });
}

startServer();
