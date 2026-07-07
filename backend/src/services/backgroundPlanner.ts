import { User } from '../models/Schemas';
import { runPlanningLoop, runReflectionLoop } from '../agent/loop';
import { runAutonomousAgentLoop } from './autonomousLoop';
import { consolidateMemories } from './memoryConsolidation';

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
    const localHour = now.getHours();

    for (const user of users) {
      const userId = user._id.toString();

      // 1. Hourly Think-Act-Observe check
      log('info', `Running hourly autonomous second brain audit for ${user.email}...`);
      await runAutonomousAgentLoop(userId, 'background_hourly_check');

      // 2. Morning Planner: run once daily between 6 AM and 9 AM local time
      if (localHour >= 6 && localHour < 9) {
        log('info', `Running automated morning planning check for ${user.email}...`);
        const alreadyPlanned = await runPlanningLoop(userId, 'background_auto_plan');
        if (alreadyPlanned) {
          log('success', `Automated daily plan successfully compiled for ${user.email}.`);
        }
      }

      // 3. Nightly Reflector: run once daily between 10 PM and midnight
      if (localHour >= 22) {
        log('info', `Running automated nightly reflection and memory consolidation check for ${user.email}...`);
        const reflection = await runReflectionLoop(userId);
        if (reflection) {
          log('success', `Automated daily reflection complete for ${user.email}. Memories generated: ${reflection.insights?.length || 0}`);
        }

        // Run memory consolidation (merging, decay, indexing)
        await consolidateMemories(userId);
        log('success', `Memory consolidation completed for ${user.email}.`);
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
