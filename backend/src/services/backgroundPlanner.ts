import { User } from '../models/Schemas';
import { runPlanningLoop, runReflectionLoop } from '../agent/loop';
import { runAutonomousAgentLoop } from './autonomousLoop';
import { consolidateMemories } from './memoryConsolidation';
import { runWeeklyMetaReflection } from './weeklyReflection';

export interface BackgroundLogEntry {
  timestamp: Date;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export const backgroundLogs: BackgroundLogEntry[] = [
  {
    timestamp: new Date(),
    type: 'info',
    message: 'Kortex Background Co-pilot Daemon initialized.'
  }
];

const log = (type: 'info' | 'success' | 'warn' | 'error', message: string) => {
  backgroundLogs.push({ timestamp: new Date(), type, message });
  if (backgroundLogs.length > 100) {
    backgroundLogs.shift();
  }
  console.log(`[Co-Pilot Background] ${message}`);
};

/**
 * Checks and triggers daily automated loops for all active users.
 */
export const runAutonomousChecks = async () => {
  try {
    const users = await User.find();
    if (users.length === 0) {
      log('info', 'No active users found to run autonomous checks.');
      return;
    }

    const now = new Date();

    for (const user of users) {
      const userId = user._id.toString();
      const timezone = user.timezone || 'UTC';

      // Compute current hour and calendar date in user's timezone
      let userHour = now.getHours(); // default fallback
      let userDateStr = now.toISOString().split('T')[0]; // default fallback
      try {
        const userTimeStr = now.toLocaleString("en-US", {
          timeZone: timezone,
          hour: 'numeric',
          hour12: false
        });
        userHour = parseInt(userTimeStr, 10);
        userDateStr = now.toLocaleDateString("en-CA", { timeZone: timezone }); // en-CA => YYYY-MM-DD
      } catch (tzErr) {
        console.warn(`Failed to resolve timezone ${timezone} for user ${user.email}, falling back to server time.`, tzErr);
      }

      const agentState = user.agentState || {};

      // 1. Hourly Think-Act-Observe check (safe to run every cycle; it only takes small, reversible actions)
      log('info', `Running hourly autonomous second brain audit for ${user.email} (Local Hour: ${userHour})...`);
      await runAutonomousAgentLoop(userId, 'background_hourly_check');

      // 2. Morning Planner: run at most once per calendar day, between 6 AM and 9 AM user local time
      if (userHour >= 6 && userHour < 9 && agentState.lastMorningPlanDate !== userDateStr) {
        log('info', `Running automated morning planning check for ${user.email}...`);
        const plan = await runPlanningLoop(userId, 'background_auto_plan');
        if (plan) {
          user.agentState = { ...agentState, lastMorningPlanDate: userDateStr };
          await user.save();
          log('success', `Automated daily plan successfully compiled for ${user.email}.`);
        }
      }

      // 3. Nightly Reflector: run at most once per calendar day, from 10 PM user local time onward
      if (userHour >= 22 && agentState.lastReflectionDate !== userDateStr) {
        log('info', `Running automated nightly reflection and memory consolidation check for ${user.email}...`);
        const reflection = await runReflectionLoop(userId);
        if (reflection) {
          log('success', `Automated daily reflection complete for ${user.email}. Memories generated: ${reflection.insights?.length || 0}`);
        }

        // Run memory consolidation (merging, decay, feedback mining, indexing)
        await consolidateMemories(userId);
        log('success', `Memory consolidation completed for ${user.email}.`);

        user.agentState = { ...user.agentState, lastReflectionDate: userDateStr };
        await user.save();

        // 4. Weekly Meta-Reflection: run at most once every 7 days, piggybacking on the nightly window
        const lastWeekly = user.agentState.lastWeeklyReflectionDate;
        const daysSinceWeekly = lastWeekly
          ? (new Date(userDateStr).getTime() - new Date(lastWeekly).getTime()) / (1000 * 60 * 60 * 24)
          : Infinity;

        if (daysSinceWeekly >= 7) {
          log('info', `Running weekly meta-reflection (day-of-week & habit correlation patterns) for ${user.email}...`);
          const patterns = await runWeeklyMetaReflection(userId);
          user.agentState = { ...user.agentState, lastWeeklyReflectionDate: userDateStr };
          await user.save();
          log('success', `Weekly meta-reflection complete for ${user.email}. Patterns found: ${patterns.length}`);
        }
      }
    }
  } catch (err: any) {
    log('error', `Autonomous checks loop failed: ${err.message}`);
  }
};

let schedulerInterval: NodeJS.Timeout | null = null;

export const startBackgroundScheduler = (intervalMs: number = 3600000) => {
  if (schedulerInterval) return;
  
  log('info', `Starting background Co-pilot scheduler. Checking every ${intervalMs / 60000} minutes.`);
  
  // Run once immediately on start
  runAutonomousChecks();
  
  schedulerInterval = setInterval(() => {
    runAutonomousChecks();
  }, intervalMs);
};
