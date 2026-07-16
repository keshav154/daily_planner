import { Task } from '../models/Schemas';
import { sendTelegramMessage } from './telegramNotifier';

/**
 * Evening shutdown ritual: once a day, in the evening, the agent messages the
 * user a short close-out — how many of today's tasks they finished, and a
 * one-tap button to roll whatever's left to tomorrow. It also invites a
 * free-text reflection reply; that reply flows back through the normal
 * Telegram message handler (processAgentMessage → remember_fact), so the
 * nightly reflection loop finally has real first-person input to work with
 * instead of only the agent's own observations.
 *
 * Returns true if a ritual message was sent (used by the scheduler's once-per-
 * day guard).
 */
export async function runEveningRitual(userId: string, chatId: string): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Tasks that were due today (any status) → completion ratio for today.
  const dueToday = await Task.find({
    userId,
    dueDate: { $gte: startOfDay, $lte: endOfDay }
  });
  const doneToday = dueToday.filter(t => t.status === 'done' || t.status === 'skipped').length;

  // Everything still open and due today-or-earlier is what "rolls forward".
  const openBacklog = await Task.countDocuments({
    userId,
    status: { $in: ['todo', 'in-progress'] },
    dueDate: { $lte: endOfDay }
  });

  // Nothing scheduled and nothing outstanding — no reason to nag.
  if (dueToday.length === 0 && openBacklog === 0) return false;

  const ratio = dueToday.length > 0 ? `${doneToday}/${dueToday.length}` : 'no scheduled';
  let text = `🌙 Evening check-in\n\nYou closed ${ratio} of today's tasks.`;
  if (openBacklog > 0) {
    text += `\n\n${openBacklog} still open. Want to carry them to tomorrow?`;
  }
  text += `\n\nAnything worth remembering about today? Just reply and I'll note it.`;

  const buttons = openBacklog > 0
    ? [[{ text: `🌙 Roll ${openBacklog} to tomorrow`, callback_data: 'rollall' }]]
    : undefined;

  return sendTelegramMessage(chatId, text, buttons);
}
