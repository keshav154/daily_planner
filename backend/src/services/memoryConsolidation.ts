import { AgentMemory, Task, IUser } from '../models/Schemas';
import Habit from '../models/Habit';
import { Goal } from '../models/Goal';
import { queryNvidiaNim } from '../config/nvidia';
import { mineSuggestionFeedback, mineMemoryFeedback } from './feedbackMining';
import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';

/**
 * Safely parse JSON from AI response – strips markdown code fences, trailing commas, and unescaped newlines.
 */
function parseAiJson<T>(raw: string): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  
  try {
    return JSON.parse(stripped) as T;
  } catch (err) {
    let cleaned = stripped;

    // 1. Remove trailing commas before closing braces/brackets
    cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');

    // 2. Escape newlines inside strings
    cleaned = cleaned.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
      return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    });

    // 3. Extract matching object or array if extra text is present
    try {
      return JSON.parse(cleaned) as T;
    } catch (secondErr) {
      const arrMatch = cleaned.match(/\[[\s\S]*\]/);
      const objMatch = cleaned.match(/\{[\s\S]*\}/);
      const candidate = arrMatch?.[0] ?? objMatch?.[0];
      if (candidate) {
        return JSON.parse(candidate) as T;
      }
      throw secondErr;
    }
  }
}

// Query LLM helper for consolidation
async function askLLMForConsolidation(memories: any[]): Promise<any[] | null> {
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const isAnthropicActive = anthropicKey && anthropicKey !== 'your_anthropic_api_key_here';

  if (!isNvidiaActive && !isAnthropicActive) return null;

  const memoryList = memories.map(m => ({ id: m._id.toString(), content: m.content, category: m.category }));
  
  const prompt = `You are a cognitive memory consolidating system. The user has several fragmented memories and observations.
Your job is to identify duplicate memories, merge highly similar items, and synthesize them into high-level, clear insights.

Raw Memories:
${JSON.stringify(memoryList, null, 2)}

Instructions:
1. Identify overlaps. For example, if there are two memories saying "You underestimate design tasks" and "Design tasks take you 30% longer than planned", merge them.
2. Return the consolidated memories as a JSON array under the "consolidated" key.
3. Each item in the array MUST list the IDs of the original memories that were merged into it (mergedIds), so we can archive the duplicates.
4. For each consolidated memory, assign an importance rating between 1 and 10.

Return ONLY a valid JSON object:
{
  "consolidated": [
    {
      "content": "Consolidated memory string...",
      "category": "estimation|productivity|scheduling",
      "importance": 7,
      "mergedIds": ["id_1", "id_2"]
    }
  ]
}`;

  try {
    let responseText = '';
    if (isNvidiaActive) {
      // jsonMode (NIM's response_format: json_object) only guarantees a valid
      // top-level *object*, not a bare array — hence wrapping the array in a
      // "consolidated" key above instead of asking for `[...]` directly.
      responseText = await queryNvidiaNim(
        [{ role: 'user', content: prompt }],
        process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct',
        0.3,
        1000,
        true
      );
    } else if (isAnthropicActive) {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      });
      responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    }

    const parsed = parseAiJson<any>(responseText);
    const consolidated = Array.isArray(parsed) ? parsed : parsed?.consolidated;
    if (Array.isArray(consolidated)) {
      return consolidated;
    }
  } catch (err) {
    console.error('[Consolidation] AI consolidation call failed:', err);
  }
  return null;
}

/**
 * Main function to consolidate, decay, and auto-link user memories.
 */
