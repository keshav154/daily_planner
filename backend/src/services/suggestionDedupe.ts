import { AgentRun } from '../models/Schemas';

export interface SuggestionLike {
  id: string;
  taskId?: string;
  actionType: string;
  description: string;
  details: Record<string, any>;
}

function suggestionKey(s: Pick<SuggestionLike, 'actionType' | 'taskId' | 'details' | 'description'>): string {
  // Reorders/nudges have no taskId, so actionType alone would collapse every
  // distinct create_task suggestion into "only one ever pending" — using the
  // task title (or a slice of the description) as a fallback discriminator
  // keeps genuinely different suggestions distinct while still catching the
  // real duplicates (the same reorder, or the same task's time-block, being
  // re-proposed every cycle).
  const discriminator = s.taskId || s.details?.title || s.description.slice(0, 60);
  return `${s.actionType}::${discriminator}`;
}

/**
 * Filters out suggestions that duplicate one already pending from a recent
 * run. Every planning/autonomous cycle used to propose a fresh batch with no
 * awareness of what's already awaiting the user's review — six consecutive
 * hourly cycles proposing the identical "reorder your tasks" suggestion was
 * the concrete symptom that surfaced this: pending suggestions accumulated
 * indefinitely instead of settling once the user had something to review.
 */
export async function filterDuplicateSuggestions(
  userId: string,
  candidates: SuggestionLike[],
  lookbackHours: number = 48
): Promise<SuggestionLike[]> {
  if (candidates.length === 0) return candidates;

  try {
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    const recentRuns = await AgentRun.find({ userId, createdAt: { $gte: since } })
      .select('planOutput.suggestions actionsTaken')
      .lean();

    const pendingKeys = new Set<string>();
    for (const run of recentRuns) {
      const statusBySuggestionId = new Map(
        (run.actionsTaken || []).map((a: any) => [a.suggestionId, a.status])
      );
      for (const s of run.planOutput?.suggestions || []) {
        if (statusBySuggestionId.get(s.id) === 'pending') {
          pendingKeys.add(suggestionKey(s));
        }
      }
    }

    if (pendingKeys.size === 0) return candidates;
    return candidates.filter(c => !pendingKeys.has(suggestionKey(c)));
  } catch (err) {
    console.error('Failed to filter duplicate suggestions:', err);
    // On failure, err on the side of showing the suggestion rather than
    // silently dropping it.
    return candidates;
  }
}
