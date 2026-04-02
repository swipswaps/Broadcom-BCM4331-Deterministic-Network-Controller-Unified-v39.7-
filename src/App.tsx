import React, { useState, useEffect, useRef } from 'react';
import { 
  Wifi, 
  WifiOff, 
  Activity, 
  ShieldCheck, 
  Terminal, 
  Database, 
  AlertTriangle, 
  RefreshCw,
  Download,
  Settings,
  ChevronRight,
  Info
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';

interface Status {
  isFixing: boolean;
  lastFixError: string | null;
  signal: number;
  traffic: { rx: number; tx: number };
  connectivity: boolean;
  metricsHistory: { timestamp: string; signal: number; rx: number; tx: number }[];
  timestamp: string;
}

interface Audit {
  status: string;
  verbatimLogSnippet: string;
  dbMilestones: string;
  message: string;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'audit' | 'help'>('dashboard');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setStatus(data);
      } catch (e) {
        console.error("Failed to fetch status", e);
      }
    };

    const fetchAudit = async () => {
      try {
        const res = await fetch('/api/audit');
        const data = await res.json();
        setAudit(data);
      } catch (e) {
        console.error("Failed to fetch audit", e);
      }
    };

    fetchStatus();
    fetchAudit();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [audit?.verbatimLogSnippet]);

  const handleFix = async () => {
    try {
      await fetch('/api/fix', { method: 'POST' });
      // Status will update via polling
    } catch (e) {
      console.error("Failed to initiate fix", e);
    }
  };

  const getSignalColor = (dBm: number) => {
    if (dBm > -50) return 'text-green-500';
    if (dBm > -70) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-900/20">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">Broadcom Control</h1>
              <p className="text-xs text-slate-500 font-mono">v39.7 Deterministic Engine</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-full border border-slate-700">
              <div className={`w-2 h-2 rounded-full animate-pulse ${status?.connectivity ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-xs font-medium uppercase tracking-wider">
                {status?.connectivity ? 'Online' : 'Offline'}
              </span>
            </div>
            <button 
              onClick={handleFix}
              disabled={status?.isFixing}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                status?.isFixing 
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 active:scale-95'
              }`}
            >
              {status?.isFixing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              {status?.isFixing ? 'Recovering...' : 'Nuclear Fix'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Navigation Tabs */}
        <div className="flex gap-1 p-1 bg-slate-900 rounded-xl border border-slate-800 mb-8 w-fit">
          {[
            { id: 'dashboard', icon: Activity, label: 'Dashboard' },
            { id: 'logs', icon: Terminal, label: 'Live Logs' },
            { id: 'audit', icon: Database, label: 'Forensic Audit' },
            { id: 'help', icon: Info, label: 'Help' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id 
                  ? 'bg-slate-800 text-blue-400 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              {/* Stats Cards */}
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-slate-500 text-sm font-medium">Signal Strength</span>
                    <Wifi className={`w-5 h-5 ${status ? getSignalColor(status.signal) : 'text-slate-700'}`} />
                  </div>
                  <div className="text-3xl font-bold mb-1">{status?.signal || 0} <span className="text-sm font-normal text-slate-500">dBm</span></div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-1000 ${status?.signal && status.signal > -50 ? 'bg-green-500' : status?.signal && status.signal > -70 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, Math.max(0, (status?.signal || -100) + 100))}%` }}
                    />
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-slate-500 text-sm font-medium">Network Traffic</span>
                    <Activity className="w-5 h-5 text-blue-500" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500">RX</span>
                      <span className="font-mono">{(status?.traffic.rx || 0 / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500">TX</span>
                      <span className="font-mono">{(status?.traffic.tx || 0 / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-slate-500 text-sm font-medium">System State</span>
                    <Settings className="w-5 h-5 text-purple-500" />
                  </div>
                  <div className="text-sm font-medium">
                    {status?.isFixing ? (
                      <span className="text-yellow-500 flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Recovering...
                      </span>
                    ) : (
                      <span className="text-green-500 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4" />
                        Stable
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-2">PID Loop: Active</p>
                </div>
              </div>

              {/* Chart */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-2xl h-[400px]">
                <h3 className="text-sm font-medium text-slate-500 mb-6">Signal Telemetry (dBm)</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={status?.metricsHistory || []}>
                    <defs>
                      <linearGradient id="colorSignal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="timestamp" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis domain={[-100, 0]} stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                      itemStyle={{ color: '#3b82f6' }}
                    />
                    <Area type="monotone" dataKey="signal" stroke="#3b82f6" fillOpacity={1} fill="url(#colorSignal)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Sidebar Info */}
              <div className="space-y-6">
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                  <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    System Alerts
                  </h3>
                  <div className="space-y-3">
                    {status?.lastFixError && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                        <strong>Last Error:</strong> {status.lastFixError}
                      </div>
                    )}
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400">
                      Deterministic engine is monitoring b43 driver state.
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                  <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                    <Download className="w-4 h-4 text-green-500" />
                    Quick Actions
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    <button className="flex items-center justify-between p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs transition-colors group">
                      <span>Prepare Offline Bundle</span>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                    </button>
                    <button className="flex items-center justify-between p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs transition-colors group">
                      <span>Sync Updates</span>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div 
              key="logs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="bg-slate-900 px-6 py-4 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-bold">verbatim_handshake.log</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Real-time Telemetry</span>
              </div>
              <div className="p-6 h-[600px] overflow-y-auto font-mono text-xs leading-relaxed scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                <pre className="whitespace-pre-wrap text-slate-400">
                  {audit?.verbatimLogSnippet || "Waiting for logs..."}
                </pre>
                <div ref={logEndRef} />
              </div>
            </motion.div>
          )}

          {activeTab === 'audit' && (
            <motion.div 
              key="audit"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-500" />
                  Forensic Milestones
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3 font-medium">Timestamp</th>
                        <th className="px-4 py-3 font-medium">Milestone</th>
                        <th className="px-4 py-3 font-medium">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {audit?.dbMilestones.split('\n').filter(l => l.trim()).map((line, i) => {
                        const [ts, name, details] = line.split('|');
                        return (
                          <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                            <td className="px-4 py-3 font-mono text-xs text-slate-500">{ts}</td>
                            <td className="px-4 py-3 font-bold text-blue-400">{name}</td>
                            <td className="px-4 py-3 text-slate-400">{details}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'help' && (
            <motion.div 
              key="help"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-3xl mx-auto space-y-8"
            >
              <section>
                <h3 className="text-xl font-bold mb-4">Troubleshooting Matrix</h3>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-800/50 text-xs text-slate-400 uppercase">
                      <tr>
                        <th className="px-6 py-4">Symptom</th>
                        <th className="px-6 py-4">Fix Command</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {[
                        { s: 'Enable Networking grayed out', f: 'npm run cold-start' },
                        { s: 'Sudo password required', f: 'npm run setup' },
                        { s: 'No interface detected', f: 'Check b43 firmware' },
                        { s: 'Another recovery running', f: 'rm -f .recovery_mutex' },
                      ].map((item, i) => (
                        <tr key={i}>
                          <td className="px-6 py-4 font-medium">{item.s}</td>
                          <td className="px-6 py-4 font-mono text-blue-400">{item.f}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              
              <section className="bg-blue-600/10 border border-blue-500/20 p-6 rounded-2xl">
                <h4 className="font-bold text-blue-400 mb-2">Deterministic Philosophy</h4>
                <p className="text-sm text-slate-400 leading-relaxed">
                  This tool assumes the system is in its worst possible state. It uses a forensic-first approach, 
                  logging every ICMP handshake and driver state change to a persistent SQLite database. 
                  The PID loop ensures that even if the driver crashes, it is recovered within 5 minutes automatically.
                </p>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-12 py-8 text-center">
        <p className="text-xs text-slate-600">
          Broadcom BCM4331 Deterministic Network Controller &copy; 2026 swipswaps
        </p>
      </footer>
    </div>
  );
}
