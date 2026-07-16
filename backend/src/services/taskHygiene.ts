import { Task } from '../models/Schemas';
import { sendTelegramMessage, TelegramButton } from './telegramNotifier';

/**
 * Finds tasks that are probably noise: long-overdue, or an open copy of a
 * task that already has a completed twin. This is the detection behind the
 * "task hygiene sweep" — the exact classes of clutter that made the planner
 * feel noisy (stale overdue items, and duplicate copies where one was already
 * finished but a second was left open).
 */
export interface StaleTask {
  id: string;
  title: string;
  reason: string;
}

export async function detectStaleTasks(userId: string): Promise<StaleTask[]> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const allTasks = await Task.find({ userId }).lean();
  const open = allTasks.filter(t => t.status === 'todo' || t.status === 'in-progress');
  const doneTitles = new Set(
    allTasks
      .filter(t => t.status === 'done')
      .map(t => t.title.trim().toLowerCase())
  );

  const stale: StaleTask[] = [];
  const seen = new Set<string>();

  for (const t of open) {
    const id = t._id.toString();
    // (a) open task whose title matches an already-completed task → likely a
    //     leftover duplicate of work that's already done.
    if (doneTitles.has(t.title.trim().toLowerCase())) {
      stale.push({ id, title: t.title, reason: 'a completed copy already exists' });
      seen.add(id);
      continue;
    }
    // (b) badly overdue and untouched for over a week.
    if (t.dueDate < sevenDaysAgo) {
      const days = Math.floor((now.getTime() - new Date(t.dueDate).getTime()) / (24 * 60 * 60 * 1000));
      stale.push({ id, title: t.title, reason: `overdue ${days} days` });
      seen.add(id);
    }
  }

  return stale;
}

/**
 * Runs a hygiene sweep and, if anything looks stale, pushes it to Telegram
 * with a per-task "clear" button plus a "keep all" dismissal. Returns true if
 * a message was sent. Safe to trigger on demand (a "cleanup" reply) or on a
 * weekly cadence.
 */
export async function runHygieneSweep(userId: string, chatId: string): Promise<boolean> {
  const stale = await detectStaleTasks(userId);
  if (stale.length === 0) return false;

  const shown = stale.slice(0, 6);
  const lines = shown.map(s => `• ${s.title} — _${s.reason}_`).join('\n');
  const text = `🧹 ${stale.length} task${stale.length === 1 ? '' : 's'} look stale:\n\n${lines}\n\nTap to clear the ones you're done with:`;

  const buttons: TelegramButton[][] = shown.map(s => [
    { text: `🧹 ${s.title.length > 24 ? s.title.slice(0, 23) + '…' : s.title}`, callback_data: `hygdel:${s.id}` }
  ]);
  buttons.push([{ text: '👍 Keep all', callback_data: 'hygkeep' }]);

  return sendTelegramMessage(chatId, text, buttons);
}
