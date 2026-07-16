import { Task, Log, User } from '../models/Schemas';
import { TelegramButton } from './telegramNotifier';

/**
 * Handles inline-button taps that arrive from Telegram as callback_query
 * updates. Each button carries a short "verb:id" callback_data string; this
 * dispatches on the verb, performs the action against the user's data, and
 * returns a short confirmation to flash back to them.
 *
 * This is the write-side of the interactive Telegram surface — the morning
 * digest, evening ritual, and hygiene sweep all render buttons whose taps
 * land here, so the user can run their day from the chat without opening the
 * app.
 */

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfToday = (): Date => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

/** Completes a task the same way the in-app 1-click complete does: logs the
 *  work and flips status to done. Kept local (rather than importing a route
 *  handler) so a Telegram tap and a UI click converge on identical writes. */
async function completeTask(userId: string, taskId: string): Promise<string> {
  const task = await Task.findOne({ _id: taskId, userId });
  if (!task) return 'That task no longer exists.';
  if (task.status === 'done') return `Already done: ${task.title}`;

  const duration = task.estimatedTime || 30;
  await new Log({
    userId,
    taskId: task._id,
    title: `Completed: ${task.title}`,
    duration,
    notes: 'Completed from Telegram.'
  }).save();

  task.status = 'done';
  task.actualTime = duration;
  await task.save();
  return `✅ Done: ${task.title}`;
}

/** Pushes a task's due date to tomorrow. */
async function deferTask(userId: string, taskId: string): Promise<string> {
  const task = await Task.findOne({ _id: taskId, userId });
  if (!task) return 'That task no longer exists.';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  task.dueDate = tomorrow;
  await task.save();
  return `⏭ Moved to tomorrow: ${task.title}`;
}

/** Rolls every still-open task due today (or overdue) forward to tomorrow —
 *  the evening-ritual "carry the rest to tomorrow" action. */
async function rollAllToTomorrow(userId: string): Promise<string> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const result = await Task.updateMany(
    { userId, status: { $in: ['todo', 'in-progress'] }, dueDate: { $lte: endOfToday() } },
    { $set: { dueDate: tomorrow } }
  );
  return `🌙 Rolled ${result.modifiedCount} task${result.modifiedCount === 1 ? '' : 's'} to tomorrow.`;
}

/** Marks a stale task as skipped (soft-removal from active lists), used by the
 *  hygiene sweep's per-task "clear" button. Skipped (not deleted) so it stays
 *  auditable and never silently vanishes. */
async function clearStaleTask(userId: string, taskId: string): Promise<string> {
  const task = await Task.findOne({ _id: taskId, userId });
  if (!task) return 'That task no longer exists.';
  task.status = 'skipped';
  await task.save();
  return `🧹 Cleared: ${task.title}`;
}

export async function handleTelegramCallback(userId: string, callbackData: string): Promise<string> {
  const [verb, id] = callbackData.split(':');
  switch (verb) {
    case 'done':
      return completeTask(userId, id);
    case 'defer':
      return deferTask(userId, id);
    case 'rollall':
      return rollAllToTomorrow(userId);
    case 'hygdel':
      return clearStaleTask(userId, id);
    case 'hygkeep':
      return '👍 Keeping everything as-is.';
    default:
      return 'Unknown action.';
  }
}

/** Builds Done/Defer button rows for a set of tasks — one row per task. */
export function buildTaskActionButtons(
  tasks: Array<{ _id: any; title: string }>
): TelegramButton[][] {
  return tasks.map(t => [
    { text: `✅ ${truncate(t.title, 22)}`, callback_data: `done:${t._id.toString()}` },
    { text: '⏭', callback_data: `defer:${t._id.toString()}` }
  ]);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
