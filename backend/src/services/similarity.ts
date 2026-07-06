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
    const memories = await AgentMemory.find({ userId, feedback: { $ne: 'rejected' } });
    if (!query || memories.length === 0) {
      return memories.slice(0, limit);
    }

    const queryTokens = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    if (queryTokens.length === 0) {
      return memories.slice(0, limit);
    }

    const scoredMemories = memories.map(memory => {
      const contentTokens = memory.content.toLowerCase().split(/\W+/).filter(t => t.length > 2);
      let matchCount = 0;

      queryTokens.forEach(qToken => {
        // Direct term frequency matching
        if (contentTokens.includes(qToken)) {
          matchCount += 1.0;
        } else {
          // Substring/prefix partial matching
          const hasPartial = contentTokens.some(cToken => cToken.includes(qToken) || qToken.includes(cToken));
          if (hasPartial) {
            matchCount += 0.4;
          }
        }
      });

      // Cosine-like normalization score
      const score = matchCount / (Math.sqrt(queryTokens.length) * Math.sqrt(contentTokens.length || 1));
      return { memory, score };
    });

    // Rank scored memories and filter out low matches if the query is highly targeted
    return scoredMemories
      .sort((a, b) => b.score - a.score)
      .map(item => item.memory)
      .slice(0, limit);
  } catch (error) {
    console.error('Error matching semantic memories:', error);
    // Silent fallback: return recent memories
    const fallback = await AgentMemory.find({ userId, feedback: { $ne: 'rejected' } })
      .sort({ updatedAt: -1 })
      .limit(limit);
    return fallback;
  }
};
