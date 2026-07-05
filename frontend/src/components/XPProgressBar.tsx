import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Trophy, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

export const XPProgressBar: React.FC = () => {
  const { user } = useAuth();

  if (!user) return null;

  const xp = user.xp || 0;
  const level = user.level || 1;
  const achievements = user.achievements || [];

  // Gamification formulas
  const currentLevelMinXp = (level ** 2) * 100;
  const nextLevelXp = ((level + 1) ** 2) * 100;
  const xpNeededInCurrentLevel = nextLevelXp - currentLevelMinXp;
  const xpProgressInCurrentLevel = xp - currentLevelMinXp;
  
  const percentage = Math.max(0, Math.min(100, Math.round((xpProgressInCurrentLevel / xpNeededInCurrentLevel) * 100)));

  // Map achievement keys to display labels and emojis
  const achievementBadges: Record<string, { label: string; icon: string; desc: string }> = {
    on_fire: { label: 'On Fire', icon: '🔥', desc: '7-day habit completion streak' },
    speed_demon: { label: 'Speed Demon', icon: '⚡', desc: 'Complete 5 tasks in a single day' },
    deep_thinker: { label: 'Deep Thinker', icon: '🧠', desc: 'Log 600+ focus minutes' },
    template_master: { label: 'Template Master', icon: '📚', desc: 'Created 3+ custom task templates' },
    schedule_architect: { label: 'Schedule Architect', icon: '🗓️', desc: 'Created a daily schedule template' }
  };

  return (
    <div className="p-4 mx-4 mb-4 rounded-xl glass-panel border border-white/5 relative overflow-hidden select-none">
      <div className="absolute top-0 right-0 w-12 h-12 bg-indigo-500/5 rounded-full blur-xl pointer-events-none"></div>
      
      {/* Header Level Info */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-md bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/20 shrink-0">
            <Zap className="w-3.5 h-3.5" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Level</p>
            <p className="text-xs font-black text-neutral-100">Level {level}</p>
          </div>
        </div>
        <span className="text-[10px] font-bold text-neutral-400 font-mono bg-neutral-900 px-2 py-0.5 rounded-full border border-white/5">
          {xp} / {nextLevelXp} XP
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-neutral-900 h-2 rounded-full overflow-hidden border border-white/5 relative">
        <motion.div 
          className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        ></motion.div>
      </div>
      <div className="flex justify-between text-[8px] text-neutral-500 font-bold mt-1">
        <span>{percentage}% complete</span>
        <span>{nextLevelXp - xp} XP to Level {level + 1}</span>
      </div>

      {/* Achievements Row */}
      {achievements.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-white/5">
          <p className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Trophy className="w-3 h-3 text-amber-400" />
            <span>Badges Unlocked ({achievements.length})</span>
          </p>
          <div className="flex flex-wrap gap-1">
            {achievements.map((key) => {
              const badge = achievementBadges[key] || { label: key, icon: '⭐', desc: 'Achievement unlocked' };
              return (
                <div 
                  key={key} 
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-[10px] border border-white/5 cursor-help transition-colors"
                  title={`${badge.label}: ${badge.desc}`}
                >
                  <span>{badge.icon}</span>
                  <span className="font-semibold text-neutral-300 text-[9px]">{badge.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
