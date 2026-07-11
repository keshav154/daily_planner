import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Check, X, ShieldCheck, TrendingUp, Timer, Plus, HelpCircle } from 'lucide-react';
import { getMemoryBadges } from '../utils/memoryLabels';

interface Memory {
  _id: string;
  type: string;
  category: string;
  content: string;
  feedback: 'none' | 'accepted' | 'rejected';
  source: 'reflection' | 'observation' | 'user' | 'autonomous' | 'consolidation';
  importance: number;
  expiresAt?: string;
  createdAt: string;
}

const timeUntil = (iso: string): string => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expiring now';
  const hours = Math.round(ms / (1000 * 60 * 60));
  return hours <= 1 ? 'expires within the hour' : `expires in ${hours}h`;
};

const MemoryCard: React.FC<{ memory: Memory; onFeedback: (id: string, feedback: 'accepted' | 'rejected') => void }> = ({ memory: m, onFeedback }) => (
  <div
    className={`p-5 rounded-xl border flex flex-col justify-between gap-4 transition-all duration-200 ${
      m.feedback === 'accepted' ? 'bg-indigo-950/10 border-indigo-500/20' :
      m.feedback === 'rejected' ? 'bg-red-950/5 border-red-500/10 opacity-50' :
      'bg-neutral-900/60 border-white/5 shadow-md hover:border-white/10'
    }`}
  >
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="flex items-center gap-1 flex-wrap">
          {getMemoryBadges(m.type, m.category).map((label, idx) => (
            <span
              key={idx}
              className="text-[9px] font-semibold text-neutral-400 bg-neutral-950 px-2 py-0.5 rounded border border-white/5 uppercase tracking-wider"
            >
              {label}
            </span>
          ))}
        </span>
        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded shrink-0 ${
          m.feedback === 'accepted' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
          m.feedback === 'rejected' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
          'bg-amber-500/10 text-amber-400 border border-amber-500/20'
        }`}>
          {m.feedback === 'none' ? 'Pending Review' : m.feedback}
        </span>
      </div>
      <p className="text-sm text-neutral-200 leading-relaxed font-medium">{m.content}</p>
      {m.expiresAt && (
        <p className="text-[10px] text-amber-400/80 font-semibold mt-1.5">{timeUntil(m.expiresAt)}</p>
      )}
    </div>

    {m.feedback === 'none' ? (
      <div className="flex items-center gap-2 pt-3 border-t border-white/5">
        <button
          onClick={() => onFeedback(m._id, 'accepted')}
          className="flex items-center gap-1 py-1 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-semibold rounded cursor-pointer transition-colors"
        >
          <Check className="w-3.5 h-3.5" /> Approve Insight
        </button>
        <button
          onClick={() => onFeedback(m._id, 'rejected')}
          className="flex items-center gap-1 py-1 px-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-xs font-semibold rounded cursor-pointer transition-colors"
        >
          <X className="w-3.5 h-3.5" /> Reject
        </button>
      </div>
    ) : (
      <div className="flex items-center justify-between pt-2 text-[10px] text-neutral-500">
        <span>Learned: {new Date(m.createdAt).toLocaleDateString()}</span>
        {m.feedback === 'accepted' ? (
          <button
            onClick={() => onFeedback(m._id, 'rejected')}
            className="text-red-400/70 hover:text-red-400 cursor-pointer"
          >
            Revoke Approval
          </button>
        ) : (
          <button
            onClick={() => onFeedback(m._id, 'accepted')}
            className="text-indigo-400/75 hover:text-indigo-400 cursor-pointer"
          >
            Approve
          </button>
        )}
      </div>
    )}
  </div>
);

interface MemorySectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  memories: Memory[];
  emptyHint: string;
  onFeedback: (id: string, feedback: 'accepted' | 'rejected') => void;
}

const MemorySection: React.FC<MemorySectionProps> = ({ title, description, icon, memories, emptyHint, onFeedback }) => (
  <div className="space-y-3">
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20 shrink-0">
        {icon}
      </div>
      <div>
        <h2 className="text-sm font-bold text-neutral-200 flex items-center gap-2">
          {title}
          <span className="text-[10px] font-semibold text-neutral-500 bg-neutral-900 px-1.5 py-0.5 rounded-full border border-white/5">
            {memories.length}
          </span>
        </h2>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
    </div>

    {memories.length === 0 ? (
      <p className="text-xs text-neutral-600 italic pl-11">{emptyHint}</p>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {memories.map((m) => <MemoryCard key={m._id} memory={m} onFeedback={onFeedback} />)}
      </div>
    )}
  </div>
);

export const AgentMemoryView: React.FC = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  // Custom preference adder state
  const [customContent, setCustomContent] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);
  const [submittingCustom, setSubmittingCustom] = useState(false);

  const fetchMemories = async () => {
    setLoading(true);
    try {
      const response = await api.get('/agent/memories');
      setMemories(response.data);
    } catch (err) {
      console.error('Failed to load memory insights:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
  }, []);

  const handleFeedback = async (id: string, feedback: 'accepted' | 'rejected') => {
    try {
      await api.put(`/agent/memories/${id}`, { feedback });
      // Update locally
      setMemories(prev =>
        prev.map(m => m._id === id ? { ...m, feedback } : m)
      );
    } catch (err) {
      console.error('Failed to update memory feedback:', err);
    }
  };

  const handleAddCustomMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customContent.trim()) return;

    setSubmittingCustom(true);
    try {
      await api.post('/agent/memories', {
        content: customContent,
        type: 'preference',
        category: 'scheduling'
      });

      setCustomContent('');
      setAddingCustom(false);
      fetchMemories();
    } catch (err) {
      console.error('Failed to add custom memory:', err);
    } finally {
      setSubmittingCustom(false);
    }
  };

  // Three tiers, matching how the backend already treats these differently:
  // - Standing Rules: source 'user' — always injected into every agent context, never expire
  // - Active Nudges: anything with an expiresAt — transient, time-boxed warnings
  // - Learned Patterns: everything else — durable insights derived from your history
  const byImportance = (a: Memory, b: Memory) =>
    (b.importance || 0) - (a.importance || 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  const standingRules = memories.filter(m => m.source === 'user').sort(byImportance);
  const activeNudges = memories.filter(m => m.source !== 'user' && !!m.expiresAt).sort(byImportance);
  const learnedPatterns = memories.filter(m => m.source !== 'user' && !m.expiresAt).sort(byImportance);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-neutral-100 tracking-tight">Agent Memory & Insights</h1>
          <p className="text-sm text-neutral-400">View what the AI agent has learned about your habits, and refine its memory.</p>
        </div>
        <button
          id="toggle-custom-pref-btn"
          onClick={() => setAddingCustom(!addingCustom)}
          className="flex items-center gap-2 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white shadow-lg cursor-pointer transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Custom Preference
        </button>
      </div>

      {/* Manual Preference Adder */}
      {addingCustom && (
        <form onSubmit={handleAddCustomMemory} className="glass-panel rounded-xl p-6 shadow-xl space-y-4 max-w-xl">
          <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400">Add Preference Nudge</h3>
          <p className="text-xs text-neutral-400">
            Tell the agent how you like to work. It will use this insight during future planning loops.
          </p>
          <div>
            <textarea
              id="custom-pref-input"
              required
              className="w-full px-3 py-2 rounded-lg text-sm text-neutral-100 glass-input h-20 resize-none"
              placeholder="e.g. I have low energy on Friday afternoons, don't schedule deep work then."
              value={customContent}
              onChange={(e) => setCustomContent(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setAddingCustom(false)}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 font-semibold text-xs rounded-lg cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              id="submit-pref-btn"
              type="submit"
              disabled={submittingCustom}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-lg cursor-pointer transition-colors"
            >
              {submittingCustom ? 'Saving...' : 'Add Preference'}
            </button>
          </div>
        </form>
      )}

      {/* Transparency Explanation */}
      <div className="glass-panel rounded-xl p-5 shadow-lg border border-indigo-500/10 bg-indigo-950/5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20 shrink-0">
          <HelpCircle className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-neutral-200">How Agent Memory Works</h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            <strong>Standing Rules</strong> are things you told the agent directly — always applied, never expire.
            {' '}<strong>Learned Patterns</strong> are insights the agent derived from your task history during reflections — you have final control, approved ones are applied in planning and rejected ones are discarded for good.
            {' '}<strong>Active Nudges</strong> are time-sensitive alerts that expire on their own within a day.
          </p>
        </div>
      </div>

      {/* Memory sections */}
      <div className="glass-panel rounded-xl p-6 shadow-xl space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-neutral-500 animate-pulse">Retrieving memory insights...</span>
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 text-neutral-500 space-y-2">
            <HelpCircle className="w-10 h-10 stroke-[1.25] text-neutral-600" />
            <p className="text-sm font-semibold">No memory insights learned yet</p>
            <p className="text-xs max-w-[280px]">Complete some tasks and run reflections to populate the memory store.</p>
          </div>
        ) : (
          <>
            <MemorySection
              title="Your Standing Rules"
              description="Facts and preferences you've told the agent — always applied, never expire."
              icon={<ShieldCheck className="w-4 h-4" />}
              memories={standingRules}
              emptyHint="None yet — add one above, or tell the assistant in chat (“remember that...”)."
              onFeedback={handleFeedback}
            />
            <MemorySection
              title="Learned Patterns"
              description="Insights the agent derived from your task history. Review and approve to apply them in planning."
              icon={<TrendingUp className="w-4 h-4" />}
              memories={learnedPatterns}
              emptyHint="None yet — run a reflection or let the nightly cycle analyze more of your task history."
              onFeedback={handleFeedback}
            />
            <MemorySection
              title="Active Nudges"
              description="Time-sensitive alerts, like a habit streak at risk tonight. These clear themselves automatically."
              icon={<Timer className="w-4 h-4" />}
              memories={activeNudges}
              emptyHint="Nothing needs your attention right now."
              onFeedback={handleFeedback}
            />
          </>
        )}
      </div>
    </div>
  );
};