export const consolidateMemories = async (userId: string) => {
  console.log(`[Memory Consolidation] Running consolidation for user ${userId}...`);
  try {
    const now = new Date();

    // 0. PURGE EXPIRED TRANSIENTS
    // Nudges carry an expiresAt and are only meaningful for a day — once
    // expired they are noise in the review queue and in retrieval scans.
    const purgeResult = await AgentMemory.deleteMany({
      userId,
      expiresAt: { $lte: now }
    });
    if (purgeResult.deletedCount > 0) {
      console.log(`[Memory Consolidation] Purged ${purgeResult.deletedCount} expired transient memories.`);
    }

    // 1. IMPORTANCE DECAY
    // Reduce importance of memories not accessed/updated in 14 days
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const decayResult = await AgentMemory.updateMany(
      {
        userId,
        lastAccessedAt: { $lt: fourteenDaysAgo },
        importance: { $gt: 1 }
      },
      { $inc: { importance: -1 } }
    );
    console.log(`[Memory Consolidation] Decayed importance on ${decayResult.modifiedCount} old memories.`);

    // 1a. SELF-PRUNING: a memory that has decayed to the floor (importance 1),
    // was never engaged with (accessCount 0), and hasn't been touched in 30+
    // days has proven itself noise — archive it (feedback:'rejected' → hidden
    // from the user-facing list but still auditable, never hard-deleted).
    // Protected: user-authored facts (source:'user') and behavioral pattern
    // categories are never auto-pruned — those are explicit or structural.
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const pruneResult = await AgentMemory.updateMany(
      {
        userId,
        source: { $ne: 'user' },
        category: { $nin: ['Suggestion Feedback Pattern', 'Memory Feedback Pattern', 'Estimation Bias', 'Weekly Pattern', 'Habit Correlation'] },
        importance: { $lte: 1 },
        accessCount: { $lte: 0 },
        lastAccessedAt: { $lt: thirtyDaysAgo },
        feedback: { $ne: 'rejected' }
      },
      { $set: { feedback: 'rejected' } }
    );
    if (pruneResult.modifiedCount > 0) {
      console.log(`[Memory Consolidation] Self-pruned ${pruneResult.modifiedCount} unused low-value memories.`);
    }

    // 1b. FEEDBACK MINING - learn which suggestion/memory categories the user actually wants
    const minedSuggestionPatterns = await mineSuggestionFeedback(userId);
    const minedMemoryPatterns = await mineMemoryFeedback(userId);
    if (minedSuggestionPatterns.length > 0 || minedMemoryPatterns.length > 0) {
      console.log(`[Memory Consolidation] Mined ${minedSuggestionPatterns.length + minedMemoryPatterns.length} behavioral pattern memories from feedback history.`);
    }

    // Fetch all active user memories that are approved or pending feedback
    const activeMemories = await AgentMemory.find({ 
      userId, 
      feedback: { $ne: 'rejected' }
    });

    if (activeMemories.length === 0) return;

    // 2. AUTO-LINKING TO TASKS, HABITS, GOALS
    const activeTasks = await Task.find({ userId, status: { $ne: 'done' } });
    const habits = await Habit.find({ userId, isActive: true });
    const goals = await Goal.find({ userId, status: 'active' });

    for (const memory of activeMemories) {
      const contentLower = memory.content.toLowerCase();
      const newLinks: any[] = [];

      // Link to Tasks
      for (const task of activeTasks) {
        const titleWords = task.title.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        if (titleWords.some(word => contentLower.includes(word))) {
          newLinks.push({
            entityType: 'task',
            entityId: task._id,
            relationship: 'applies_to'
          });
        }
      }

      // Link to Habits
      for (const habit of habits) {
        const titleWords = habit.title.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        if (titleWords.some(word => contentLower.includes(word))) {
          newLinks.push({
            entityType: 'habit',
            entityId: habit._id,
            relationship: 'applies_to'
          });
        }
      }

      // Link to Goals
      for (const goal of goals) {
        const titleWords = goal.title.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        if (titleWords.some(word => contentLower.includes(word))) {
          newLinks.push({
            entityType: 'goal',
            entityId: goal._id,
            relationship: 'applies_to'
          });
        }
      }

      if (newLinks.length > 0) {
        // Merge with existing, filtering out duplicates
        const existingIds = memory.linkedEntities.map(l => l.entityId.toString());
        const filteredNewLinks = newLinks.filter(l => !existingIds.includes(l.entityId.toString()));
        
        if (filteredNewLinks.length > 0) {
          memory.linkedEntities.push(...filteredNewLinks);
          await memory.save();
        }
      }
    }

    // 3. AI DUP CONSOLIDATION & PATTERN SYNTHESIS
    // Transient nudges (anything with expiresAt) are excluded: merging a
    // "habit at risk tonight" warning into a permanent accepted memory turns
    // a momentary state into a forever-fact. Only durable memories qualify.
    const durableMemories = activeMemories.filter(m => !m.expiresAt);
    if (durableMemories.length >= 3) {
      const consolidated = await askLLMForConsolidation(durableMemories);
      if (consolidated && consolidated.length > 0) {
        for (const item of consolidated) {
          // Check if it consolidated any items
          if (item.mergedIds && item.mergedIds.length > 0) {
            // Create the new consolidated memory
            const consolidatedMemory = new AgentMemory({
              userId,
              type: 'pattern',
              content: item.content,
              category: item.category || 'general',
              feedback: 'accepted', // Auto-accept synthesized insights
              source: 'consolidation',
              importance: item.importance || 6,
              linkedEntities: []
            });

            await consolidatedMemory.save();

            // Archive/Delete the merged items
            const objectIds = item.mergedIds.map((id: string) => {
              try { return new mongoose.Types.ObjectId(id); } catch { return null; }
            }).filter(Boolean);

            await AgentMemory.deleteMany({ _id: { $in: objectIds }, userId });
          }
        }
        console.log(`[Memory Consolidation] Finished AI consolidation process.`);
      }
    }
  } catch (err) {
    console.error('[Memory Consolidation] Process failed:', err);
  }
};
