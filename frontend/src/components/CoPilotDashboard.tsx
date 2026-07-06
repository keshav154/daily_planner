import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { 
  Cpu, Heart, Plus, CheckCircle, Trash2, Terminal, Loader2
} from 'lucide-react';

interface Memory {
  _id: string;
  content: string;
  type: 'pattern' | 'preference' | 'adjustment' | 'general';
  category: string;
  feedback: 'none' | 'accepted' | 'rejected';
  createdAt: string;
}

interface BackgroundLog {
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export const CoPilotDashboard: React.FC = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [logs, setLogs] = useState<BackgroundLog[]>([]);
  const [newRule, setNewRule] = useState('');
  const [ruleType, setRuleType] = useState<'preference' | 'pattern'>('preference');
  const [ruleCategory, setRuleCategory] = useState('scheduling');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'memories' | 'background'>('memories');

  useEffect(() => {
    fetchCoPilotData();
  }, []);

  const fetchCoPilotData = async () => {
    setLoading(true);
    try {
      const [memoriesRes, statusRes] = await Promise.all([
        api.get('/agent/memories'),
        api.get('/agent/autonomous-status')
      ]);
      setMemories(memoriesRes.data);
      setLogs(statusRes.data.logs);
    } catch (err: any) {
      console.error(err);
      alert('Error fetching CoPilot data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateMemoryFeedback = async (id: string, feedback: 'accepted' | 'rejected') => {
    try {
      await api.put(`/agent/memories/${id}`, { feedback });
      // Refresh list locally
      setMemories(prev => prev.map(m => m._id === id ? { ...m, feedback } : m));
    } catch (err) {
      console.error(err);
      alert('Failed to update memory feedback.');
    }
  };

  const handleAddManualRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRule.trim()) return;

    try {
      const res = await api.post('/agent/memories', {
        content: newRule.trim(),
        type: ruleType,
        category: ruleCategory
      });
      setMemories(prev => [res.data, ...prev]);
      setNewRule('');
    } catch (err: any) {
      console.error(err);
      alert('Failed to create custom rule: ' + err.message);
    }
  };

  const getLogTypeBadge = (type: string) => {
    switch (type) {
      case 'success': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10';
      case 'warn': return 'bg-amber-500/10 text-amber-400 border-amber-500/10';
      case 'error': return 'bg-red-500/10 text-red-400 border-red-500/10';
      default: return 'bg-blue-500/10 text-blue-400 border-blue-500/10';
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black text-gradient flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-400" /> Kortex Co-pilot Control Center
        </h2>
        <p className="text-xs text-neutral-400 mt-1">
          Manage semantic agent memories, view background execution loop audits, and curate custom preference parameters.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/5 pb-px">
        <button
          onClick={() => setActiveTab('memories')}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === 'memories' 
              ? 'border-indigo-500 text-neutral-200' 
              : 'border-transparent text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Long-Term Memories & Rules
        </button>
        <button
          onClick={() => setActiveTab('background')}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === 'background' 
              ? 'border-indigo-500 text-neutral-200' 
              : 'border-transparent text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Proactive Background Monitor
        </button>
      </div>

      {loading ? (
        <div className="h-64 flex flex-col items-center justify-center gap-2 text-neutral-500 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          <span>Synchronizing Co-pilot state...</span>
        </div>
      ) : activeTab === 'memories' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Add custom preference rule */}
          <div className="glass-panel p-5 rounded-2xl h-fit border border-white/5 space-y-4">
            <h3 className="text-xs font-bold text-neutral-300 flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-400" />
              Configure Custom Rule
            </h3>
            
            <form onSubmit={handleAddManualRule} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-[10px] text-neutral-400 font-bold">Rule Description</label>
                <textarea
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  placeholder="E.g., I prefer working on heavy coding projects between 10am and 1pm."
                  className="w-full h-24 p-3 rounded-xl text-xs glass-input resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-neutral-400 font-bold">Type</label>
                  <select
                    value={ruleType}
                    onChange={(e: any) => setRuleType(e.target.value)}
                    className="w-full p-2.5 rounded-xl text-xs glass-input"
                  >
                    <option value="preference">Preference</option>
                    <option value="pattern">Pattern</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-neutral-400 font-bold">Category</label>
                  <select
                    value={ruleCategory}
                    onChange={(e) => setRuleCategory(e.target.value)}
                    className="w-full p-2.5 rounded-xl text-xs glass-input"
                  >
                    <option value="scheduling">Scheduling</option>
                    <option value="estimation">Estimation</option>
                    <option value="productivity">Focus Mode</option>
                    <option value="general">General</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={!newRule.trim()}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Add Rule
              </button>
            </form>
          </div>

          {/* Memory List curation deck */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-neutral-300 flex items-center gap-2">
                <Heart className="w-4 h-4 text-rose-400" />
                Active Knowledge Base ({memories.length})
              </h3>
            </div>

            {memories.length === 0 ? (
              <div className="glass-panel p-8 text-center text-neutral-500 text-xs rounded-2xl border border-white/5">
                No memories or constraints loaded in knowledge base yet.
              </div>
            ) : (
              <div className="space-y-3">
                {memories.map((m) => (
                  <div
                    key={m._id}
                    className="glass-panel p-4 rounded-xl border border-white/5 flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/10 uppercase">
                          {m.type}
                        </span>
                        <span className="text-[9px] font-bold bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded-full border border-white/5 uppercase">
                          {m.category}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-200 leading-relaxed font-sans">{m.content}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {m.feedback === 'none' ? (
                        <>
                          <button
                            onClick={() => handleUpdateMemoryFeedback(m._id, 'accepted')}
                            className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white rounded-lg border border-emerald-500/10 transition-all cursor-pointer text-[10px] font-bold"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleUpdateMemoryFeedback(m._id, 'rejected')}
                            className="p-1.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white rounded-lg border border-red-500/10 transition-all cursor-pointer text-[10px] font-bold"
                          >
                            Reject
                          </button>
                        </>
                      ) : m.feedback === 'accepted' ? (
                        <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> Approved
                        </span>
                      ) : (
                        <span className="text-[10px] text-red-400 font-semibold flex items-center gap-1">
                          <Trash2 className="w-3.5 h-3.5" /> Discarded
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      ) : (
        /* Background agent daemon audit logs */
        <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden flex flex-col h-[500px]">
          <div className="px-5 py-4 border-b border-white/5 bg-neutral-950/40 flex items-center justify-between">
            <h3 className="text-xs font-bold text-neutral-300 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-400" />
              Daemon System Audits
            </h3>
            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/15 px-2.5 py-0.5 rounded-full font-bold animate-pulse">
              System Online
            </span>
          </div>

          <div className="flex-1 p-5 overflow-y-auto font-mono text-[11px] leading-relaxed bg-black/40 text-neutral-300 space-y-2">
            {logs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-neutral-500 italic">
                No daemon logs populated.
              </div>
            ) : (
              logs.map((logEntry, idx) => (
                <div key={idx} className="flex items-start gap-3 border-b border-white/5 pb-1.5 last:border-0">
                  <span className="text-neutral-600 select-none">
                    {new Date(logEntry.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tight border ${getLogTypeBadge(logEntry.type)}`}>
                    {logEntry.type}
                  </span>
                  <span className="flex-1 font-sans text-xs">{logEntry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
