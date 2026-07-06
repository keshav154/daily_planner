import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { BarChart2, TrendingUp, Clock, CheckCircle2, Zap } from 'lucide-react';

interface CategoryStat {
  name: string;
  percentage: number;
  count: number;
}

interface HabitStat {
  name: string;
  completionRate: number;
}

interface WeeklyReviewData {
  completionRate: number;
  totalFocusHours: number;
  tasksCompleted: number;
  currentLevel: number | string;
  summary: string;
  categories: CategoryStat[];
  habitStats: HabitStat[];
  highlights: string[];
  improvement: string;
}

export const WeeklyReviewView: React.FC = () => {
  const [data, setData] = useState<WeeklyReviewData | null>(null);
  const [loading, setLoading] = useState(true);

  // Compute "This Week" date range label
  const getWeekRange = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(startOfWeek)} – ${fmt(endOfWeek)}, ${now.getFullYear()}`;
  };

  useEffect(() => {
    const fetchReview = async () => {
      try {
        const res = await api.get('/ai/weekly-review');
        setData(res.data);
      } catch (err: any) {
        console.error('Failed to fetch weekly review:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchReview();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-40 bg-neutral-800 rounded animate-pulse" />
            <div className="h-3 w-28 bg-neutral-900 rounded animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-panel rounded-xl p-5 animate-pulse h-24" />
          ))}
        </div>
        <div className="glass-panel rounded-2xl p-6 animate-pulse h-32" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-panel rounded-2xl p-6 animate-pulse h-48" />
          <div className="glass-panel rounded-2xl p-6 animate-pulse h-48" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-neutral-500 space-y-3">
        <BarChart2 className="w-10 h-10 text-neutral-700" />
        <p className="text-sm font-semibold">Could not load weekly review</p>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Completion Rate',
      value: `${data.completionRate ?? 0}%`,
      color: 'text-emerald-400',
      borderColor: 'border-l-emerald-500/30',
      icon: CheckCircle2,
    },
    {
      label: 'Focus Hours',
      value: `${data.totalFocusHours ?? 0}h`,
      color: 'text-indigo-400',
      borderColor: 'border-l-indigo-500/30',
      icon: Clock,
    },
    {
      label: 'Tasks Done',
      value: String(data.tasksCompleted ?? 0),
      color: 'text-violet-400',
      borderColor: 'border-l-violet-500/30',
      icon: TrendingUp,
    },
    {
      label: 'Current Level',
      value: String(data.currentLevel ?? 'N/A'),
      color: 'text-amber-400',
      borderColor: 'border-l-amber-500/30',
      icon: Zap,
    },
  ];

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 flex items-center justify-center border border-indigo-500/20">
            <BarChart2 className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-neutral-100 tracking-tight">Weekly Review</h1>
            <p className="text-xs text-neutral-500 font-semibold">Your productivity insights</p>
          </div>
        </div>
        <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-full self-start sm:self-auto">
          {getWeekRange()}
        </span>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={`glass-panel rounded-xl p-5 border-l-2 ${card.borderColor} space-y-2`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${card.color}`} />
                <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                  {card.label}
                </p>
              </div>
              <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
            </div>
          );
        })}
      </div>

      {/* AI Summary */}
      {data.summary && (
        <div className="glass-panel rounded-2xl p-6 border-l-4 border-indigo-500/60 shadow-xl">
          <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-3">AI Summary</p>
          <blockquote className="text-sm text-neutral-300 leading-relaxed font-medium italic">
            "{data.summary}"
          </blockquote>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Categories */}
        {data.categories && data.categories.length > 0 && (
          <div className="glass-panel rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider border-b border-white/5 pb-3">
              Top Categories
            </h3>
            <div className="space-y-3">
              {data.categories.map((cat) => (
                <div key={cat.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-300">{cat.name}</span>
                    <span className="text-neutral-500 font-mono">{cat.percentage}%</span>
                  </div>
                  <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Habit Stats */}
        {data.habitStats && data.habitStats.length > 0 && (
          <div className="glass-panel rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider border-b border-white/5 pb-3">
              Habit Performance (7-day)
            </h3>
            <div className="space-y-2">
              {data.habitStats.map((h) => {
                const rate = h.completionRate ?? 0;
                const badgeClass =
                  rate >= 80
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : rate >= 50
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20';
                return (
                  <div
                    key={h.name}
                    className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
                  >
                    <span className="text-sm text-neutral-300 font-medium">{h.name}</span>
                    <span
                      className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${badgeClass}`}
                    >
                      {rate}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Highlights */}
        {data.highlights && data.highlights.length > 0 && (
          <div className="glass-panel rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider border-b border-white/5 pb-3">
              ✨ Highlights
            </h3>
            <ul className="space-y-2.5">
              {data.highlights.map((hl, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-neutral-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                  {hl}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Improvement Callout */}
        {data.improvement && (
          <div className="glass-panel rounded-2xl p-6 shadow-xl border border-amber-500/20 bg-amber-950/10 space-y-3">
            <div className="flex items-center gap-2 border-b border-amber-500/10 pb-3">
              <span className="text-lg">💡</span>
              <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">
                This Week's Focus
              </h3>
            </div>
            <p className="text-sm text-amber-200/80 leading-relaxed">{data.improvement}</p>
          </div>
        )}
      </div>
    </div>
  );
};
