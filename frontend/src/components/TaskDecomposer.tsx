import React, { useState } from 'react';
import api from '../services/api';
import { Sparkles, Loader2, Trash2, Plus, Layers } from 'lucide-react';

interface DecomposedTask {
  title: string;
  priority: 'high' | 'medium' | 'low';
  estimatedTime: number;
  category: string;
}

export const TaskDecomposer: React.FC = () => {
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<DecomposedTask[]>([]);
  const [toast, setToast] = useState('');
  const [addingAll, setAddingAll] = useState(false);

  const todayStr = new Date().toISOString().split('T')[0];

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  };

  const handleDecompose = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    try {
      const res = await api.post('/ai/decompose-task', { goal });
      setTasks(res.data.tasks || res.data || []);
    } catch (err: any) {
      alert('Failed to decompose task: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleAddToToday = async (task: DecomposedTask) => {
    try {
      await api.post('/tasks', {
        title: task.title,
        priority: task.priority,
        estimatedTime: task.estimatedTime,
        category: task.category,
        dueDate: new Date(todayStr).toISOString(),
        status: 'todo',
      });
      showToast(`"${task.title}" added to today!`);
    } catch (err: any) {
      alert('Failed to add task: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRemove = (idx: number) => {
    setTasks(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAddAll = async () => {
    if (tasks.length === 0) return;
    setAddingAll(true);
    try {
      await Promise.all(
        tasks.map(task =>
          api.post('/tasks', {
            title: task.title,
            priority: task.priority,
            estimatedTime: task.estimatedTime,
            category: task.category,
            dueDate: new Date(todayStr).toISOString(),
            status: 'todo',
          })
        )
      );
      showToast(`All ${tasks.length} tasks added to today!`);
    } catch (err: any) {
      alert('Failed to add all tasks: ' + (err.response?.data?.error || err.message));
    } finally {
      setAddingAll(false);
    }
  };

  const priorityConfig = {
    high: { label: 'High', classes: 'bg-red-500/10 text-red-400 border border-red-500/20' },
    medium: { label: 'Medium', classes: 'bg-amber-500/10 text-amber-400 border border-amber-500/20' },
    low: { label: 'Low', classes: 'bg-blue-500/10 text-blue-400 border border-blue-500/20' },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Input Panel */}
      <div className="glass-panel rounded-2xl p-6 shadow-xl space-y-5">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center border border-indigo-500/20">
            <Layers className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">Task Decomposer</h2>
            <p className="text-[10px] text-neutral-500 mt-0.5">Break any goal into actionable steps with AI</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            Goal or Project
          </label>
          <textarea
            rows={6}
            placeholder="Describe a goal or project, e.g. Prepare Q3 performance review"
            value={goal}
            onChange={e => setGoal(e.target.value)}
            className="w-full px-4 py-3 rounded-xl text-sm glass-input text-neutral-100 resize-none placeholder-neutral-600 leading-relaxed"
          />
        </div>

        <button
          onClick={handleDecompose}
          disabled={loading || !goal.trim()}
          className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm rounded-xl cursor-pointer transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Decomposing...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Decompose with AI ✨
            </>
          )}
        </button>

        {toast && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold px-4 py-2.5 rounded-lg text-center">
            ✓ {toast}
          </div>
        )}
      </div>

      {/* Right: Results Panel */}
      <div className="glass-panel rounded-2xl p-6 shadow-xl flex flex-col min-h-[400px]">
        <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
          <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">
            Decomposed Tasks
            {tasks.length > 0 && (
              <span className="ml-2 text-[10px] font-bold bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/20">
                {tasks.length} tasks
              </span>
            )}
          </h3>
        </div>

        {tasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-neutral-600 space-y-3 border border-dashed border-white/5 rounded-xl p-8">
            <Sparkles className="w-10 h-10 text-neutral-700" />
            <p className="text-sm font-semibold text-neutral-500">No tasks decomposed yet</p>
            <p className="text-[11px] text-neutral-600 text-center max-w-[200px]">
              Enter a goal on the left and click "Decompose with AI" to generate tasks.
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {tasks.map((task, idx) => {
                const pConf = priorityConfig[task.priority] || priorityConfig.medium;
                return (
                  <div
                    key={idx}
                    className="glass-panel rounded-xl p-4 border border-white/5 hover:border-white/10 transition-all space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-neutral-200 leading-snug flex-1">
                        {task.title}
                      </p>
                      <button
                        onClick={() => handleRemove(idx)}
                        className="text-neutral-600 hover:text-red-400 p-1 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
                        title="Remove from list"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pConf.classes}`}>
                        {pConf.label}
                      </span>
                      <span className="text-[10px] text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-white/5">
                        {task.estimatedTime}m
                      </span>
                      {task.category && (
                        <span className="text-[10px] text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-white/5">
                          {task.category}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => handleAddToToday(task)}
                      className="w-full py-1.5 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-semibold text-[11px] rounded-lg cursor-pointer border border-indigo-500/20 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add to Today
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-white/5 mt-4">
              <button
                onClick={handleAddAll}
                disabled={addingAll}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                {addingAll ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Add All to Today
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
