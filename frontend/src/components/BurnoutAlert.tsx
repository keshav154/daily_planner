import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { X } from 'lucide-react';
import type { BurnoutStatusResponse } from '../../../backend/src/types/apiContracts';

type BurnoutStatus = BurnoutStatusResponse;

export const BurnoutAlert: React.FC = () => {
  const [status, setStatus] = useState<BurnoutStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const todayStr = new Date().toISOString().split('T')[0];

  useEffect(() => {
    // Check if already dismissed today
    const dismissedDate = localStorage.getItem('kortex-burnout-dismissed-date');
    if (dismissedDate === todayStr) {
      setDismissed(true);
      return;
    }

    const fetchStatus = async () => {
      try {
        const res = await api.get('/ai/burnout-status');
        setStatus(res.data);
      } catch (err) {
        console.error('Failed to fetch burnout status:', err);
      }
    };
    fetchStatus();
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('kortex-burnout-dismissed-date', todayStr);
    setDismissed(true);
  };

  // Don't render if dismissed or no status or low risk
  if (dismissed || !status || status.riskLevel === 'low') return null;

  const isMedium = status.riskLevel === 'medium';
  const isHigh = status.riskLevel === 'high';

  const panelClass = isMedium
    ? 'border border-amber-500/20 bg-amber-950/10'
    : 'border border-red-500/20 bg-red-950/10';

  const iconClass = isMedium ? 'text-amber-400' : 'text-red-400';
  const textClass = isMedium ? 'text-amber-300' : 'text-red-300';
  const subtextClass = isMedium ? 'text-amber-200/70' : 'text-red-200/70';
  const statClass = isMedium ? 'text-amber-400' : 'text-red-400';
  const statBg = isMedium
    ? 'bg-amber-500/10 border-amber-500/20'
    : 'bg-red-500/10 border-red-500/20';

  return (
    <div className={`glass-panel rounded-xl p-4 ${panelClass} space-y-3 mx-4 mb-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{isHigh ? '🔴' : '⚠️'}</span>
          <p className={`text-xs font-bold uppercase tracking-wider ${iconClass}`}>
            {isHigh ? 'High Burnout Risk' : 'Moderate Burnout Risk'}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-neutral-500 hover:text-neutral-300 p-0.5 rounded cursor-pointer hover:bg-neutral-800 transition-colors shrink-0"
          title="Dismiss for today"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className={`text-xs leading-relaxed ${textClass}`}>{status.message}</p>

      {isHigh && status.advice && (
        <p className={`text-xs leading-relaxed ${subtextClass}`}>{status.advice}</p>
      )}

      <div className={`flex items-center gap-3 pt-1`}>
        <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded border ${statBg} ${statClass}`}>
          <span>⏱</span>
          <span>{status.totalMinutesThisWeek}m this week</span>
        </div>
        {status.overdueTasksCount > 0 && (
          <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded border ${statBg} ${statClass}`}>
            <span>📋</span>
            <span>{status.overdueTasksCount} overdue</span>
          </div>
        )}
      </div>
    </div>
  );
};
