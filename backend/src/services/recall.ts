import { Task, Log, AgentMemory } from '../models/Schemas';
import { embedText, cosineSimilarity } from './embeddings';
import { tokenOverlapScore, recordMemoryEngagement } from './similarity';

/**
 * "Recall what I did" — natural-language search over the user's own history.
 * Scores three sources of accumulated knowledge against the query:
 *   - Logs         (every completed task: what was done, when, notes)
 *   - Task.resolution (how a task was resolved)
 *   - AgentMemory  (insights + auto-researched SRE tech references)
 * Uses embedding cosine similarity when available, falling back to the same
 * SRE-synonym-aware token overlap the memory search already uses — so it works
 * even with no NIM key (just less semantically). This is the retrieval core the
 * "second brain" recall page and the Telegram/chat search tool both call.
 */

export interface RecallResult {
  kind: 'log' | 'task' | 'memory';
  title: string;
  detail: string;
  date: Date;
  score: number;
  linkedTaskId?: string;
  memoryId?: string; // present for memory-kind results; drives self-curation
}

export async function searchHistory(userId: string, query: string, limit = 8): Promise<RecallResult[]> {
  const q = (query || '').trim();
  if (!q) return [];

  const queryVec = await embedText(q, 'query');
  const queryTokens = q.toLowerCase().split(/\W+/).filter(t => t.length > 2);

  const [logs, tasks, memories] = await Promise.all([
    Log.find({ userId }).sort({ timestamp: -1 }).limit(500).lean(),
    Task.find({ userId, resolution: { $exists: true, $nin: ['', null] } }).sort({ updatedAt: -1 }).limit(300).lean(),
    AgentMemory.find({ userId, feedback: { $ne: 'rejected' } }).limit(300).lean()
  ]);

  // Prefer vector similarity when both sides have an embedding; otherwise fall
  // back to token overlap so items without embeddings still rank.
  const scoreOne = (content: string, embedding?: number[]): number => {
    if (queryVec && embedding && embedding.length > 0) {
      const s = cosineSimilarity(queryVec, embedding);
      if (s > 0) return s;
    }
    return tokenOverlapScore(queryTokens, { content });
  };

  const results: RecallResult[] = [];
  const taskIdsFromLogs = new Set<string>();

  for (const l of logs) {
    const content = `${l.title} ${l.notes || ''}`;
    const score = scoreOne(content, l.embedding as number[] | undefined);
    if (score > 0.01) {
      if (l.taskId) taskIdsFromLogs.add(l.taskId.toString());
      results.push({
        kind: 'log',
        title: l.title.replace(/^Completed:\s*/i, ''),
        detail: l.notes || '',
        date: l.timestamp,
        score,
        linkedTaskId: l.taskId?.toString()
      });
    }
  }

  for (const t of tasks) {
    // Skip resolutions already represented by a completed-log for the same task,
    // to avoid showing the same piece of work twice.
    if (taskIdsFromLogs.has(t._id.toString())) continue;
    const content = `${t.title} ${t.resolution || ''}`;
    const score = scoreOne(content); // Tasks carry no embedding; token overlap.
    if (score > 0.01) {
      results.push({
        kind: 'task',
        title: t.title,
        detail: t.resolution || '',
        date: t.updatedAt,
        score,
        linkedTaskId: t._id.toString()
      });
    }
  }

  for (const m of memories) {
    const base = scoreOne(m.content, m.embedding as number[] | undefined);
    if (base > 0.01) {
      // Self-curation: memories the user keeps engaging with rank higher in
      // recall too (capped so a hot memory can't crowd out fresh matches).
      const engagementBoost = 1.0 + Math.min(0.5, Math.log1p((m as any).accessCount || 0) * 0.15);
      results.push({
        kind: 'memory',
        title: m.category || 'insight',
        detail: m.content,
        date: m.createdAt,
        score: base * engagementBoost,
        memoryId: m._id.toString()
      });
    }
  }

  results.sort((a, b) => b.score - a.score || b.date.getTime() - a.date.getTime());

  // Collapse identical entries (the history can contain duplicate logs with the
  // same title + notes) so recall never shows the same line twice; keep the
  // highest-scoring occurrence, which sorting already placed first.
  const seen = new Set<string>();
  const deduped: RecallResult[] = [];
  for (const r of results) {
    const key = `${r.title.trim().toLowerCase()}::${r.detail.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  const top = deduped.slice(0, limit);

  // A memory that surfaced for a real user query is a usefulness signal —
  // record engagement so it self-curates upward over time. Fire-and-forget.
  const memoryIds = top.filter(r => r.memoryId).map(r => r.memoryId);
  if (memoryIds.length > 0) void recordMemoryEngagement(memoryIds);

  return top;
}
