import { Task, AgentMemory } from '../models/Schemas';
import Habit from '../models/Habit';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cross-day meta-reflection over the last 30 days: looks for day-of-week
 * completion trends and habit/task-completion correlations that a single
 * daily reflection can never see. Writes results as high-signal AgentMemory
 * patterns so the planner and autonomous loop can act on them.
 */
export const runWeeklyMetaReflection = async (userId: string): Promise<string[]> => {
  const written: string[] = [];
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const tasks = await Task.find({ userId, dueDate: { $gte: thirtyDaysAgo }, status: { $ne: 'skipped' } });

    if (tasks.length < 10) return written; // not enough data for a meaningful weekly pattern yet

    // 1. Completion rate by day of week
    const byDay: Record<number, { done: number; total: number }> = {};
    for (const t of tasks) {
      const day = new Date(t.dueDate).getDay();
      const stats = byDay[day] || { done: 0, total: 0 };
      stats.total++;
      if (t.status === 'done') stats.done++;
      byDay[day] = stats;
    }

    const overallDone = tasks.filter(t => t.status === 'done').length;
    const overallRate = overallDone / tasks.length;

    for (const [dayStr, stats] of Object.entries(byDay)) {
      if (stats.total < 3) continue;
      const rate = stats.done / stats.total;
      const delta = rate - overallRate;
      if (Math.abs(delta) < 0.25) continue;

      const dayName = DAY_NAMES[Number(dayStr)];
      const direction = delta > 0 ? 'higher' : 'lower';
      const content = `Weekly Pattern: Task completion on ${dayName}s is ${Math.round(Math.abs(delta) * 100)} points ${direction} than your average (${Math.round(rate * 100)}% vs ${Math.round(overallRate * 100)}% overall, based on ${stats.total} tasks).`;

      await AgentMemory.deleteMany({
        userId,
        category: 'Weekly Pattern',
        content: new RegExp(`^Weekly Pattern: Task completion on ${dayName}s`, 'i')
      });

      const mem = new AgentMemory({
        userId,
        type: 'pattern',
        category: 'Weekly Pattern',
        content,
        feedback: 'none',
        source: 'reflection',
        importance: 6
      });
      await mem.save();
      written.push(content);
    }

    // 2. Habit completion vs task completion correlation
    const habits = await Habit.find({ userId, isActive: true });
    const tasksByDate: Record<string, { done: number; total: number }> = {};
    for (const t of tasks) {
      const dateStr = new Date(t.dueDate).toISOString().split('T')[0];
      const stats = tasksByDate[dateStr] || { done: 0, total: 0 };
      stats.total++;
      if (t.status === 'done') stats.done++;
      tasksByDate[dateStr] = stats;
    }

    for (const habit of habits) {
      const doneDays = new Set(habit.completions.filter(c => c.completed).map(c => c.date));
      if (doneDays.size < 5) continue;

      let habitDoneSum = 0, habitDoneCount = 0;
      let habitMissedSum = 0, habitMissedCount = 0;
      for (const [dateStr, stats] of Object.entries(tasksByDate)) {
        const rate = stats.done / stats.total;
        if (doneDays.has(dateStr)) {
          habitDoneSum += rate;
          habitDoneCount++;
        } else {
          habitMissedSum += rate;
          habitMissedCount++;
        }
      }

      if (habitDoneCount < 3 || habitMissedCount < 3) continue;

      const avgDone = habitDoneSum / habitDoneCount;
      const avgMissed = habitMissedSum / habitMissedCount;
      const delta = avgDone - avgMissed;
      if (Math.abs(delta) < 0.2) continue;

      const direction = delta > 0 ? 'higher' : 'lower';
      const content = `Habit Correlation: On days you complete "${habit.title}", your task completion rate is ${Math.round(Math.abs(delta) * 100)} points ${direction} (${Math.round(avgDone * 100)}% vs ${Math.round(avgMissed * 100)}%).`;

      await AgentMemory.deleteMany({
        userId,
        category: 'Habit Correlation',
        content: new RegExp(`^Habit Correlation: On days you complete "${escapeRegex(habit.title)}"`, 'i')
      });

      const mem = new AgentMemory({
        userId,
        type: 'pattern',
        category: 'Habit Correlation',
        content,
        feedback: 'none',
        source: 'reflection',
        importance: 7
      });
      await mem.save();
      written.push(content);
    }
  } catch (err) {
    console.error('[Weekly Reflection] Failed:', err);
  }
  return written;
};
