import React, { useState } from 'react';
import api from '../services/api';
import { Clock, Calendar, X, Plus } from 'lucide-react';

interface Task {
  _id: string;
  title: string;
  status: string;
  priority: string;
  estimatedTime: number;
  timeBlock?: {
    startTime: string; // e.g. "09:30"
    endTime: string;   // e.g. "11:00"
  };
}

interface TimeBlockingGridProps {
  tasks: Task[];
  onTaskUpdated: () => void;
}

export const TimeBlockingGrid: React.FC<TimeBlockingGridProps> = ({ tasks, onTaskUpdated }) => {
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [duration, setDuration] = useState(60);
  const [showScheduleForm, setShowScheduleForm] = useState(false);

  const hours = Array.from({ length: 15 }, (_, i) => 8 + i); // 8 AM to 10 PM

  // Filter tasks to schedule (todo/in-progress and has no timeBlock yet)
  const unscheduledTasks = tasks.filter(t => !t.timeBlock?.startTime && t.status !== 'done');
  const scheduledTasks = tasks.filter(t => t.timeBlock?.startTime);

  // Convert "HH:MM" string to minutes from midnight
  const timeToMinutes = (timeStr: string): number => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  const minutesToTime = (totalMin: number): string => {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaskId) return;

    const startMin = timeToMinutes(startTime);
    const endMin = startMin + Number(duration);
    const endTime = minutesToTime(endMin);

    try {
      await api.put(`/tasks/${selectedTaskId}`, {
        timeBlock: { startTime, endTime }
      });
      setSelectedTaskId('');
      setShowScheduleForm(false);
      onTaskUpdated();
    } catch (err) {
      console.error('Failed to schedule task:', err);
    }
  };

  const handleUnschedule = async (taskId: string) => {
    try {
      await api.put(`/tasks/${taskId}`, {
        timeBlock: undefined
      });
      onTaskUpdated();
    } catch (err) {
      console.error('Failed to unschedule task:', err);
    }
  };

  // Find tasks scheduled during a specific hour slot (e.g. 09:00 - 10:00)
  const getTasksForHour = (hour: number) => {
    const slotStart = hour * 60;
    const slotEnd = (hour + 1) * 60;

    return scheduledTasks.filter(task => {
      const taskStart = timeToMinutes(task.timeBlock!.startTime);
      const taskEnd = timeToMinutes(task.timeBlock!.endTime);
      
      // Overlap checks
      return (taskStart >= slotStart && taskStart < slotEnd) || 
             (taskStart < slotStart && taskEnd > slotStart);
    });
  };

  return (
    <div className="glass-panel rounded-xl p-6 shadow-xl space-y-6">
      <div className="flex items-center justify-between border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-bold text-neutral-100">Daily Calendar Blocks</h2>
        </div>
        <button
          onClick={() => setShowScheduleForm(!showScheduleForm)}
          className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-xs text-white shadow-md cursor-pointer transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Schedule Time Block
        </button>
      </div>

      {/* Schedule Form Overlay */}
      {showScheduleForm && (
        <form onSubmit={handleScheduleSubmit} className="p-4 bg-neutral-900/60 border border-white/5 rounded-xl space-y-4 max-w-md">
          <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-400">Block Calendar Time</h3>
          
          <div>
            <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Select Task</label>
            {unscheduledTasks.length === 0 ? (
              <p className="text-xs text-neutral-500 italic">No unscheduled tasks remaining today.</p>
            ) : (
              <select
                required
                className="w-full px-3 py-2 rounded-lg text-xs text-neutral-200 glass-input cursor-pointer"
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
              >
                <option value="">-- Choose Task --</option>
                {unscheduledTasks.map(t => (
                  <option key={t._id} value={t._id}>
                    {t.title} ({t.estimatedTime}m)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Start Time</label>
              <input
                type="time"
                required
                className="w-full px-3 py-1.5 rounded-lg text-xs text-neutral-200 glass-input cursor-pointer"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Duration (mins)</label>
              <input
                type="number"
                required
                min="10"
                step="5"
                className="w-full px-3 py-1.5 rounded-lg text-xs text-neutral-100 glass-input"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowScheduleForm(false)}
              className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 font-semibold text-[10px] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedTaskId}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[10px] rounded transition-colors disabled:opacity-40"
            >
              Lock Slot
            </button>
          </div>
        </form>
      )}

      {/* Visual hour-blocking board */}
      <div className="relative border border-white/5 rounded-xl overflow-hidden max-h-[500px] overflow-y-auto">
        <div className="divide-y divide-white/5 bg-neutral-950/20">
          {hours.map((hour) => {
            const label = `${hour.toString().padStart(2, '0')}:00`;
            const hourTasks = getTasksForHour(hour);

            return (
              <div key={hour} className="flex min-h-[50px] group/row">
                {/* Time slot labels column */}
                <div className="w-16 flex items-center justify-center border-r border-white/5 bg-neutral-950 text-[10px] font-bold text-neutral-400 uppercase tracking-wider shrink-0 select-none">
                  {label}
                </div>
                
                {/* Calendar grid block row */}
                <div className="flex-1 p-1.5 flex flex-wrap gap-1.5 bg-neutral-900/10 hover:bg-white/[0.01] transition-colors relative min-h-[50px]">
                  {hourTasks.map((task) => {
                    const isTaskStartHour = timeToMinutes(task.timeBlock!.startTime) >= hour * 60 && 
                                            timeToMinutes(task.timeBlock!.startTime) < (hour + 1) * 60;
                    
                    return (
                      <div 
                        key={task._id}
                        className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border text-xs shadow-sm font-medium grow max-w-sm ${
                          task.status === 'done' 
                            ? 'bg-emerald-950/20 border-emerald-500/10 text-emerald-400' 
                            : task.priority === 'high'
                            ? 'bg-red-950/20 border-red-500/20 text-red-300'
                            : 'bg-indigo-950/20 border-indigo-500/20 text-indigo-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Clock className="w-3.5 h-3.5 opacity-60 shrink-0" />
                          <span className="truncate">{task.title}</span>
                          <span className="text-[9px] opacity-75 font-semibold shrink-0">
                            ({task.timeBlock!.startTime} - {task.timeBlock!.endTime})
                          </span>
                        </div>
                        {isTaskStartHour && (
                          <button
                            onClick={() => handleUnschedule(task._id)}
                            className="p-0.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 cursor-pointer transition-colors"
                            title="Unschedule block"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
