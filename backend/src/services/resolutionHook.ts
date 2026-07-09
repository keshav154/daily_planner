import { AgentMemory } from '../models/Schemas';

export const handleTaskResolution = async (
  userId: string,
  taskTitle: string,
  category: string,
  resolution: string
) => {
  try {
    if (!resolution || !resolution.trim()) return;

    console.log(`[Resolution Hook] Ingesting task resolution for "${taskTitle}"...`);

    // Remove duplicates
    await AgentMemory.deleteMany({
      userId,
      category: 'Resolution Reference',
      content: new RegExp(`^Resolution for "${taskTitle}"`, 'i')
    });

    const memoryContent = `Resolution for "${taskTitle}" (${category || 'Work'}): ${resolution}`;

    const resolutionMemory = new AgentMemory({
      userId,
      type: 'pattern',
      category: 'Resolution Reference',
      content: memoryContent,
      feedback: 'accepted',
      importance: 7,
      source: 'autonomous',
      lastAccessedAt: new Date()
    });

    await resolutionMemory.save();
    console.log(`[Resolution Hook] Saved resolution reference memory for "${taskTitle}"`);
  } catch (error) {
    console.error('[Resolution Hook] Failed to execute hook:', error);
  }
};
