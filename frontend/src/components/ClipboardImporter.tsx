import React, { useState } from 'react';
import api from '../services/api';
import { 
  ClipboardCopy, Sparkles, Loader2, Calendar, AlertCircle, CheckCircle2
} from 'lucide-react';

interface ExtractedTask {
  title: string;
  description?: string;
  priority: 'high' | 'medium' | 'low';
  estimatedTime: number;
  category: string;
  subtasks?: string[];
}

export const ClipboardImporter: React.FC = () => {
  const [pastedText, setPastedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<ExtractedTask[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [importing, setImporting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleExtract = async () => {
    if (!pastedText.trim() || loading) return;

    setLoading(true);
    setTasks([]);
    setSelectedIndices([]);
    setSuccessMessage('');

    try {
      const res = await api.post('/ai/parse-clipboard', { text: pastedText.trim() });
      const extracted: ExtractedTask[] = res.data.tasks || [];
      setTasks(extracted);
      // Auto-select all by default
      setSelectedIndices(extracted.map((_, idx) => idx));
    } catch (err: any) {
      console.error(err);
      alert('Failed to parse clipboard: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSelect = (index: number) => {
    setSelectedIndices(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index) 
        : [...prev, index]
    );
  };

  const handleSelectAll = () => {
    if (selectedIndices.length === tasks.length) {
      setSelectedIndices([]);
    } else {
      setSelectedIndices(tasks.map((_, idx) => idx));
    }
  };

  const handleImportSelected = async () => {
    if (selectedIndices.length === 0 || importing) return;

    setImporting(true);
    let successCount = 0;

    try {
      const todayStr = new Date().toISOString().split('T')[0];
      
      // Fetch current task count to determine order
      const tasksRes = await api.get(`/tasks?date=${todayStr}`);
      const currentTasks = tasksRes.data || [];
      let baseOrder = currentTasks.length;

      for (const index of selectedIndices) {
        const t = tasks[index];
        await api.post('/tasks', {
          title: t.title,
          description: t.description || 'Imported from clipboard.',
          priority: t.priority || 'medium',
          estimatedTime: t.estimatedTime || 60,
          category: t.category || 'Work',
          dueDate: todayStr,
          source: 'manual',
          order: baseOrder++,
          subtasks: t.subtasks?.map(st => ({ title: st, completed: false })) || []
        });
        successCount++;
      }

      setSuccessMessage(`Successfully imported ${successCount} tasks to Today's Planner!`);
      // Clear checklist
      setTasks([]);
      setSelectedIndices([]);
      setPastedText('');
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err: any) {
      console.error(err);
      alert('Failed to import tasks: ' + (err.response?.data?.error || err.message));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      
      {/* Left panel: Paste Area */}
      <div className="glass-panel p-5 rounded-2xl border border-white/5 flex flex-col space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
            <ClipboardCopy className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-neutral-200">Clipboard Input Deck</h3>
            <p className="text-[10px] text-neutral-400">Copy text from Jira, Outlook, or Slack, then paste here.</p>
          </div>
        </div>

        <textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder="Paste raw tickets, email threads, slack chat snippets, calendar descriptions..."
          className="flex-1 w-full min-h-[300px] p-4 rounded-xl text-xs glass-input resize-none"
        />

        <button
          onClick={handleExtract}
          disabled={loading || !pastedText.trim()}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          Extract Structured Tasks ✨
        </button>
      </div>

      {/* Right panel: Extracted Checklist */}
      <div className="glass-panel p-5 rounded-2xl border border-white/5 flex flex-col h-[470px]">
        <div className="flex items-center justify-between pb-3 border-b border-white/5">
          <h3 className="text-xs font-bold text-neutral-200">Parsed Work Checklist</h3>
          {tasks.length > 0 && (
            <button
              onClick={handleSelectAll}
              className="text-[10px] text-indigo-400 font-semibold hover:underline cursor-pointer"
            >
              {selectedIndices.length === tasks.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {successMessage && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {successMessage}
            </div>
          )}

          {tasks.length === 0 && !successMessage && (
            <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 text-xs space-y-2">
              <AlertCircle className="w-8 h-8 text-neutral-700 stroke-[1.5]" />
              <p>No tasks extracted yet. Paste text on the left to begin.</p>
            </div>
          )}

          {tasks.map((t, idx) => {
            const isChecked = selectedIndices.includes(idx);
            return (
              <div
                key={idx}
                onClick={() => handleToggleSelect(idx)}
                className={`p-3.5 rounded-xl border transition-all text-xs flex items-start gap-3 cursor-pointer ${
                  isChecked 
                    ? 'bg-indigo-950/15 border-indigo-500/30 text-indigo-300' 
                    : 'bg-neutral-900/60 border-white/5 hover:border-white/10 text-neutral-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {}} // handled by click wrapper
                  className="mt-0.5 rounded border-neutral-700 text-indigo-600 focus:ring-indigo-500 bg-neutral-800"
                />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-neutral-200 truncate">{t.title}</span>
                    <span className="text-[9px] bg-neutral-800 border border-white/5 px-1.5 py-0.5 rounded text-neutral-400 uppercase font-semibold">
                      {t.category}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-semibold ${
                      t.priority === 'high' ? 'bg-red-500/10 text-red-400 border border-red-500/10' :
                      t.priority === 'medium' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/10' :
                      'bg-blue-500/10 text-blue-400 border border-blue-500/10'
                    }`}>
                      {t.priority}
                    </span>
                    <span className="text-[9px] text-neutral-500 font-bold">{t.estimatedTime}m</span>
                  </div>
                  {t.description && (
                    <p className="text-[10px] text-neutral-400 leading-relaxed font-sans truncate">{t.description}</p>
                  )}
                  {t.subtasks && t.subtasks.length > 0 && (
                    <div className="pl-3.5 border-l border-neutral-800 space-y-1 text-[10px] text-neutral-500">
                      {t.subtasks.map((st, sIdx) => (
                        <div key={sIdx} className="truncate">• {st}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {tasks.length > 0 && (
          <button
            onClick={handleImportSelected}
            disabled={selectedIndices.length === 0 || importing}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-lg shadow-indigo-600/25"
          >
            {importing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Calendar className="w-4 h-4" />
            )}
            Import {selectedIndices.length} Selected Tasks to Today
          </button>
        )}
      </div>

    </div>
  );
};
