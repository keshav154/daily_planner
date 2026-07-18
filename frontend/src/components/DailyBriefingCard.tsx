import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Sparkles, X, Zap, Target, Clock3 } from 'lucide-react';

interface BriefingDigest {
  agentActions: string[];
  pendingSuggestionsCount: number;
  newInsightsCount: number;
}

interface FocusPlan {
  commitments: Array<{ taskId: string; title: string; estimatedMinutes: number; reason: string }>;
  plannedMinutes: number;
  focusBudgetMinutes: number;
  focusWindow: string;
  calendarReservedMinutes: number;
  calendarEventsCount: number;
  attention: string;
}
// Strips trailing "(id: 507f1f...)" from action text — useful in the raw
// activity log, but a MongoDB ObjectId doesn't belong in a friendly morning
// greeting.
const stripTechnicalId = (text: string): string => text.replace(/\s*\(id:\s*[a-f0-9]+\)\s*$/i, '');

export const DailyBriefingCard: React.FC = () => {
  const [briefing, setBriefing] = useState('');
  const [digest, setDigest] = useState<BriefingDigest | null>(null);
  const [focusPlan, setFocusPlan] = useState<FocusPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const isDismissed = localStorage.getItem('kortex-briefing-dismissed-date') === todayStr;

    if (isDismissed) {
      setDismissed(true);
      setLoading(false);
      return;
    }

    const fetchBriefing = async () => {
      try {
        const res = await api.get('/briefing/daily');
        setBriefing(res.data.briefing || '');
        setDigest(res.data.digest || null);
        setFocusPlan(res.data.focusPlan || null);
      } catch (err) {
        console.error('Failed to fetch daily briefing:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchBriefing();
  }, []);

  const handleDismiss = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    localStorage.setItem('kortex-briefing-dismissed-date', todayStr);
    setDismissed(true);
  };

  if (dismissed || (!loading && !briefing)) return null;

  return (
    <div className="glass-panel p-5 relative overflow-hidden transition-all duration-200">
      {/* Sparkles glow in background */}
      <div className="absolute -top-12 -right-12 w-28 h-28 bg-[#C4B5FD]/10 rounded-full blur-2xl pointer-events-none"></div>

      <div className="flex gap-4">
        {/* Animated icon */}
        <div className="w-9 h-9 rounded-none bg-[#C4B5FD] text-black flex items-center justify-center border-2 border-black dark:border-white shrink-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
          <Sparkles className="w-4 h-4 animate-pulse" />
        </div>

        <div className="flex-1 space-y-1.5 min-w-0 pr-6">
          <h2 className="text-xs font-black text-black dark:text-neutral-200 uppercase tracking-wider">Morning Executive Briefing</h2>
          {loading ? (
            <div className="space-y-2 pt-1">
              <div className="h-3.5 bg-[#C4B5FD]/20 dark:bg-neutral-900 rounded-none animate-pulse w-full"></div>
              <div className="h-3.5 bg-[#C4B5FD]/20 dark:bg-neutral-900 rounded-none animate-pulse w-5/6"></div>
              <div className="h-3.5 bg-[#C4B5FD]/20 dark:bg-neutral-900 rounded-none animate-pulse w-3/4"></div>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-black dark:text-neutral-300 leading-relaxed font-sans font-bold">{briefing}</p>

              {focusPlan && (
                <section className="mt-3 border-2 border-black dark:border-white bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-black dark:text-amber-200"><Target className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Today&apos;s commitments</p>
                    <span className="flex items-center gap-1 text-[9px] font-black text-amber-700 dark:text-amber-300"><Clock3 className="w-3 h-3" /> {focusPlan.plannedMinutes}/{focusPlan.focusBudgetMinutes} min</span>
                  </div>
                  {focusPlan.commitments.length > 0 ? (
                    <ol className="space-y-1.5">
                      {focusPlan.commitments.map((task, index) => (
                        <li key={task.taskId} className="flex items-start gap-2 text-[10px] font-bold text-black dark:text-neutral-200">
                          <span className="shrink-0 w-4 h-4 flex items-center justify-center bg-amber-300 dark:bg-amber-500 text-black text-[9px]">{index + 1}</span>
                          <span>{task.title} <span className="text-neutral-600 dark:text-neutral-400 font-semibold">— {task.reason}</span></span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="text-[10px] font-bold text-neutral-700 dark:text-neutral-300">No commitments yet.</p>}
                  <p className="text-[9px] font-semibold text-neutral-600 dark:text-neutral-400">
                    Protect {focusPlan.focusWindow}.
                    {focusPlan.calendarEventsCount > 0 && ` ${focusPlan.calendarReservedMinutes} min reserved for ${focusPlan.calendarEventsCount} calendar commitment${focusPlan.calendarEventsCount === 1 ? '' : 's'}.`}
                    {' '}{focusPlan.attention}
                  </p>
                </section>
              )}

              {digest && (digest.agentActions.length > 0 || digest.pendingSuggestionsCount > 0 || digest.newInsightsCount > 0) && (
                <div className="pt-2 space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    While you were away
                  </p>
                  {digest.agentActions.map((action, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[10px] font-bold text-black dark:text-neutral-300">
                      <Zap className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
                      <span>{stripTechnicalId(action)}</span>
                    </div>
                  ))}
                  {(digest.pendingSuggestionsCount > 0 || digest.newInsightsCount > 0) && (
                    <p className="text-[10px] font-bold text-neutral-600 dark:text-neutral-400">
                      {digest.pendingSuggestionsCount > 0 && `${digest.pendingSuggestionsCount} suggestion${digest.pendingSuggestionsCount > 1 ? 's' : ''} awaiting your review`}
                      {digest.pendingSuggestionsCount > 0 && digest.newInsightsCount > 0 && ' · '}
                      {digest.newInsightsCount > 0 && `${digest.newInsightsCount} new insight${digest.newInsightsCount > 1 ? 's' : ''} in Agent Memory`}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-black dark:text-neutral-300 hover:opacity-85 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
