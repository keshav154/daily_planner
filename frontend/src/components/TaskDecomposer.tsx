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
    high: { label: 'High', classes: 'bg-[#FF6B6B] text-black border-2 border-black font-extrabold uppercase' },
    medium: { label: 'Medium', classes: 'bg-[#FFD93D] text-black border-2 border-black font-extrabold uppercase' },
    low: { label: 'Low', classes: 'bg-[#C4B5FD] text-black border-2 border-black font-extrabold uppercase' },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Input Panel */}
      <div className="glass-panel p-6 shadow-xl space-y-5">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <div className="w-8 h-8 rounded-none bg-[#C4B5FD] text-black flex items-center justify-center border-2 border-black dark:border-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
            <Layers className="w-4 h-4" />
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
            className="w-full px-4 py-3 rounded-none text-sm glass-input text-neutral-100 resize-none placeholder-neutral-600 leading-relaxed"
          />
        </div>

        <button
          onClick={handleDecompose}
          disabled={loading || !goal.trim()}
          className="w-full py-3 px-4 bg-[#FFD93D] dark:bg-[#39ff14] text-black font-black text-sm rounded-none cursor-pointer border-2 border-black dark:border-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 flex items-center justify-center gap-2"
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
      <div className="glass-panel p-6 shadow-xl flex flex-col min-h-[400px]">
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
                    className="glass-panel p-4 space-y-3"
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
                      <span className="text-[10px] text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded-none border-2 border-black font-bold">
                        {task.estimatedTime}m
                      </span>
                      {task.category && (
                        <span className="text-[10px] text-neutral-400 bg-neo-muted/20 px-2 py-0.5 rounded-none border-2 border-black font-bold">
                          {task.category}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => handleAddToToday(task)}
                      className="w-full py-1.5 px-3 bg-[#FF6B6B] dark:bg-[#ff007f] text-white font-extrabold text-[11px] rounded-none border-2 border-black cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100 flex items-center justify-center gap-1.5"
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
                className="w-full py-3 px-4 bg-[#FF6B6B] dark:bg-[#ff007f] text-white font-black text-sm rounded-none border-2 border-black dark:border-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,1)] cursor-pointer active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100 flex items-center justify-center gap-2 disabled:opacity-50"
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
