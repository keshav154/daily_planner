import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { 
  Activity, RefreshCw, Cpu, CheckCircle2, AlertTriangle, AlertCircle, Info, ChevronRight, Loader2
} from 'lucide-react';

interface LogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

interface AgentRun {
  _id: string;
  trigger: string;
  createdAt: string;
  planOutput: {
    rationale: string;
    suggestions: Array<{
      id: string;
      actionType: string;
      description: string;
    }>;
  };
}

export const AgentActivityFeed: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await api.get('/agent/autonomous-status');
      setLogs(res.data.logs || []);
      setRuns(res.data.runs || []);
    } catch (err) {
      console.error('Failed to fetch autonomous status:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchStatus();
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'warn': return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-400" />;
      default: return <Info className="w-4 h-4 text-indigo-400" />;
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 flex items-center justify-center border border-indigo-500/20">
            <Cpu className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-neutral-100 tracking-tight">Agent Transparency Feed</h1>
            <p className="text-xs text-neutral-500">Observe raw background planner iterations, thinking cycles, and auto-executed decisions</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 bg-neutral-900 border border-white/5 hover:border-white/10 text-neutral-300 font-bold text-xs rounded-xl cursor-pointer transition-colors disabled:opacity-40"
        >
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh Feed
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Background Check Logs */}
        <div className="lg:col-span-7 glass-panel p-5 rounded-2xl border border-white/5 flex flex-col h-[550px]">
          <div className="flex items-center gap-2 pb-3 border-b border-white/5 mb-4">
            <Activity className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">System Daemon Logs</h3>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              </div>
            ) : logs.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-12">No logs recorded yet.</p>
            ) : (
              logs.map((logEntry, idx) => (
                <div 
                  key={idx} 
                  className="p-3 bg-neutral-950/20 border border-white/5 hover:border-white/10 rounded-xl flex items-start gap-3 transition-colors text-xs text-neutral-300"
                >
                  <div className="mt-0.5 shrink-0">{getLogIcon(logEntry.type)}</div>
                  <div className="flex-1 space-y-1 min-w-0">
                    <p className="font-sans leading-relaxed break-words">{logEntry.message}</p>
                    <span className="text-[9px] text-neutral-500 font-bold">
                      {new Date(logEntry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Recent Background Agent Runs */}
        <div className="lg:col-span-5 glass-panel p-5 rounded-2xl border border-white/5 flex flex-col h-[550px]">
          <div className="flex items-center gap-2 pb-3 border-b border-white/5 mb-4">
            <Cpu className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Background Thinking Runs</h3>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              </div>
            ) : runs.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-12">No runs executed yet.</p>
            ) : (
              runs.map((run) => (
                <div 
                  key={run._id} 
                  className="p-3.5 bg-neutral-950/40 border border-white/5 rounded-xl space-y-2.5 text-xs text-neutral-300"
                >
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-bold uppercase">
                      {run.trigger.replace('_', ' ')}
                    </span>
                    <span className="text-[9px] text-neutral-500 font-bold">
                      {new Date(run.createdAt).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[9px] uppercase font-bold text-neutral-500">Agent Rationale</div>
                    <p className="text-[11px] leading-relaxed font-sans text-neutral-400">{run.planOutput.rationale}</p>
                  </div>

                  {run.planOutput.suggestions && run.planOutput.suggestions.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[9px] uppercase font-bold text-neutral-500">Generated Actions</div>
                      <div className="space-y-1">
                        {run.planOutput.suggestions.map((s, idx) => (
                          <div key={idx} className="flex gap-1.5 items-start text-[10px] text-neutral-300">
                            <ChevronRight className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
                            <span>{s.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
