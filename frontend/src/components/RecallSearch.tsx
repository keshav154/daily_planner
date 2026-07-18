import React, { useState } from 'react';
import api from '../services/api';
import { Search, Loader2, BookOpen, CheckSquare, Sparkles } from 'lucide-react';

interface RecallResult {
  kind: 'log' | 'task' | 'memory';
  title: string;
  detail: string;
  date: string;
  score: number;
  linkedTaskId?: string;
  memoryId?: string;
}

const KIND_META: Record<RecallResult['kind'], { label: string; icon: React.ElementType; color: string }> = {
  log: { label: 'Did', icon: BookOpen, color: 'text-emerald-400 border-emerald-500/40' },
  task: { label: 'Task', icon: CheckSquare, color: 'text-sky-400 border-sky-500/40' },
  memory: { label: 'Note', icon: Sparkles, color: 'text-violet-400 border-violet-500/40' },
};

export const RecallSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RecallResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await api.get('/recall', { params: { query: query.trim(), limit: 12 } });
      setResults(res.data.results || []);
    } catch (err) {
      console.error('Recall search failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black uppercase tracking-wide text-black dark:text-neutral-100 flex items-center gap-2">
          <Search className="w-5 h-5" /> Recall
        </h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 font-semibold">
          Search your own history — "what did I do about the ECM deployment on cusdemo?"
        </p>
      </div>

      <form onSubmit={runSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask what you did, worked on, or figured out…"
          className="flex-1 px-4 py-3 rounded-none bg-white dark:bg-neutral-900 border-2 border-black dark:border-white text-sm text-black dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:focus:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs uppercase border-2 border-black dark:border-white rounded-none cursor-pointer disabled:opacity-40 flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Recall
        </button>
      </form>

      {searched && !loading && results.length === 0 && (
        <div className="text-center py-16 text-neutral-500 text-sm font-semibold">
          Nothing found for that yet. Try different words — or it may be work you haven't logged.
        </div>
      )}

      <div className="space-y-3">
        {results.map((r, idx) => {
          const meta = KIND_META[r.kind];
          const Icon = meta.icon;
          // Clicking a memory result is an explicit "this was useful" signal —
          // it tells the second brain to rank this higher next time (self-curation).
          const onCardClick = r.memoryId
            ? () => { api.post(`/agent/memories/${r.memoryId}/touch`).catch(() => {}); }
            : undefined;
          return (
            <div
              key={idx}
              onClick={onCardClick}
              className={`glass-panel p-4 border-l-4 border-l-indigo-500 ${onCardClick ? 'cursor-pointer hover:border-l-indigo-400' : ''}`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider border px-1.5 py-0.5 ${meta.color}`}>
                  <Icon className="w-3 h-3" /> {meta.label}
                </div>
                <span className="text-[10px] text-neutral-500 font-bold">{new Date(r.date).toISOString().slice(0, 10)}</span>
              </div>
              <p className="text-sm font-bold text-black dark:text-neutral-100">{r.title}</p>
              {r.detail && (
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 leading-relaxed whitespace-pre-wrap">{r.detail}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
