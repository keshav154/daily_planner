import { AgentMemory } from '../models/Schemas';
import { embedText, cosineSimilarity } from './embeddings';

const SRE_SYNONYMS: Record<string, string[]> = {
  'kubernetes': ['k8s', 'cluster', 'clusters', 'pod', 'pods', 'deployment', 'deployments', 'helm', 'kubectl'],
  'k8s': ['kubernetes', 'cluster', 'clusters', 'pod', 'pods', 'deployment', 'deployments', 'helm', 'kubectl'],
  'cluster': ['kubernetes', 'k8s', 'pods', 'node', 'nodes'],
  'clusters': ['kubernetes', 'k8s', 'pods', 'node', 'nodes'],
  'pod': ['kubernetes', 'k8s', 'cluster', 'container', 'containers'],
  'pods': ['kubernetes', 'k8s', 'cluster', 'container', 'containers'],
  'docker': ['container', 'containers', 'image', 'images', 'dockerfile'],
  'container': ['docker', 'containers', 'pod', 'pods'],
  'containers': ['docker', 'container', 'pod', 'pods'],
  'terraform': ['iac', 'infrastructure', 'tf', 'ansible', 'pulumi'],
  'iac': ['terraform', 'infrastructure', 'tf'],
  'monitoring': ['prometheus', 'grafana', 'alerts', 'datadog', 'alertmanager', 'metrics'],
  'prometheus': ['monitoring', 'grafana', 'alerts', 'metrics'],
  'grafana': ['monitoring', 'prometheus', 'dashboard', 'dashboards'],
  'jira': ['ticket', 'tickets', 'issue', 'issues', 'task', 'tasks'],
  'ticket': ['jira', 'tickets', 'issue', 'issues'],
  'tickets': ['jira', 'ticket', 'issue', 'issues'],
  'database': ['db', 'postgres', 'postgresql', 'mongodb', 'mysql', 'redis'],
  'db': ['database', 'postgres', 'postgresql', 'mongodb', 'mysql', 'redis'],
  'wfh': ['remote', 'home', 'work-from-home'],
  'office': ['on-site', 'physical', 'hq']
};

/**
 * Token-overlap fallback score, used when semantic embeddings aren't
 * available (no NVIDIA key, embedding call failed, or memory predates
 * embedding support).
 */
function tokenOverlapScore(queryTokens: string[], memory: any): number {
  const contentTokens = memory.content.toLowerCase().split(/\W+/).filter((t: string) => t.length > 2);
  let matchCount = 0;

  queryTokens.forEach(qToken => {
    const synonyms = SRE_SYNONYMS[qToken] || [];
    const tokensToMatch = [qToken, ...synonyms];

    let foundMatch = false;
    for (const token of tokensToMatch) {
      if (contentTokens.includes(token)) {
        matchCount += 1.0;
        foundMatch = true;
        break;
      }
    }

    if (!foundMatch) {
      const hasPartial = contentTokens.some((cToken: string) =>
        tokensToMatch.some(t => cToken.includes(t) || t.includes(cToken))
      );
      if (hasPartial) {
        matchCount += 0.4;
      }
    }
  });

  return matchCount / (Math.sqrt(queryTokens.length) * Math.sqrt(contentTokens.length || 1));
}

/**
 * Searches and ranks memories relevant to a user's text query or daily context.
 * Prefers semantic vector similarity (NVIDIA NIM embeddings) when a query
 * embedding and memory embeddings are available, falling back to token-overlap
 * matching otherwise. Importance and recency always factor into the final score.
 */
export const getRelevantMemories = async (
  userId: string,
  query: string,
  limit: number = 5
): Promise<any[]> => {
  try {
    const now = new Date();
    // Fetch active, non-rejected, and non-expired memories
    const memories = await AgentMemory.find({
      userId,
      feedback: { $ne: 'rejected' },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: now } }
      ]
    });

    if (memories.length === 0) {
      return [];
    }

    // Default to sorting by importance and recency if query is empty
    if (!query || !query.trim()) {
      const sorted = [...memories].sort((a, b) => {
        const aImportance = a.importance || 5;
        const bImportance = b.importance || 5;
        if (bImportance !== aImportance) return bImportance - aImportance;
        return new Date(b.lastAccessedAt || b.updatedAt).getTime() - new Date(a.lastAccessedAt || a.updatedAt).getTime();
      });
      const topMemories = sorted.slice(0, limit);
      await updateAccessStats(topMemories);
      return topMemories;
    }

    const queryTokens = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    if (queryTokens.length === 0) {
      const topMemories = memories.slice(0, limit);
      await updateAccessStats(topMemories);
      return topMemories;
    }

    // Try semantic search first; falls back to null if no NVIDIA key or the call fails
    const queryEmbedding = await embedText(query, 'query');

    const scoredMemories = memories.map(memory => {
      const memEmbedding = (memory as any).embedding as number[] | undefined;
      let baseScore: number;

      if (queryEmbedding && memEmbedding && memEmbedding.length > 0) {
        // Cosine similarity is in [-1, 1]; treat unrelated/negative as 0 signal.
        baseScore = Math.max(0, cosineSimilarity(queryEmbedding, memEmbedding));
      } else {
        baseScore = tokenOverlapScore(queryTokens, memory);
      }

      // Importance factor (default to 5, range 1-10 mapped to multiplier 0.2 - 2.0)
      const importanceFactor = (memory.importance || 5) / 5;

      // Recency boost
      const lastAccess = new Date(memory.lastAccessedAt || memory.updatedAt || now);
      const daysSinceAccess = Math.max(0, (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60 * 24));
      const recencyBoost = 1.0 + (0.3 / (daysSinceAccess + 1));

      const finalScore = baseScore * importanceFactor * recencyBoost;

      return { memory, score: finalScore };
    });

    const topScored = scoredMemories
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.memory);

    // Asynchronously update access stats in the database
    await updateAccessStats(topScored);

    return topScored;
  } catch (error) {
    console.error('Error matching semantic memories:', error);
    // Silent fallback
    const fallback = await AgentMemory.find({ userId, feedback: { $ne: 'rejected' } })
      .sort({ updatedAt: -1 })
      .limit(limit);
    return fallback;
  }
};

