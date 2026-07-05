import React from 'react';
import { Flame, Trophy, Calendar } from 'lucide-react';

interface Log {
  _id: string;
  duration: number;
  timestamp: string;
}

interface HeatmapChartProps {
  logs: Log[];
}

export const HeatmapChart: React.FC<HeatmapChartProps> = ({ logs }) => {
  // --- 1. Compute Focus Duration Map (YYYY-MM-DD -> total minutes) ---
  const dailyFocusMap: Record<string, number> = {};
  logs.forEach(log => {
    try {
      const dateStr = new Date(log.timestamp).toISOString().split('T')[0];
      dailyFocusMap[dateStr] = (dailyFocusMap[dateStr] || 0) + log.duration;
    } catch (e) {
      // Ignore invalid date strings
    }
  });

  // --- 2. Generate past 365 days list ---
  const generatePastYearDates = (): Date[] => {
    const dates: Date[] = [];
    const today = new Date();
    // Start from 364 days ago (aligned to start of week if we want, but let's do simple 365 days)
    for (let i = 364; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      dates.push(d);
    }
    return dates;
  };

  const dates = generatePastYearDates();

  // --- 3. Compute Streaks ---
  const computeStreaks = () => {
    const todayStr = new Date().toISOString().split('T')[0];

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    // We scan chronologically from 365 days ago to today to find the longest streak
    // And scan backward from today to find the current streak
    const chronologicalDates = [...dates].sort((a, b) => a.getTime() - b.getTime());

    // 1. Longest streak loop
    chronologicalDates.forEach(d => {
      const dateStr = d.toISOString().split('T')[0];
      const minutes = dailyFocusMap[dateStr] || 0;

      if (minutes > 0) {
        tempStreak++;
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
        }
      } else {
        tempStreak = 0;
      }
    });

    // 2. Current streak loop (scan backward from today/yesterday)
    let checkDate = new Date();
    // If user hasn't logged anything today yet, start checking from yesterday
    const todayMinutes = dailyFocusMap[todayStr] || 0;
    if (todayMinutes === 0) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
      const dateStr = checkDate.toISOString().split('T')[0];
      const minutes = dailyFocusMap[dateStr] || 0;

      if (minutes > 0) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break; // streak broken
      }

      // Safeguard escape
      if (currentStreak > 366) break;
    }

    return { currentStreak, longestStreak };
  };

  const { currentStreak, longestStreak } = computeStreaks();

  // --- 4. Group dates by week for grid rendering (7 rows, N columns) ---
  const getGridColorClass = (minutes: number): string => {
    if (minutes === 0) return 'bg-neutral-900 border border-white/[0.02] hover:bg-neutral-800';
    if (minutes < 30) return 'bg-indigo-950 text-white/50 hover:bg-indigo-900 border border-indigo-500/5';
    if (minutes < 60) return 'bg-indigo-900 hover:bg-indigo-800 border border-indigo-500/10';
    if (minutes < 120) return 'bg-indigo-700 hover:bg-indigo-600 border border-indigo-500/20';
    return 'bg-indigo-500 hover:bg-indigo-400 border border-indigo-400/30';
  };

  // Group dates into columns of weeks
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];

  // Align dates grid so columns are complete
  dates.forEach((date) => {
    currentWeek.push(date);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      {/* Streaks Cards (1 col) */}
      <div className="md:col-span-1 space-y-4">
        <div className="glass-panel rounded-xl p-5 shadow-lg flex items-center gap-4 border border-orange-500/10 bg-orange-950/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-orange-500/5 rounded-full blur-xl pointer-events-none"></div>
          <div className="w-12 h-12 rounded-lg bg-orange-500/10 text-orange-400 flex items-center justify-center border border-orange-500/20 shrink-0">
            <Flame className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Current Streak</p>
            <p className="text-2xl font-black text-neutral-100 mt-0.5">{currentStreak} Days</p>
            <p className="text-[9px] text-neutral-500 mt-0.5">Consecutive focus days</p>
          </div>
        </div>

        <div className="glass-panel rounded-xl p-5 shadow-lg flex items-center gap-4 border border-amber-500/10 bg-amber-950/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/5 rounded-full blur-xl pointer-events-none"></div>
          <div className="w-12 h-12 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20 shrink-0">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Longest Streak</p>
            <p className="text-2xl font-black text-neutral-100 mt-0.5">{longestStreak} Days</p>
            <p className="text-[9px] text-neutral-500 mt-0.5">All-time record streak</p>
          </div>
        </div>
      </div>

      {/* Heatmap Grid (3 cols) */}
      <div className="md:col-span-3 glass-panel rounded-xl p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <Calendar className="w-4.5 h-4.5 text-indigo-400" />
          <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">Focus Consistency Heatmap</h3>
        </div>

        {/* Heatmap calendar grid layout */}
        <div className="overflow-x-auto select-none">
          <div className="flex gap-1.5 min-w-[500px] py-2">
            {/* Days labels */}
            <div className="flex flex-col justify-between text-[9px] text-neutral-500 font-semibold pr-2 select-none h-[88px] pt-1">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>

            {/* Weeks columns */}
            <div className="flex gap-1">
              {weeks.map((week, wIdx) => (
                <div key={wIdx} className="flex flex-col gap-1">
                  {week.map((date) => {
                    const dateStr = date.toISOString().split('T')[0];
                    const minutes = dailyFocusMap[dateStr] || 0;
                    const tooltipText = `${date.toLocaleDateString(undefined, { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric' 
                    })}: ${minutes} mins logged`;

                    return (
                      <div
                        key={dateStr}
                        className={`w-2.5 h-2.5 rounded-xs transition-colors cursor-help ${getGridColorClass(minutes)}`}
                        title={tooltipText}
                      ></div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 text-[10px] text-neutral-500 font-semibold pt-1 border-t border-white/5 select-none">
          <span>Less</span>
          <div className="w-2.5 h-2.5 rounded-xs bg-neutral-900 border border-white/[0.02]"></div>
          <div className="w-2.5 h-2.5 rounded-xs bg-indigo-950 border border-indigo-500/5"></div>
          <div className="w-2.5 h-2.5 rounded-xs bg-indigo-900"></div>
          <div className="w-2.5 h-2.5 rounded-xs bg-indigo-700"></div>
          <div className="w-2.5 h-2.5 rounded-xs bg-indigo-500"></div>
          <span>More</span>
        </div>
      </div>
    </div>
  );
};
