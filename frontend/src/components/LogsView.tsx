import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Clock, Search, Plus, Calendar, Trash2, BookOpen } from 'lucide-react';

interface Log {
  _id: string;
  title: string;
  duration: number;
  notes: string;
  timestamp: string;
  taskId?: {
    _id: string;
    resolution?: string;
    description?: string;
    category?: string;
  } | string;
}

export const LogsView: React.FC = () => {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  // Manual Log Form State
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let url = '/logs';
      const params = [];
      if (selectedDate) params.push(`date=${selectedDate}`);
      if (params.length > 0) url += `?${params.join('&')}`;

      const response = await api.get(url);
      setLogs(response.data);
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [selectedDate]);

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || duration <= 0) return;

    try {
      await api.post('/logs', {
        title,
        duration,
        notes
      });
      setTitle('');
      setDuration(30);
      setNotes('');
      setShowAddForm(false);
      fetchLogs();
    } catch (err) {
      console.error('Failed to create manual log:', err);
    }
  };

  const handleDeleteLog = async (id: string) => {
    try {
      await api.delete(`/logs/${id}`);
      fetchLogs();
    } catch (err) {
      console.error('Failed to delete log:', err);
    }
  };

  // Local filter for search text
  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          log.notes.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-neutral-100 tracking-tight">Work History Logs</h1>
          <p className="text-sm text-neutral-400">Append-only audit trail of what you accomplished.</p>
        </div>
        <button
          id="toggle-add-log-btn"
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 py-2 px-4 rounded-none bg-[#FF6B6B] dark:bg-[#ff007f] hover:opacity-90 font-extrabold text-sm text-black dark:text-white border-2 border-black dark:border-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {showAddForm ? 'Close Form' : 'Log General Work'}
        </button>
      </div>

      {/* Manual Log Add Form */}
      {showAddForm && (
        <form onSubmit={handleAddLog} className="glass-panel rounded-xl p-6 shadow-xl space-y-4 max-w-xl">
          <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400">Record General Activity</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">What did you do?</label>
              <input
                id="log-title-input"
                type="text"
                required
                className="w-full px-3 py-2 rounded-lg text-sm text-neutral-100 glass-input"
                placeholder="e.g. Sync meeting, Admin work, Email triage"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Duration (mins)</label>
              <input
                id="log-duration-input"
                type="number"
                required
                min="1"
                className="w-full px-3 py-2 rounded-lg text-sm text-neutral-100 glass-input"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Notes (optional)</label>
            <textarea
              id="log-notes-input"
              className="w-full px-3 py-2 rounded-lg text-sm text-neutral-100 glass-input h-20 resize-none"
              placeholder="Record details of what was covered..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 font-semibold text-xs rounded-lg cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              id="save-log-btn"
              type="submit"
              className="px-4 py-2 bg-[#FF6B6B] dark:bg-[#ff007f] text-white font-extrabold text-xs rounded-none border-2 border-black cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
            >
              Record Log
            </button>
          </div>
        </form>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-center bg-neutral-900/40 p-4 rounded-xl border border-white/5">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-neutral-500" />
          <input
            id="log-search-input"
            type="text"
            className="w-full pl-9 pr-4 py-2 rounded-lg text-sm text-neutral-100 placeholder-neutral-500 glass-input"
            placeholder="Search log descriptions or notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <Calendar className="w-4 h-4 text-neutral-500 hidden md:block" />
          <input
            id="log-date-filter"
            type="date"
            className="w-full md:w-auto px-3 py-2 rounded-lg text-sm text-neutral-200 glass-input cursor-pointer"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          {selectedDate && (
            <button
              onClick={() => setSelectedDate('')}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Log list timeline */}
      <div className="glass-panel rounded-xl p-6 shadow-xl">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-neutral-500 animate-pulse">Loading work logs...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 text-neutral-500 space-y-3">
            <BookOpen className="w-12 h-12 stroke-[1.25] text-neutral-600" />
            <div>
              <p className="text-base font-semibold">No work logs found</p>
              <p className="text-xs">Logs populate automatically when completing tasks or creating general entries.</p>
            </div>
          </div>
        ) : (
          <div className="relative border-l border-white/5 pl-6 ml-3 space-y-6">
            {filteredLogs.map((log) => (
              <div key={log._id} className="relative group">
                {/* Timeline node */}
                <div className="absolute -left-[35px] top-1 w-4 h-4 bg-[#FFD93D] dark:bg-[#39ff14] border-2 border-black dark:border-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"></div>
                
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="text-[10px] text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-white/5 font-semibold">
                      {new Date(log.timestamp).toLocaleDateString(undefined, { 
                        weekday: 'short', 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    <h4 className="text-sm font-bold text-neutral-200 mt-1.5">{log.title}</h4>
                    {log.notes && (
                      <p className="text-xs text-neutral-400 mt-1 bg-neutral-900/50 p-2.5 rounded border border-white/5 max-w-2xl whitespace-pre-wrap leading-relaxed">
                        {log.notes}
                      </p>
                    )}
                    {log.taskId && typeof log.taskId === 'object' && log.taskId.resolution && (
                      <div className="mt-2 p-2.5 rounded-lg bg-emerald-950/10 border border-emerald-500/10 max-w-2xl space-y-1">
                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-400 uppercase tracking-wider">
                          <span>🔧 Task Resolution Details</span>
                        </div>
                        <p className="text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed font-sans">
                          {log.taskId.resolution}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-400 bg-neutral-900 px-2 py-1 rounded border border-white/5 flex items-center gap-1 font-semibold whitespace-nowrap">
                      <Clock className="w-3.5 h-3.5" /> {log.duration} mins
                    </span>
                    <button
                      onClick={() => handleDeleteLog(log._id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-800 cursor-pointer transition-all"
                      title="Delete log entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
