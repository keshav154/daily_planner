import { AgentMemory, Task, IUser } from '../models/Schemas';
import Habit from '../models/Habit';
import { Goal } from '../models/Goal';
import { queryNvidiaNim } from '../config/nvidia';
import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';

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
2. Return a JSON array of the consolidated memories.
3. Each item in the array MUST list the IDs of the original memories that were merged into it (mergedIds), so we can archive the duplicates.
4. For each consolidated memory, assign an importance rating between 1 and 10.

Return ONLY a valid JSON array:
[
  {
    "content": "Consolidated memory string...",
    "category": "estimation|productivity|scheduling",
    "importance": 7,
    "mergedIds": ["id_1", "id_2"]
  }
]`;

  try {
    let responseText = '';
    if (isNvidiaActive) {
      responseText = await queryNvidiaNim(
        [{ role: 'user', content: prompt }],
        process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
        0.3,
        1000
      );
    } else if (isAnthropicActive) {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      });
      responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    }

    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```json')) cleanJson = cleanJson.slice(7);
    if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3);

    const parsed = JSON.parse(cleanJson.trim());
    if (Array.isArray(parsed)) {
      return parsed;
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
    // Only run if we have 3 or more memories
    if (activeMemories.length >= 3) {
      const consolidated = await askLLMForConsolidation(activeMemories);
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
