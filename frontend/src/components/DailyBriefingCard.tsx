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
            <p className="text-[11px] text-black dark:text-neutral-300 leading-relaxed font-sans font-bold">{briefing}</p>
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
