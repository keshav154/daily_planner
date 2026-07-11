import { Task, Log } from '../models/Schemas';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface GroupStat {
  total: number;
  done: number;
  completionRate: number;      // 0-100
  estimationFactor: number | null; // actual/estimated for completed tasks with both, null if no data
}

export interface TaskHistoryStats {
  windowDays: number;
  totalTasks: number;
  completed: number;
  skipped: number;
  completionRate: number; // 0-100
  overallEstimationFactor: number | null;
  byCategory: Record<string, GroupStat>;
  byPriority: Record<string, GroupStat>;
  byDayOfWeek: Record<string, GroupStat>;
  chronicOverdueTitles: string[];   // open tasks overdue by more than 3 days
  topFocusHours: Array<{ hour: number; minutes: number }>; // from logs
}

function newGroup(): { total: number; done: number; estSum: number; actSum: number; estCount: number } {
  return { total: 0, done: 0, estSum: 0, actSum: 0, estCount: 0 };
}

function finalizeGroup(g: ReturnType<typeof newGroup>): GroupStat {
  return {
    total: g.total,
    done: g.done,
    completionRate: g.total > 0 ? Math.round((g.done / g.total) * 100) : 0,
    estimationFactor: g.estCount > 0 && g.estSum > 0 ? Math.round((g.actSum / g.estSum) * 100) / 100 : null
  };
}

/**
 * Aggregates the user's full task history (default 90 days) into the stats
 * the agent needs for grounded self-reasoning: completion rates by category,
 * priority, and weekday; estimation accuracy; chronically overdue work; and
 * when focus time actually lands. This is the factual base reflections and
 * suggestions must be justified against, instead of the model free-styling
 * generic productivity advice from a single day's snapshot.
 */
export async function computeTaskHistoryStats(userId: string, days = 90): Promise<TaskHistoryStats> {
  const boundedDays = Math.min(365, Math.max(7, days));
  const since = new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000);
  const now = new Date();

  const tasks = await Task.find({ userId, dueDate: { $gte: since } }).lean();
  const logs = await Log.find({ userId, timestamp: { $gte: since } }).lean();

  const byCategory: Record<string, ReturnType<typeof newGroup>> = {};
  const byPriority: Record<string, ReturnType<typeof newGroup>> = {};
  const byDayOfWeek: Record<string, ReturnType<typeof newGroup>> = {};
  const overall = newGroup();
  let skipped = 0;
  const chronicOverdueTitles: string[] = [];

  for (const t of tasks) {
    const groups = [
      (byCategory[t.category || 'Uncategorized'] = byCategory[t.category || 'Uncategorized'] || newGroup()),
      (byPriority[t.priority || 'medium'] = byPriority[t.priority || 'medium'] || newGroup()),
      (byDayOfWeek[DAY_NAMES[new Date(t.dueDate).getDay()]] = byDayOfWeek[DAY_NAMES[new Date(t.dueDate).getDay()]] || newGroup()),
      overall
    ];
    for (const g of groups) {
      g.total++;
      if (t.status === 'done') {
        g.done++;
        if (t.estimatedTime > 0 && t.actualTime > 0) {
          g.estSum += t.estimatedTime;
          g.actSum += t.actualTime;
          g.estCount++;
        }
      }
    }
    if (t.status === 'skipped') skipped++;
    if (
      (t.status === 'todo' || t.status === 'in-progress') &&
      now.getTime() - new Date(t.dueDate).getTime() > 3 * 24 * 60 * 60 * 1000
    ) {
      chronicOverdueTitles.push(t.title);
    }
  }

  const focusByHour: Record<number, number> = {};
  for (const l of logs) {
    const hour = new Date(l.timestamp).getHours();
    focusByHour[hour] = (focusByHour[hour] || 0) + (l.duration || 0);
  }
  const topFocusHours = Object.entries(focusByHour)
    .map(([hour, minutes]) => ({ hour: Number(hour), minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3);

  const finalize = (groups: Record<string, ReturnType<typeof newGroup>>) =>
    Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, finalizeGroup(g)]));

  return {
    windowDays: boundedDays,
    totalTasks: overall.total,
    completed: overall.done,
    skipped,
    completionRate: overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0,
    overallEstimationFactor: overall.estCount > 0 && overall.estSum > 0
      ? Math.round((overall.actSum / overall.estSum) * 100) / 100
      : null,
    byCategory: finalize(byCategory),
    byPriority: finalize(byPriority),
    byDayOfWeek: finalize(byDayOfWeek),
    chronicOverdueTitles: chronicOverdueTitles.slice(0, 10),
    topFocusHours
  };
}

/**
 * Renders the stats as a compact plain-text digest for LLM prompts and the
 * get_task_history tool result.
 */
export function formatStatsDigest(stats: TaskHistoryStats): string {
  const groupLine = (label: string, groups: Record<string, GroupStat>) =>
    `${label}: ` + Object.entries(groups)
      .map(([k, g]) => `${k} ${g.done}/${g.total} done (${g.completionRate}%${g.estimationFactor !== null ? `, actual/est ${g.estimationFactor}x` : ''})`)
      .join('; ');

  const lines = [
    `Task history — last ${stats.windowDays} days:`,
    `Overall: ${stats.completed}/${stats.totalTasks} completed (${stats.completionRate}%), ${stats.skipped} skipped${stats.overallEstimationFactor !== null ? `, overall actual/estimated time factor ${stats.overallEstimationFactor}x` : ''}`,
    groupLine('By category', stats.byCategory),
    groupLine('By priority', stats.byPriority),
    groupLine('By weekday (due date)', stats.byDayOfWeek),
    stats.chronicOverdueTitles.length > 0
      ? `Chronically overdue open tasks (>3 days): ${stats.chronicOverdueTitles.join(' | ')}`
      : 'No chronically overdue open tasks.',
    stats.topFocusHours.length > 0
      ? `Most focus time logged at hours: ${stats.topFocusHours.map(h => `${h.hour}:00 (${h.minutes}m)`).join(', ')}`
      : 'No focus logs in window.'
  ];
  return lines.join('\n');
}
