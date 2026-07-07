import { AgentMemory } from '../models/Schemas';

/**
 * Searches and ranks memories relevant to a user's text query or daily context
 * using token-overlap based cosine similarity matching.
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

    const scoredMemories = memories.map(memory => {
      const contentTokens = memory.content.toLowerCase().split(/\W+/).filter(t => t.length > 2);
      let matchCount = 0;

      queryTokens.forEach(qToken => {
        if (contentTokens.includes(qToken)) {
          matchCount += 1.0;
        } else {
          const hasPartial = contentTokens.some(cToken => cToken.includes(qToken) || qToken.includes(cToken));
          if (hasPartial) {
            matchCount += 0.4;
          }
        }
      });

      // 1. Base overlap score
      const baseScore = matchCount / (Math.sqrt(queryTokens.length) * Math.sqrt(contentTokens.length || 1));

      // 2. Importance factor (default to 5, range 1-10 mapped to multiplier 0.2 - 2.0)
      const importanceFactor = (memory.importance || 5) / 5;

      // 3. Recency boost
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