const PATTERN_CATEGORIES = [
  'Suggestion Feedback Pattern',
  'Memory Feedback Pattern',
  'Estimation Bias',
  'Weekly Pattern',
  'Habit Correlation'
];

/**
 * Fetches high-importance meta-pattern memories (mined from accept/reject
 * history) unconditionally, regardless of topical similarity to the current
 * query. These describe the agent's own behavior ("user rejects break_down
 * suggestions") rather than task content, so they would otherwise be starved
 * out by a near-zero similarity score against unrelated task titles.
 */
export const getPatternMemories = async (userId: string, limit: number = 5): Promise<any[]> => {
  try {
    const now = new Date();
    const memories = await AgentMemory.find({
      userId,
      category: { $in: PATTERN_CATEGORIES },
      feedback: { $ne: 'rejected' },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: now } }
      ]
    })
      .sort({ importance: -1, updatedAt: -1 })
      .limit(limit);
    return memories;
  } catch (err) {
    console.error('Failed to fetch pattern memories:', err);
    return [];
  }
};

/**
 * Checks whether a candidate memory is a near-duplicate of one that already
 * exists, BEFORE writing it. This is the write-time guard that stops nightly
 * reflections and hourly nudges from re-inserting the same insight over and
 * over. Uses embedding cosine similarity when available; falls back to
 * token overlap when embeddings are missing (no NIM key, older memories).
 */
export const findSimilarMemory = async (
  userId: string,
  content: string,
  options: { embeddingThreshold?: number; tokenThreshold?: number } = {}
): Promise<any | null> => {
  const embeddingThreshold = options.embeddingThreshold ?? 0.86;
  const tokenThreshold = options.tokenThreshold ?? 0.5;

  try {
    const now = new Date();
    const memories = await AgentMemory.find({
      userId,
      feedback: { $ne: 'rejected' },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: now } }
      ]
    });
    if (memories.length === 0) return null;

    const candidateEmbedding = await embedText(content, 'query');
    const candidateTokens = content.toLowerCase().split(/\W+/).filter(t => t.length > 2);

    for (const memory of memories) {
      const memEmbedding = (memory as any).embedding as number[] | undefined;
      if (candidateEmbedding && memEmbedding && memEmbedding.length > 0) {
        if (cosineSimilarity(candidateEmbedding, memEmbedding) >= embeddingThreshold) return memory;
      } else if (candidateTokens.length > 0) {
        if (tokenOverlapScore(candidateTokens, memory) >= tokenThreshold) return memory;
      }
    }
    return null;
  } catch (err) {
    console.error('Failed to check for similar memory:', err);
    // On failure, err on the side of allowing the write rather than dropping data
    return null;
  }
};

/**
 * Fetches memories the user explicitly authored (manual rules from the
 * dashboard, facts saved via chat's remember_fact). These are direct
 * instructions, so they are injected into every agent context unconditionally
 * — an explicit "never schedule deep work after 9pm" must reach the agent
 * even when no task title is topically similar to it.
 */
export const getUserRules = async (userId: string, limit: number = 10): Promise<any[]> => {
  try {
    const now = new Date();
    return await AgentMemory.find({
      userId,
      source: 'user',
      feedback: 'accepted',
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: now } }
      ]
    })
      .sort({ importance: -1, updatedAt: -1 })
      .limit(limit);
  } catch (err) {
    console.error('Failed to fetch user rules:', err);
    return [];
  }
};

// Helper function to update access details
async function updateAccessStats(memories: any[]) {
  try {
    if (memories.length === 0) return;
    const now = new Date();
    const ids = memories.map(m => m._id);
    await AgentMemory.updateMany(
      { _id: { $in: ids } },
      {
        $inc: { accessCount: 1 },
        $set: { lastAccessedAt: now }
      }
    );
  } catch (err) {
    console.error('Failed to update memory access stats:', err);
  }
}
