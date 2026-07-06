import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Sparkles, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface Task {
  _id: string;
  title: string;
  estimatedTime?: number;
}

interface ScheduleItem {
  taskId: string;
  title: string;
  suggestedTime: string;
  rationale?: string;
}

interface SmartScheduleData {
  rationale: string;
  schedule: ScheduleItem[];
  orderedTaskIds: string[];
}

interface SmartSchedulePanelProps {
  tasks: Task[];
  onApplySchedule: (orderedIds: string[]) => void;
}

export const SmartSchedulePanel: React.FC<SmartSchedulePanelProps> = ({ tasks: _tasks, onApplySchedule }) => {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scheduleData, setScheduleData] = useState<SmartScheduleData | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (expanded && !fetched) {
      fetchSchedule();
    }
  }, [expanded]);

  const fetchSchedule = async () => {
    setLoading(true);
    setFetched(true);
    try {
      const res = await api.get('/ai/smart-schedule');
      setScheduleData(res.data);
    } catch (err: any) {
      console.error('Failed to fetch smart schedule:', err);
      alert('Failed to load AI schedule: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!scheduleData) return;
    const ids = scheduleData.orderedTaskIds || scheduleData.schedule.map(s => s.taskId);
    onApplySchedule(ids);
  };

  return (
    <div className="glass-panel rounded-xl border border-indigo-500/10 overflow-hidden">
      {/* Toggle Button */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-indigo-500/5 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
          <span className="text-sm font-semibold text-indigo-300">
            ✨ AI Schedule Suggestion
          </span>
          <span className="text-[10px] text-indigo-400/60 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/10 font-bold">
            AI Powered
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-indigo-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-neutral-500" />
        )}
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-white/5 space-y-4 pt-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-neutral-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Generating optimal schedule...</span>
            </div>
          ) : scheduleData ? (
            <>
              {/* Rationale */}
              {scheduleData.rationale && (
                <blockquote className="border-l-2 border-indigo-500/40 pl-4 py-1">
                  <p className="text-xs text-indigo-300/80 leading-relaxed italic">{scheduleData.rationale}</p>
                </blockquote>
              )}

              {/* Schedule List */}
              {scheduleData.schedule && scheduleData.schedule.length > 0 && (
                <div className="space-y-2">
                  {scheduleData.schedule.map((item, idx) => (
                    <div
                      key={item.taskId || idx}
                      className="flex items-center gap-3 p-3 bg-neutral-900/40 rounded-lg border border-white/5"
                    >
                      <span className="w-6 h-6 rounded-full bg-indigo-600/20 border border-indigo-500/20 text-indigo-400 text-[10px] font-black flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-neutral-200 truncate">{item.title}</p>
                        {item.suggestedTime && (
                          <p className="text-[10px] text-indigo-400 font-bold mt-0.5">{item.suggestedTime}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Apply Button */}
              <button
                onClick={handleApply}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                <Sparkles className="w-4 h-4" />
                Apply This Schedule
              </button>
            </>
          ) : (
            <div className="text-center py-6 text-neutral-500 text-sm">
              Could not load schedule. Please try again.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
