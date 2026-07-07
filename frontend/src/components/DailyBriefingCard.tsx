import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Sparkles, X } from 'lucide-react';

export const DailyBriefingCard: React.FC = () => {
  const [briefing, setBriefing] = useState('');
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
    <div className="glass-panel p-5 rounded-2xl border border-white/5 relative overflow-hidden shadow-xl shadow-indigo-950/10 transition-all duration-300">
      {/* Sparkles glow in background */}
      <div className="absolute -top-12 -right-12 w-28 h-28 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>

      <div className="flex gap-4">
        {/* Animated icon */}
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500/20 to-violet-500/20 flex items-center justify-center border border-indigo-500/20 shrink-0 text-indigo-400">
          <Sparkles className="w-4 h-4 animate-pulse" />
        </div>

        <div className="flex-1 space-y-1.5 min-w-0 pr-6">
          <h2 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Morning Executive Briefing</h2>
          {loading ? (
            <div className="space-y-2 pt-1">
              <div className="h-3.5 bg-neutral-900 rounded-lg animate-pulse w-full"></div>
              <div className="h-3.5 bg-neutral-900 rounded-lg animate-pulse w-5/6"></div>
              <div className="h-3.5 bg-neutral-900 rounded-lg animate-pulse w-3/4"></div>
            </div>
          ) : (
            <p className="text-[11px] text-neutral-300 leading-relaxed font-sans font-medium">{briefing}</p>
          )}
        </div>

        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
