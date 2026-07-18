import { ITask, IUser } from '../models/Schemas';
import { IRecurringEvent } from '../models/RecurringEvent';
import { computeTaskHistoryStats } from './taskHistory';

export interface FocusCommitment {
  taskId: string;
  title: string;
  estimatedMinutes: number;
  reason: string;
}

export interface DailyFocusPlan {
  commitments: FocusCommitment[];
  plannedMinutes: number;
  focusBudgetMinutes: number;
  focusWindow: string;
  calendarReservedMinutes: number;
  calendarEventsCount: number;
  attention: string;
}

const priorityScore: Record<string, number> = { high: 180, medium: 100, low: 40 };

function hoursBetween(start: string, end: string): number {
  const [startHour = 9, startMinute = 0] = start.split(':').map(Number);
  const [endHour = 17, endMinute = 0] = end.split(':').map(Number);
  return Math.max(2, Math.min(14, ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60));
}

function focusWindowFromHour(hour: number | undefined, peak: IUser['preferences']['peakEnergyTime']): string {
  if (hour !== undefined) return `${String(hour).padStart(2, '0')}:00–${String((hour + 2) % 24).padStart(2, '0')}:00`;
  const fallback: Record<typeof peak, string> = { morning: '09:00–11:00', afternoon: '14:00–16:00', evening: '18:00–20:00', night: '20:00–22:00' };
  return fallback[peak] || fallback.morning;
}

function minutesForRange(start: string, end: string): number {
  const [startHour = 0, startMinute = 0] = start.split(':').map(Number);
  const [endHour = 0, endMinute = 0] = end.split(':').map(Number);
  const delta = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  return delta > 0 ? delta : 0;
}

function findAvailableFocusWindow(
  preferredHour: number | undefined,
  workStart: string,
  workEnd: string,
  reservedEvents: IRecurringEvent[]
): string {
  const [startHour = 9] = workStart.split(':').map(Number);
  const [endHour = 17] = workEnd.split(':').map(Number);
  const preferred = preferredHour ?? startHour;
  const candidates = Array.from({ length: Math.max(0, endHour - startHour - 1) }, (_, index) => startHour + index)
    .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));

  for (const hour of candidates) {
    const blockStart = hour * 60;
    const blockEnd = blockStart + 120;
    const overlaps = reservedEvents.some(event => {
      const [eventHour = 0, eventMinute = 0] = event.startTime.split(':').map(Number);
      const eventStart = eventHour * 60 + eventMinute;
      return eventStart < blockEnd && eventStart + minutesForRange(event.startTime, event.endTime) > blockStart;
    });
    if (!overlaps) return `${String(hour).padStart(2, '0')}:00–${String(hour + 2).padStart(2, '0')}:00`;
  }
  return focusWindowFromHour(preferredHour, 'morning');
}

/** A small, explainable daily plan made only from existing tasks. It never writes to tasks. */
export async function buildDailyFocusPlan(
  userId: string,
  user: IUser,
  activeTasks: ITask[],
  recurringEvents: IRecurringEvent[] = []
): Promise<DailyFocusPlan> {
  const workHours = hoursBetween(user.preferences?.workingHoursStart || '09:00', user.preferences?.workingHoursEnd || '17:00');
  const reservedEvents = recurringEvents.filter(event => ['meeting', 'standup', 'break', 'block'].includes(event.type));
  const calendarReservedMinutes = reservedEvents.reduce((total, event) => total + minutesForRange(event.startTime, event.endTime), 0);
  const availableMinutes = Math.max(60, workHours * 60 - calendarReservedMinutes);
  const focusBudgetMinutes = Math.round(Math.min(240, Math.max(60, availableMinutes * 0.6)) / 15) * 15;
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const stats = await computeTaskHistoryStats(userId, 90);
  const ranked = activeTasks.map(task => {
    const due = new Date(task.dueDate);
    const isDueToday = due >= startOfToday && due <= new Date(startOfToday.getTime() + 86400000 - 1);
    const overdueDays = Math.max(0, Math.floor((startOfToday.getTime() - due.getTime()) / 86400000));
    const categoryHistory = stats.byCategory[task.category || 'Uncategorized'];
    const score = (priorityScore[task.priority] || 100) + (isDueToday ? 150 : 0) + Math.min(60, overdueDays * 8) + (task.status === 'in-progress' ? 70 : 0) + (categoryHistory && categoryHistory.completionRate >= 60 ? 20 : 0);
    return { task, score, isDueToday, overdueDays };
  }).sort((a, b) => b.score - a.score || new Date(a.task.dueDate).getTime() - new Date(b.task.dueDate).getTime());

  const commitments: FocusCommitment[] = [];
  let plannedMinutes = 0;
  for (const candidate of ranked) {
    if (commitments.length >= 3) break;
    const estimate = Math.max(15, candidate.task.estimatedTime || 30);
    if (commitments.length > 0 && plannedMinutes + estimate > focusBudgetMinutes) continue;
    const reasons = [candidate.task.status === 'in-progress' ? 'already in progress' : '', candidate.isDueToday ? 'due today' : '', !candidate.isDueToday && candidate.overdueDays > 0 ? 'needs a clear decision' : '', candidate.task.priority === 'high' ? 'high priority' : ''].filter(Boolean);
    commitments.push({ taskId: candidate.task._id.toString(), title: candidate.task.title, estimatedMinutes: estimate, reason: reasons.slice(0, 2).join(' · ') || 'best fit for today' });
    plannedMinutes += estimate;
  }

  const focusWindow = findAvailableFocusWindow(
    stats.topFocusHours[0]?.hour,
    user.preferences?.workingHoursStart || '09:00',
    user.preferences?.workingHoursEnd || '17:00',
    reservedEvents
  );
  const attention = commitments.length === 0
    ? 'Your task list is clear. Use the space for planning, recovery, or a small proactive improvement.'
    : plannedMinutes > focusBudgetMinutes * 0.8
      ? 'This is a full focus load. Treat everything else as optional until these commitments move.'
      : 'A deliberately small plan: protect the focus window and leave room for real work that appears during the day.';
  return { commitments, plannedMinutes, focusBudgetMinutes, focusWindow, calendarReservedMinutes, calendarEventsCount: reservedEvents.length, attention };
}
