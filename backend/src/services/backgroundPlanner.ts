import { User, Task } from '../models/Schemas';
import { runPlanningLoop, runReflectionLoop } from '../agent/loop';
import { runAutonomousAgentLoop } from './autonomousLoop';
import { consolidateMemories } from './memoryConsolidation';
import { runWeeklyMetaReflection } from './weeklyReflection';
import { buildDailyBriefing } from './briefingService';
import { sendTelegramMessage } from './telegramNotifier';
import { buildTaskActionButtons } from './telegramInteractions';
import { runEveningRitual } from './eveningRitual';
import { runStudyDripForUser } from './studyDrip';
import { runHygieneSweep } from './taskHygiene';

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

      // 2. Morning Planner: prefers 6-9 AM user local time, but runs as a
      // catch-up any time up to 9 PM if it hasn't run yet today. The strict
      // 6-9 window used to mean that if the server was asleep the whole time
      // (Render's free tier spins down after ~15 min of no traffic, and this
      // scheduler is an in-process setInterval that simply doesn't tick while
      // asleep), the day's plan/digest was silently skipped forever — the
      // window had already passed by the time anything woke the server back
      // up. At most once per day either way, via the same date guard.
      const inCatchUpWindow = userHour >= 6 && userHour < 21;

      if (inCatchUpWindow && agentState.lastMorningPlanDate !== userDateStr) {
        log('info', `Running automated morning planning check for ${user.email}${userHour >= 9 ? ' (catch-up)' : ''}...`);
        const plan = await runPlanningLoop(userId, 'background_auto_plan');
        if (plan) {
          user.agentState = { ...agentState, lastMorningPlanDate: userDateStr };
          await user.save();
          log('success', `Automated daily plan successfully compiled for ${user.email}.`);
        }
      }

      // 2b. Push the morning briefing to Telegram, at most once per calendar day.
      // This is what makes the agent reach out instead of waiting to be asked —
      // separate guard from the planner above so it still fires even if the
      // planner step was skipped (e.g. already ran earlier this window).
      if (
        inCatchUpWindow &&
        user.telegramChatId &&
        agentState.lastTelegramDigestDate !== userDateStr
      ) {
        try {
          const { briefing, focusPlan } = await buildDailyBriefing(userId);

          // The Telegram briefing and the in-app card share exactly the same
          // commitments: three existing tasks, never new agent-created work.
          const taskIds = focusPlan.commitments.map(task => task.taskId);
          const taskById = new Map((await Task.find({ userId, _id: { $in: taskIds } })).map(task => [task._id.toString(), task]));
          const topTasks = taskIds.map(id => taskById.get(id)).filter((task): task is NonNullable<typeof task> => Boolean(task));
          const buttons = topTasks.length > 0 ? buildTaskActionButtons(topTasks) : undefined;
          const taskLines = topTasks.length > 0
            ? `\n\nToday's commitments (${focusPlan.plannedMinutes}/${focusPlan.focusBudgetMinutes} min) — protect ${focusPlan.focusWindow}:\n` + topTasks.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
            : '';

          const sent = await sendTelegramMessage(
            user.telegramChatId,
            `🧠 Kortex Morning Briefing\n\n${briefing}${taskLines}`,
            buttons
          );
          if (sent) {
            user.agentState = { ...user.agentState, lastTelegramDigestDate: userDateStr };
            await user.save();
            log('success', `Telegram morning briefing sent to ${user.email}.`);
          }
        } catch (telegramErr: any) {
          log('warn', `Failed to send Telegram briefing to ${user.email}: ${telegramErr.message}`);
        }
      }

      // 2c. Daily study drip: one cert/learning question pushed to Telegram,
      // once per calendar day, within the same daytime catch-up window as the
      // briefing. Turns stalled cert goals into a daily habit.
      if (
        inCatchUpWindow &&
        user.telegramChatId &&
        agentState.lastStudyDripDate !== userDateStr
      ) {
        try {
          const dripped = await runStudyDripForUser(userId, user.telegramChatId);
          // Mark the date regardless of whether a question was sent (no learning
          // goal, or one already open) so we don't retry every hour all day.
          user.agentState = { ...user.agentState, lastStudyDripDate: userDateStr };
          await user.save();
          if (dripped) log('success', `Study drip sent to ${user.email}.`);
        } catch (dripErr: any) {
          log('warn', `Failed to send study drip to ${user.email}: ${dripErr.message}`);
        }
      }

      // 2d. Weekly task-hygiene sweep: flag stale/duplicate tasks to Telegram
      // at most once every 7 days, in the daytime window.
      if (inCatchUpWindow && user.telegramChatId) {
        const lastSweep = agentState.lastHygieneSweepDate;
        const daysSinceSweep = lastSweep
          ? (new Date(userDateStr).getTime() - new Date(lastSweep).getTime()) / (1000 * 60 * 60 * 24)
          : Infinity;
        if (daysSinceSweep >= 7) {
          try {
            const swept = await runHygieneSweep(userId, user.telegramChatId);
            user.agentState = { ...user.agentState, lastHygieneSweepDate: userDateStr };
            await user.save();
            if (swept) log('success', `Task hygiene sweep sent to ${user.email}.`);
          } catch (sweepErr: any) {
            log('warn', `Failed to run hygiene sweep for ${user.email}: ${sweepErr.message}`);
          }
        }
      }

      // 2e. Evening shutdown ritual: once per calendar day, from 9 PM user
      // local time onward (sits just before the 10 PM nightly reflector).
      if (
        userHour >= 21 &&
        user.telegramChatId &&
        agentState.lastEveningRitualDate !== userDateStr
      ) {
        try {
          const sent = await runEveningRitual(userId, user.telegramChatId);
          user.agentState = { ...user.agentState, lastEveningRitualDate: userDateStr };
          await user.save();
          if (sent) log('success', `Evening ritual sent to ${user.email}.`);
        } catch (ritualErr: any) {
          log('warn', `Failed to send evening ritual to ${user.email}: ${ritualErr.message}`);
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
