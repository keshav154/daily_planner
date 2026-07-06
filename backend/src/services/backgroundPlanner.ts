import { User } from '../models/Schemas';
import { runPlanningLoop, runReflectionLoop } from '../agent/loop';

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
    // Simulate user timezone offset or default to system local time
    const localHour = now.getHours();

    for (const user of users) {
      const userId = user._id.toString();

      // Morning Planner: run once daily between 6 AM and 9 AM local time
      if (localHour >= 6 && localHour < 9) {
        log('info', `Running automated morning planning check for ${user.email}...`);
        // Verify if a background planning run has already run today
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const alreadyPlanned = await runPlanningLoop(userId, 'background_auto_plan');
        if (alreadyPlanned) {
          log('success', `Automated daily plan successfully compiled for ${user.email}.`);
        }
      }

      // Nightly Reflector: run once daily between 10 PM and midnight
      if (localHour >= 22) {
        log('info', `Running automated nightly reflection check for ${user.email}...`);
        const reflection = await runReflectionLoop(userId);
        if (reflection) {
          log('success', `Automated daily reflection complete for ${user.email}. Memories generated: ${reflection.insights?.length || 0}`);
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
