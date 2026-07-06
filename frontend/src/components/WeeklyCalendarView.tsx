import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { 
  ChevronLeft, ChevronRight, Calendar, Plus, Link2, Loader2, Sparkles, Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TimeBlockTask {
  _id: string;
  title: string;
  status: 'todo' | 'in-progress' | 'done' | 'skipped';
  priority: 'high' | 'medium' | 'low';
  category: string;
  timeBlock?: { startTime: string; endTime: string };
}

interface RecurringInstance {
  _id: string;
  title: string;
  type: 'meeting' | 'standup' | 'task' | 'break' | 'block';
  startTime: string;
  endTime: string;
  color: string;
  location?: string;
  meetingLink?: string;
}

interface DayData {
  date: Date;
  dateStr: string;
  tasks: TimeBlockTask[];
  recurring: RecurringInstance[];
}

const formatDateLocal = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const WeeklyCalendarView: React.FC = () => {
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => {
    const today = new Date();
    // Align to current week's Monday
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  });

  const [daysData, setDaysData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  // Quick Task form states
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskStart, setTaskStart] = useState('09:00');
  const [taskEnd, setTaskEnd] = useState('09:30');
  const [taskCategory, setTaskCategory] = useState('Work');
  const [taskPriority, setTaskPriority] = useState<'high' | 'medium' | 'low'>('medium');

  const daysLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  useEffect(() => {
    fetchWeekData();
  }, [currentWeekStart]);

  const fetchWeekData = async () => {
    setLoading(true);
    const days: DayData[] = [];
    const promises = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + i);
      const dateStr = formatDateLocal(d);

      days.push({
        date: d,
        dateStr,
        tasks: [],
        recurring: []
      });

      // Gather tasks and recurring instances for this day
      const taskPromise = api.get(`/tasks?date=${dateStr}`);
      const recurringPromise = api.get(`/recurring/instances?date=${dateStr}`);

      promises.push(
        Promise.all([taskPromise, recurringPromise]).then(([tasksRes, recurringRes]) => {
          days[i].tasks = tasksRes.data;
          days[i].recurring = recurringRes.data;
        })
      );
    }

    try {
      await Promise.all(promises);
      setDaysData(days);
    } catch (err) {
      console.error('Failed to load weekly calendar data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrevWeek = () => {
    setCurrentWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const handleNextWeek = () => {
    setCurrentWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const handleToday = () => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    setCurrentWeekStart(monday);
  };

  const handleOpenQuickAdd = (dateStr: string, hour: string = '09:00') => {
    setSelectedDateStr(dateStr);
    setTaskStart(hour);
    // Auto end 30 mins later
    const [h, m] = hour.split(':').map(Number);
    const endH = m === 30 ? h + 1 : h;
    const endM = m === 30 ? 0 : 30;
    setTaskEnd(`${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`);
    setQuickAddOpen(true);
  };

  const handleCreateQuickTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle) return;

    try {
      const due = new Date(`${selectedDateStr}T12:00:00.000Z`);
      await api.post('/tasks', {
        title: taskTitle,
        dueDate: due,
        category: taskCategory,
        priority: taskPriority,
        timeBlock: {
          startTime: taskStart,
          endTime: taskEnd
        }
      });
      fetchWeekData();
      setTaskTitle('');
      setQuickAddOpen(false);
    } catch (err) {
      console.error('Failed to create quick task:', err);
    }
  };

  const formatDateRangeLabel = () => {
    if (daysData.length === 0) return '';
    const start = daysData[0].date;
    const end = daysData[6].date;

    const opt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const startLabel = start.toLocaleDateString(undefined, opt);
    const endLabel = end.toLocaleDateString(undefined, { ...opt, year: 'numeric' });
    
    return `${startLabel} — ${endLabel}`;
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  };

  return (
    <div className="p-6 select-none max-w-7xl mx-auto space-y-6">
      {/* Calendar Header Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-5.5 h-5.5 text-indigo-400" />
          <h2 className="text-base font-bold text-neutral-100 uppercase tracking-wider">Weekly Schedule</h2>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-neutral-300 mr-2 font-mono">
            {formatDateRangeLabel()}
          </span>

          <div className="flex bg-neutral-950 p-1 rounded-lg border border-white/5">
            <button
              onClick={handlePrevWeek}
              className="p-1.5 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleToday}
              className="px-3 py-1 text-[10px] font-bold rounded text-neutral-400 hover:text-neutral-200 cursor-pointer transition-colors"
            >
              Today
            </button>
            <button
              onClick={handleNextWeek}
              className="p-1.5 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-96 flex flex-col items-center justify-center text-neutral-500 text-sm gap-2">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <span>Synchronizing weekly timeline...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-4 min-h-[600px]">
          {daysData.map((day, idx) => {
            const isCurr = isToday(day.date);
            
            // Merge timeblocks and recurring items chronologically
            const mergedTimeline = [
              ...day.recurring.map(r => ({ ...r, isEvent: true })),
              ...day.tasks.filter(t => t.timeBlock).map(t => ({
                _id: t._id,
                title: t.title,
                startTime: t.timeBlock!.startTime,
                endTime: t.timeBlock!.endTime,
                status: t.status,
                priority: t.priority,
                color: '#6366f1',
                isEvent: false
              }))
            ].sort((a, b) => a.startTime.localeCompare(b.startTime));

            return (
              <div 
                key={day.dateStr}
                className={`glass-panel rounded-2xl p-4 flex flex-col h-full border hover:border-white/10 transition-all ${
                  isCurr ? 'border-indigo-500/30 bg-indigo-950/5 relative shadow-lg shadow-indigo-500/[0.02]' : 'border-white/5'
                }`}
              >
                {/* Visual indicator for today */}
                {isCurr && (
                  <div className="absolute top-0 inset-x-0 h-1 bg-indigo-500 rounded-t-2xl"></div>
                )}

                {/* Day title */}
                <div className="text-center border-b border-white/5 pb-2.5 mb-3.5 select-none">
                  <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wide">{daysLabels[idx]}</p>
                  <p className={`text-base font-extrabold font-sans mt-0.5 ${
                    isCurr ? 'text-indigo-400' : 'text-neutral-200'
                  }`}>
                    {day.date.getDate()}
                  </p>
                </div>

                {/* Items timeline column */}
                <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[480px] pr-0.5">
                  {mergedTimeline.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-neutral-600 text-[10px] text-center py-12">
                      <Sparkles className="w-5 h-5 mb-1.5 text-neutral-700" />
                      <p>Open Schedule</p>
                      <button
                        onClick={() => handleOpenQuickAdd(day.dateStr)}
                        className="mt-2 text-[9px] text-indigo-400 font-bold hover:underline cursor-pointer"
                      >
                        + Add Task
                      </button>
                    </div>
                  ) : (
                    mergedTimeline.map((item: any) => (
                      <div
                        key={item._id}
                        className={`p-2.5 rounded-xl border border-white/5 relative overflow-hidden transition-all text-left ${
                          item.isEvent 
                            ? 'bg-neutral-900/40 hover:bg-neutral-900/60' 
                            : item.status === 'done' 
                              ? 'bg-emerald-950/5 border-emerald-500/10 opacity-70' 
                              : 'bg-indigo-950/5 border-indigo-500/10 hover:bg-indigo-950/10'
                        }`}
                      >
                        {/* Event / Task type color indicator */}
                        <div 
                          className="absolute top-0 bottom-0 left-0 w-1"
                          style={{ backgroundColor: item.color }}
                        ></div>

                        <div className="pl-1.5">
                          <div className="flex items-start justify-between gap-1">
                            <h4 className={`text-[11px] font-bold tracking-tight truncate leading-snug ${
                              !item.isEvent && item.status === 'done' 
                                ? 'line-through text-neutral-500' 
                                : 'text-neutral-200'
                            }`}>
                              {item.title}
                            </h4>
                            {!item.isEvent && item.status === 'done' && (
                              <Check className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                            )}
                          </div>
                          
                          <div className="flex items-center gap-1.5 mt-1 text-[8px] text-neutral-500 font-bold font-mono">
                            <span>{item.startTime}-{item.endTime}</span>
                            {item.isEvent ? (
                              <span className="bg-neutral-950 px-1 rounded text-neutral-400 capitalize">Meeting</span>
                            ) : (
                              <span className={`px-1 rounded uppercase ${
                                item.priority === 'high' ? 'bg-red-950/30 text-red-400' : 'bg-neutral-950 text-neutral-400'
                              }`}>
                                {item.priority}
                              </span>
                            )}
                          </div>

                          {item.isEvent && (item as any).meetingLink && (
                            <a
                              href={(item as any).meetingLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-[8px] text-indigo-400 font-bold hover:underline mt-1"
                            >
                              <Link2 className="w-2.5 h-2.5 shrink-0" /> Join Link
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Add task button */}
                <button
                  onClick={() => handleOpenQuickAdd(day.dateStr)}
                  className="w-full mt-3 py-1.5 rounded-lg text-[9px] font-bold text-neutral-500 hover:text-indigo-400 hover:bg-indigo-600/5 border border-dashed border-white/5 hover:border-indigo-500/10 cursor-pointer flex items-center justify-center gap-1 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add Block
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Add Modal */}
      <AnimatePresence>
        {quickAddOpen && (
          <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md glass-panel rounded-2xl p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <h3 className="text-xs font-bold text-neutral-100 uppercase tracking-wider">Quick Add Time Block</h3>
                <button 
                  onClick={() => setQuickAddOpen(false)}
                  className="text-neutral-500 hover:text-neutral-300 p-1 cursor-pointer hover:bg-neutral-800 rounded-lg"
                >
                  <ChevronLeft className="w-4 h-4" /> {/* Simple back icon */}
                </button>
              </div>

              <form onSubmit={handleCreateQuickTask} className="space-y-4">
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Task Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Write standup report"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Start Time</label>
                    <input
                      type="time"
                      required
                      value={taskStart}
                      onChange={(e) => setTaskStart(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">End Time</label>
                    <input
                      type="time"
                      required
                      value={taskEnd}
                      onChange={(e) => setTaskEnd(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-100 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Category</label>
                    <input
                      type="text"
                      value={taskCategory}
                      onChange={(e) => setTaskCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Priority</label>
                    <select
                      value={taskPriority}
                      onChange={(e) => setTaskPriority(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-300"
                    >
                      <option value="high">High 🔴</option>
                      <option value="medium">Medium 🟡</option>
                      <option value="low">Low 🟢</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl cursor-pointer shadow-lg shadow-indigo-600/10 transition-colors"
                >
                  Create Scheduled Task
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
