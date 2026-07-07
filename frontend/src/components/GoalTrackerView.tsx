import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { 
  Target, Sparkles, Plus, Trash2, Calendar, CheckSquare, Loader2, ChevronRight, Activity 
} from 'lucide-react';

interface Milestone {
  title: string;
  completed: boolean;
  completedAt?: string;
}

interface Goal {
  _id: string;
  title: string;
  description: string;
  deadline?: string;
  milestones: Milestone[];
  linkedTaskIds: string[];
  progress: number;
  status: 'active' | 'completed' | 'paused';
  agentNotes: string[];
  createdAt: string;
}

export const GoalTrackerView: React.FC = () => {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [autoDecompose, setAutoDecompose] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  
  // Manual milestone inputs during creation
  const [manualMilestones, setManualMilestones] = useState<string[]>([]);
  const [newMilestoneText, setNewMilestoneText] = useState('');

  const fetchGoals = async () => {
    try {
      const res = await api.get('/goals');
      setGoals(res.data || []);
    } catch (err) {
      console.error('Failed to fetch goals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGoals();
  }, []);

  const handleAddManualMilestone = () => {
    if (!newMilestoneText.trim()) return;
    setManualMilestones(prev => [...prev, newMilestoneText.trim()]);
    setNewMilestoneText('');
  };

  const handleRemoveManualMilestone = (idx: number) => {
    setManualMilestones(prev => prev.filter((_, i) => i !== idx));
  };

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || creating) return;

    setCreating(true);
    try {
      const milestoneObjects = manualMilestones.map(m => ({ title: m, completed: false }));
      const payload = {
        title: title.trim(),
        description: description.trim(),
        deadline: deadline || undefined,
        milestones: milestoneObjects,
        autoDecompose: autoDecompose && milestoneObjects.length === 0
      };

      const res = await api.post('/goals', payload);
      setGoals(prev => [res.data, ...prev]);
      
      // Reset form
      setTitle('');
      setDescription('');
      setDeadline('');
      setManualMilestones([]);
      setNewMilestoneText('');
    } catch (err: any) {
      console.error(err);
      alert('Failed to create goal: ' + (err.response?.data?.error || err.message));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleMilestone = async (goalId: string, milestoneIndex: number) => {
    try {
      const res = await api.post(`/goals/${goalId}/milestones/${milestoneIndex}/toggle`);
      setGoals(prev => prev.map(g => g._id === goalId ? res.data : g));
    } catch (err: any) {
      console.error(err);
      alert('Failed to toggle milestone: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    if (!window.confirm('Are you sure you want to delete this goal?')) return;

    try {
      await api.delete(`/goals/${goalId}`);
      setGoals(prev => prev.filter(g => g._id !== goalId));
    } catch (err: any) {
      console.error(err);
      alert('Failed to delete goal: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600/20 flex items-center justify-center border border-indigo-500/20">
          <Target className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-neutral-100 tracking-tight">Goals & Milestones</h1>
          <p className="text-xs text-neutral-500">Formulate and track major goals and let the autonomous co-pilot watch progress</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Left Column: Create Form */}
        <div className="glass-panel p-5 rounded-2xl border border-white/5 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Initialize Goal</h3>
          </div>

          <form onSubmit={handleCreateGoal} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase text-neutral-400 mb-1.5">Goal Title</label>
              <input 
                type="text" 
                required
                placeholder="e.g. Launch new SaaS MVP"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-3 rounded-xl text-xs text-neutral-100 placeholder-neutral-500 glass-input"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-neutral-400 mb-1.5">Description</label>
              <textarea 
                placeholder="Details or specific scope bounds..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-3 rounded-xl text-xs text-neutral-100 placeholder-neutral-500 glass-input min-h-[80px]"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-neutral-400 mb-1.5">Target Deadline</label>
              <input 
                type="date" 
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full p-3 rounded-xl text-xs text-neutral-100 glass-input cursor-pointer"
              />
            </div>

            {/* Manual Milestones builder */}
            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase text-neutral-400">Add Milestones (Optional)</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="Milestone title..."
                  value={newMilestoneText}
                  onChange={(e) => setNewMilestoneText(e.target.value)}
                  className="flex-1 p-2.5 rounded-lg text-xs text-neutral-100 placeholder-neutral-500 glass-input"
                />
                <button
                  type="button"
                  onClick={handleAddManualMilestone}
                  className="px-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Add
                </button>
              </div>

              {manualMilestones.length > 0 && (
                <div className="p-2.5 bg-neutral-950/40 rounded-xl border border-white/5 space-y-1.5">
                  {manualMilestones.map((m, idx) => (
                    <div key={idx} className="flex justify-between items-center text-[11px] text-neutral-300">
                      <span className="truncate">• {m}</span>
                      <button 
                        type="button" 
                        onClick={() => handleRemoveManualMilestone(idx)}
                        className="text-red-400 hover:text-red-300 cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Decomposition Checkbox */}
            {manualMilestones.length === 0 && (
              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox" 
                  id="autoDecompose" 
                  checked={autoDecompose}
                  onChange={(e) => setAutoDecompose(e.target.checked)}
                  className="rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500 bg-neutral-800"
                />
                <label htmlFor="autoDecompose" className="text-[10px] text-neutral-400 font-bold uppercase cursor-pointer select-none">
                  Auto-generate Milestones with AI ✨
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-40 shadow-lg shadow-indigo-600/25"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save Goal Core
            </button>
          </form>
        </div>

        {/* Right Columns: Goals list */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            </div>
          ) : goals.length === 0 ? (
            <div className="glass-panel p-10 rounded-2xl border border-white/5 text-center text-neutral-500 text-xs space-y-2">
              <Target className="w-8 h-8 mx-auto text-neutral-700 stroke-[1.5]" />
              <p>No active goals initialized yet. Setup your first goal on the left!</p>
            </div>
          ) : (
            goals.map((goal) => (
              <div key={goal._id} className="glass-panel p-5 rounded-2xl border border-white/5 space-y-4">
                
                {/* Goal title row */}
                <div className="flex justify-between items-start gap-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-neutral-200">{goal.title}</h3>
                    {goal.description && (
                      <p className="text-xs text-neutral-400 font-sans leading-relaxed">{goal.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDeleteGoal(goal._id)}
                      className="p-2 text-neutral-500 hover:text-red-400 bg-neutral-950/40 hover:bg-red-500/10 rounded-lg border border-white/5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px] font-bold text-neutral-400">
                    <span className="uppercase">Goal Completion progress</span>
                    <span className="text-indigo-400 font-extrabold">{goal.progress}%</span>
                  </div>
                  <div className="h-2 w-full bg-neutral-900 rounded-full overflow-hidden border border-white/5">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500" 
                      style={{ width: `${goal.progress}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/5">
                  
                  {/* Milestones list */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-400 mb-1">
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>Milestone Checklist</span>
                    </div>

                    <div className="space-y-2">
                      {goal.milestones.map((m, idx) => (
                        <div 
                          key={idx}
                          onClick={() => handleToggleMilestone(goal._id, idx)}
                          className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                            m.completed 
                              ? 'bg-emerald-950/10 border-emerald-500/20 text-emerald-400' 
                              : 'bg-neutral-950/30 border-white/5 hover:border-white/10 text-neutral-400'
                          }`}
                        >
                          <input 
                            type="checkbox"
                            checked={m.completed}
                            onChange={() => {}} // handled by parent click wrapper
                            className="rounded border-neutral-700 text-emerald-600 focus:ring-emerald-500 bg-neutral-800"
                          />
                          <span className={`text-[11px] font-medium leading-tight truncate ${m.completed ? 'line-through text-emerald-500/60' : 'text-neutral-300'}`}>
                            {m.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Watchdog Agent notes / feed */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-neutral-400 mb-1">
                      <Activity className="w-3.5 h-3.5" />
                      <span>Agent Watchdog timeline</span>
                    </div>

                    <div className="p-3 bg-neutral-950/40 rounded-xl border border-white/5 max-h-[160px] overflow-y-auto space-y-2.5">
                      {(!goal.agentNotes || goal.agentNotes.length === 0) ? (
                        <p className="text-[10px] text-neutral-500 italic">No notes generated yet.</p>
                      ) : (
                        goal.agentNotes.map((note, idx) => (
                          <div key={idx} className="flex gap-2 items-start text-[10px] leading-relaxed text-neutral-400">
                            <ChevronRight className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
                            <span>{note}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>

                {/* Deadline indicator */}
                {goal.deadline && (
                  <div className="flex items-center gap-1.5 pt-2 text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Target Target: {new Date(goal.deadline).toLocaleDateString()}</span>
                  </div>
                )}

              </div>
            ))
          )}
        </div>

      </div>

    </div>
  );
};
