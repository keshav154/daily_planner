import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const DailyBriefingCard: React.FC = () => {
  const [briefing, setBriefing] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    // Check if user has already dismissed the briefing today
    const todayStr = new Date().toISOString().split('T')[0];
    const dismissedDate = localStorage.getItem('kortex-briefing-dismissed');
    
    if (dismissedDate === todayStr) {
      setLoading(false);
      return;
    }

    const fetchBriefing = async () => {
      try {
        const response = await api.get('/briefing/daily');
        if (response.data?.briefing) {
          setBriefing(response.data.briefing);
          setVisible(true);
        }
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
    localStorage.setItem('kortex-briefing-dismissed', todayStr);
    setVisible(false);
  };

  if (loading || !visible || !briefing) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="glass-panel rounded-2xl p-5 shadow-xl border border-indigo-500/20 bg-indigo-950/10 relative overflow-hidden mb-6"
      >
        <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none"></div>
        
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20 shrink-0 mt-0.5">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>

          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Kortex Daily Briefing</h4>
              <button 
                onClick={handleDismiss}
                className="text-neutral-500 hover:text-neutral-300 p-1 rounded-lg cursor-pointer hover:bg-neutral-800 transition-colors"
                title="Dismiss for today"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm font-medium text-neutral-200 leading-relaxed pt-1 select-text">
              {briefing}
            </p>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
