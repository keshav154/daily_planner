import { AgentRun, AgentMemory } from '../models/Schemas';

const ACTION_LABELS: Record<string, string> = {
  reorder: 'reordering the task list',
  suggest_time_block: 'scheduling a time block',
  break_down: 'breaking a task into subtasks',
  nudge: 'nudges/alerts',
  create_task: 'auto-creating a task'
};

/**
 * Mines the accept/reject history on AgentRun.actionsTaken to learn which
 * suggestion types the user actually wants. This is the "gets smarter over
 * time" loop for suggestions — closing the feedback cycle that acceptance
 * data was already being collected for but never read back.
 */
export const mineSuggestionFeedback = async (userId: string): Promise<string[]> => {
  const written: string[] = [];
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const runs = await AgentRun.find({ userId, createdAt: { $gte: thirtyDaysAgo } });

    const statsByAction: Record<string, { accepted: number; rejected: number }> = {};
    for (const run of runs) {
      for (const action of run.actionsTaken) {
        if (action.status === 'pending') continue;
        const stats = statsByAction[action.actionType] || { accepted: 0, rejected: 0 };
        if (action.status === 'accepted') stats.accepted++;
        else stats.rejected++;
        statsByAction[action.actionType] = stats;
      }
    }

    for (const [actionType, stats] of Object.entries(statsByAction)) {
      const total = stats.accepted + stats.rejected;
      if (total < 5) continue; // not enough resolved signal yet

      const acceptRate = stats.accepted / total;
      const label = ACTION_LABELS[actionType] || actionType;

      // Replace any previous pattern memory for this action type with the fresh read
      await AgentMemory.deleteMany({
        userId,
        category: 'Suggestion Feedback Pattern',
        content: new RegExp(`^Suggestion Feedback Pattern for ${actionType}:`, 'i')
      });

      let content: string | null = null;
      let importance = 6;

      if (acceptRate <= 0.3) {
        content = `Suggestion Feedback Pattern for ${actionType}: user rejects ${label} suggestions ${Math.round((1 - acceptRate) * 100)}% of the time (${stats.rejected}/${total} resolved). Propose these sparingly and only with strong justification.`;
        importance = 8;
      } else if (acceptRate >= 0.8) {
        content = `Suggestion Feedback Pattern for ${actionType}: user accepts ${label} suggestions ${Math.round(acceptRate * 100)}% of the time (${stats.accepted}/${total} resolved). These are trusted — feel free to propose them proactively.`;
        importance = 6;
      }

      if (content) {
        const mem = new AgentMemory({
          userId,
          type: 'preference',
          category: 'Suggestion Feedback Pattern',
          content,
          feedback: 'accepted',
          source: 'reflection',
          importance
        });
        await mem.save();
        written.push(content);
      }
    }
  } catch (err) {
    console.error('[Feedback Mining] Failed to mine suggestion feedback:', err);
  }
  return written;
};

/**
 * Mines AgentMemory.feedback history by category to learn which categories
 * of reflection insight the user finds useless, so future reflections can
 * de-emphasize them.
 */
export const mineMemoryFeedback = async (userId: string): Promise<string[]> => {
  const written: string[] = [];
  try {
    const memories = await AgentMemory.find({
      userId,
      category: { $ne: 'Suggestion Feedback Pattern' },
      feedback: { $in: ['accepted', 'rejected'] }
    });

    const statsByCategory: Record<string, { accepted: number; rejected: number }> = {};
    for (const mem of memories) {
      const cat = mem.category || 'general';
      const stats = statsByCategory[cat] || { accepted: 0, rejected: 0 };
      if (mem.feedback === 'accepted') stats.accepted++;
      else stats.rejected++;
      statsByCategory[cat] = stats;
    }

    for (const [category, stats] of Object.entries(statsByCategory)) {
      const total = stats.accepted + stats.rejected;
      if (total < 5) continue;

      const rejectRate = stats.rejected / total;
      if (rejectRate < 0.6) continue; // only flag categories the user mostly dismisses

      await AgentMemory.deleteMany({
        userId,
        category: 'Memory Feedback Pattern',
        content: new RegExp(`^Memory Feedback Pattern for ${category}:`, 'i')
      });

      const content = `Memory Feedback Pattern for ${category}: user has rejected ${stats.rejected}/${total} insights in this category. Be more conservative and specific before surfacing new "${category}" insights.`;

      const mem = new AgentMemory({
        userId,
        type: 'preference',
        category: 'Memory Feedback Pattern',
        content,
        feedback: 'accepted',
        source: 'reflection',
        importance: 7
      });
      await mem.save();
      written.push(content);
    }
  } catch (err) {
    console.error('[Feedback Mining] Failed to mine memory feedback:', err);
  }
  return written;
};
