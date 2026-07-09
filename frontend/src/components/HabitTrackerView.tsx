import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { 
  Heart, Flame, Plus, Trash2, CheckCircle2, Circle
} from 'lucide-react';

interface Habit {
  _id: string;
  title: string;
  icon: string;
  frequency: 'daily' | 'weekdays' | 'custom';
  daysOfWeek?: number[];
  completions: Array<{ date: string; completed: boolean }>;
  currentStreak: number;
  longestStreak: number;
  isActive: boolean;
}

export const HabitTrackerView: React.FC = () => {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [coaching, setCoaching] = useState<any[]>([]);

  // Form states
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('⭐');
  const [frequency, setFrequency] = useState<'daily' | 'weekdays' | 'custom'>('daily');

  const todayStr = new Date().toISOString().split('T')[0];

  useEffect(() => {
    fetchHabits();
  }, []);

  const fetchHabits = async () => {
    try {
      const response = await api.get('/habits');
      setHabits(response.data);
    } catch (err) {
      console.error('Failed to fetch habits:', err);
    } finally {
      setLoading(false);
    }

    try {
      const coachingRes = await api.get('/ai/habit-coaching');
      setCoaching(coachingRes.data?.coaching || []);
    } catch (err) {
      console.error('Failed to fetch habit coaching:', err);
    }
  };

  const handleCreateHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;

    try {
      await api.post('/habits', {
        title,
        icon,
        frequency
      });
      fetchHabits();
      setTitle('');
      setIcon('⭐');
      setFrequency('daily');
    } catch (err) {
      console.error('Failed to create habit:', err);
    }
  };

  const handleToggleHabit = async (habitId: string) => {
    try {
      await api.post(`/habits/${habitId}/toggle`, { date: todayStr });
      fetchHabits();
    } catch (err) {
      console.error('Failed to toggle habit:', err);
    }
  };

  const handleDeleteHabit = async (habitId: string) => {
    if (!confirm('Are you sure you want to delete this habit?')) return;
    try {
      await api.delete(`/habits/${habitId}`);
      fetchHabits();
    } catch (err) {
      console.error('Failed to delete habit:', err);
    }
  };

  const isCompletedToday = (habit: Habit) => {
    return habit.completions.some(c => c.date === todayStr && c.completed);
  };

  // Get past 7 date strings (e.g. [..., today])
  const getPast7Days = () => {
    const list = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      list.push(d.toISOString().split('T')[0]);
    }
    return list;
  };

  const past7Days = getPast7Days();

  // Stats calculation
  const totalHabits = habits.length;
  const completedTodayCount = habits.filter(h => isCompletedToday(h)).length;
  const bestStreak = habits.reduce((acc, h) => Math.max(acc, h.longestStreak), 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto select-none">
      {/* Sidebar - Create Habit */}
      <div className="lg:col-span-1 space-y-5 h-fit">
        {/* Stats card */}
        <div className="grid grid-cols-3 gap-3">
          <div className="glass-panel p-4 rounded-xl text-center">
            <p className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider">Total</p>
            <p className="text-xl font-black text-neutral-100 mt-0.5">{totalHabits}</p>
          </div>
          <div className="glass-panel p-4 rounded-xl text-center border-l-2 border-l-emerald-500/30">
            <p className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider">Today</p>
            <p className="text-xl font-black text-emerald-400 mt-0.5">{completedTodayCount}</p>
          </div>
          <div className="glass-panel p-4 rounded-xl text-center border-l-2 border-l-amber-500/30">
            <p className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider">Best</p>
            <p className="text-xl font-black text-amber-400 mt-0.5 flex items-center justify-center gap-0.5">
              <span>{bestStreak}</span>
              <Flame className="w-3.5 h-3.5 fill-amber-500/20" />
            </p>
          </div>
        </div>

        {/* Input form */}
        <div className="glass-panel rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-white/5 pb-3">
            <Heart className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">Add Daily Habit</h2>
          </div>

          <form onSubmit={handleCreateHabit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Habit Title</label>
              <input 
                type="text"
                required
                placeholder="e.g. Read 10 pages, Hydrate"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-100"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Emoji Icon</label>
                <input 
                  type="text"
                  required
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm glass-input text-center"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Frequency</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-300"
                >
                  <option value="daily">Every Day</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl cursor-pointer transition-all duration-250 flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20"
            >
              <Plus className="w-4 h-4" />
              <span>Create Habit</span>
            </button>
          </form>
        </div>
      </div>

      {/* Main List */}
      <div className="lg:col-span-2 space-y-4">
        <div className="glass-panel rounded-2xl p-6 shadow-xl min-h-[500px]">
          <div className="border-b border-white/5 pb-4 mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">Your Habits checklist</h3>
            <span className="text-[10px] font-bold bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded-full border border-indigo-500/20">
              Streaks Engine Active
            </span>
          </div>

          {loading ? (
            <div className="h-48 flex items-center justify-center text-neutral-500 text-sm">
              Loading habits list...
            </div>
          ) : habits.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-neutral-500 text-sm space-y-2 border border-dashed border-white/5 rounded-xl p-6">
              <Heart className="w-8 h-8 text-neutral-600" />
              <p>No habits configured yet.</p>
              <p className="text-[10px] text-neutral-600">Start building positive streaks by adding your first habit.</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {habits.map((habit) => {
                const doneToday = isCompletedToday(habit);

                return (
                  <div 
                    key={habit._id}
                    className="glass-panel rounded-xl p-4 flex flex-col border border-white/5 hover:border-white/10 transition-all shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Completion check toggle */}
                        <button
                          onClick={() => handleToggleHabit(habit._id)}
                          className="text-neutral-400 hover:text-indigo-400 transition-colors cursor-pointer shrink-0"
                        >
                          {doneToday ? (
                            <CheckCircle2 className="w-6 h-6 text-indigo-500" />
                          ) : (
                            <Circle className="w-6 h-6" />
                          )}
                        </button>

                        {/* Icon emoji and text */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-lg shrink-0 select-none">{habit.icon}</span>
                            <h4 className={`text-sm font-bold truncate ${
                              doneToday ? 'line-through text-neutral-500' : 'text-neutral-200'
                            }`}>
                              {habit.title}
                            </h4>
                          </div>
                          <p className="text-[10px] text-neutral-500 font-semibold uppercase mt-0.5">{habit.frequency} Frequency</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0">
                        {/* Streaks progress timeline */}
                        <div className="flex flex-col items-end gap-1 select-none">
                          <div className="flex gap-1">
                            {past7Days.map((dateStr) => {
                              const completed = habit.completions.some(c => c.date === dateStr && c.completed);
                              const label = new Date(dateStr).toLocaleDateString(undefined, { weekday: 'short' })[0];
                              return (
                                <div
                                  key={dateStr}
                                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-black border ${
                                    completed 
                                      ? 'bg-indigo-600/80 border-indigo-500 text-white' 
                                      : 'bg-neutral-900 border-white/5 text-neutral-500'
                                  }`}
                                  title={`${dateStr}: ${completed ? 'Done' : 'Missed'}`}
                                >
                                  {label}
                                </div>
                              );
                            })}
                          </div>
                          <span className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">Past 7 Days</span>
                        </div>

                        {/* Flame Streaks */}
                        <div className="flex items-center gap-1.5 border-l border-white/5 pl-4 shrink-0">
                          <div className="text-center">
                            <div className="flex items-center gap-0.5 justify-center">
                              <Flame className={`w-4.5 h-4.5 ${
                                habit.currentStreak > 0 ? 'text-orange-400 fill-orange-500/10' : 'text-neutral-600'
                              }`} />
                              <span className="text-sm font-black text-neutral-200">{habit.currentStreak}</span>
                            </div>
                            <span className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">Streak</span>
                          </div>
                          
                          <button
                            onClick={() => handleDeleteHabit(habit._id)}
                            className="text-neutral-600 hover:text-red-400 p-1.5 rounded-lg cursor-pointer hover:bg-neutral-800 transition-colors ml-2"
                            title="Delete habit"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Habit Coaching */}
                    {(() => {
                      const coachEntry = coaching.find((c: any) => c.habitId === habit._id);
                      if (!coachEntry) return null;
                      return (
                        <div className="mt-3 px-3 py-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/15">
                          {coachEntry.message && (
                            <p className="text-[11px] text-indigo-300 font-medium leading-relaxed">{coachEntry.message}</p>
                          )}
                          {coachEntry.tip && (
                            <p className="text-[10px] text-indigo-400/70 mt-1 font-semibold">💡 {coachEntry.tip}</p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
