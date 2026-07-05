import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';
import { User, Task, Log, AgentMemory, AgentRun, ITask, ILog, IAgentMemory } from '../models/Schemas';
import { queryNvidiaNim } from '../config/nvidia';

// Instantiate Anthropic Client
const getAnthropicClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return null;
  }
  return new Anthropic({ apiKey });
};

// ----------------------------------------------------
// 1. Observe: Gather context snapshot
// ----------------------------------------------------
export const gatherUserContext = async (userId: string, targetDateStr?: string) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const timezone = user.timezone || 'UTC';
  
  // Define target date boundaries
  const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Fetch tasks due today or overdue tasks
  const activeTasks = await Task.find({
    userId,
    $or: [
      { dueDate: { $gte: startOfDay, $lte: endOfDay } },
      { dueDate: { $lt: startOfDay }, status: { $in: ['todo', 'in-progress'] } }
    ]
  }).sort({ order: 1 });

  // Fetch logs for today
  const dailyLogs = await Log.find({
    userId,
    timestamp: { $gte: startOfDay, $lte: endOfDay }
  }).sort({ timestamp: -1 });

  // Fetch active insights from memory
  const memories = await AgentMemory.find({
    userId,
    feedback: { $ne: 'rejected' }
  }).sort({ updatedAt: -1 }).limit(10);

  // Fetch past completion stats (last 7 days completed tasks vs all tasks)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentTasks = await Task.find({
    userId,
    updatedAt: { $gte: sevenDaysAgo }
  });

  const completedCount = recentTasks.filter(t => t.status === 'done').length;
  const totalCount = recentTasks.length;
  const completionRate = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return {
    user: {
      email: user.email,
      timezone: user.timezone,
      preferences: user.preferences
    },
    currentTime: new Date().toISOString(),
    activeTasks,
    dailyLogs,
    memories,
    stats: {
      completionRate: Math.round(completionRate),
      completedCount,
      totalCount
    }
  };
};

// ----------------------------------------------------
// 2. Plan & Act: Execute Planning Loop
// ----------------------------------------------------
export const runPlanningLoop = async (
  userId: string,
  trigger: string = 'manual'
): Promise<any> => {
  const context = await gatherUserContext(userId);
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
  const client = getAnthropicClient();

  if (!client && !isNvidiaActive) {
    return runMockPlanning(userId, trigger, context);
  }

  try {
    const prompt = `You are a personalized Productivity Agent. Your job is to analyze the user's daily context and generate a daily plan.
You must analyze constraints, overdue tasks, user preferences, logs, and learned memories, and return a structured analysis.

Context Snapshot:
- Current Time (UTC): ${context.currentTime}
- User Timezone/Working Hours: ${context.user.timezone} (${context.user.preferences.workingHoursStart} to ${context.user.preferences.workingHoursEnd})
- Peak Energy: ${context.user.preferences.peakEnergyTime}
- Active Tasks (Today + Overdue):
${JSON.stringify(context.activeTasks.map(t => ({ id: t._id, title: t.title, priority: t.priority, status: t.status, dueDate: t.dueDate, estimatedTime: t.estimatedTime, actualTime: t.actualTime, order: t.order, created: t.createdAt })), null, 2)}
- Daily Logs (what they worked on today):
${JSON.stringify(context.dailyLogs.map(l => ({ title: l.title, duration: l.duration, timestamp: l.timestamp })), null, 2)}
- Agent Memory (learned user patterns):
${JSON.stringify(context.memories.map(m => m.content), null, 2)}
- 7-Day Completion Rate: ${context.stats.completionRate}%

Your task:
1. Provide a short, constructive rationale explaining your reasoning (e.g. spotting overdue items, aligning high priority items to peak energy hours).
2. Generate concrete recommendations/suggestions for the user. Action types allowed:
   - "reorder": suggest sorting task IDs in a specific optimal order. Provide details: { orderedTaskIds: string[] }
   - "suggest_time_block": suggest blocking time for a task. Provide details: { taskId: string, startTime: string, duration: number }
   - "break_down": suggest dividing a complex/vague task into subtasks. Provide details: { taskId: string, subtasks: string[] }
   - "nudge": suggest addressing a task pushed back or delayed. Provide details: { taskId: string, message: string }
   - "create_task": suggest a new task based on logs or memory (e.g., "Reflect on coding session"). Provide details: { title: string, estimatedTime: number }

Return ONLY a JSON object matching this schema, no other text or explanation:
{
  "rationale": "String analyzing state",
  "suggestions": [
    {
      "id": "unique-suggestion-slug-1",
      "taskId": "mongoose-task-id-if-applies-else-omit",
      "actionType": "reorder | suggest_time_block | break_down | nudge | create_task",
      "description": "Clear display instruction for the user",
      "details": { ... }
    }
  ]
}`;

    let responseText = '';

    if (isNvidiaActive) {
      responseText = await queryNvidiaNim([
        { role: 'user', content: prompt }
      ], 'meta/llama-3.1-405b-instruct', 0.2, 1500);
    } else if (client) {
      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      });
      responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    }

    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.slice(7);
    }
    if (cleanJson.endsWith('```')) {
      cleanJson = cleanJson.slice(0, -3);
    }

    const planOutput = JSON.parse(cleanJson.trim());

    // Save this agent run
    const agentRun = new AgentRun({
      userId,
      trigger,
      contextSnapshot: context,
      planOutput,
      actionsTaken: planOutput.suggestions.map((s: any) => ({
        suggestionId: s.id,
        actionType: s.actionType,
        status: 'pending'
      }))
    });

    await agentRun.save();
    return agentRun;
  } catch (error) {
    console.error('Claude API failed in Planning Loop. Falling back.', error);
    return runMockPlanning(userId, trigger, context);
  }
};

// Fallback Mock Planning if offline
const runMockPlanning = async (userId: string, trigger: string, context: any) => {
  const suggestions = [];
  const activeTasks = context.activeTasks as ITask[];

  // 1. Identify high priority tasks that are pending
  const highPriorityTodo = activeTasks.filter(t => t.priority === 'high' && t.status === 'todo');
  if (highPriorityTodo.length > 0) {
    const firstHigh = highPriorityTodo[0];
    suggestions.push({
      id: `suggest-focus-${firstHigh._id}`,
      taskId: firstHigh._id.toString(),
      actionType: 'suggest_time_block' as const,
      description: `Schedule high-priority task "${firstHigh.title}" during peak morning hours.`,
      details: {
        taskId: firstHigh._id.toString(),
        startTime: '09:30',
        duration: firstHigh.estimatedTime || 45
      }
    });
  }

  // 2. Identify vague/long tasks that could be broken down
  const longTasks = activeTasks.filter(t => t.estimatedTime >= 120 && t.status === 'todo');
  if (longTasks.length > 0) {
    const firstLong = longTasks[0];
    suggestions.push({
      id: `suggest-break-${firstLong._id}`,
      taskId: firstLong._id.toString(),
      actionType: 'break_down' as const,
      description: `Task "${firstLong.title}" is estimated at ${firstLong.estimatedTime}m. Consider breaking it down.`,
      details: {
        taskId: firstLong._id.toString(),
        subtasks: [
          'Phase 1: Initial research & setup (45m)',
          'Phase 2: Core execution (60m)',
          'Phase 3: Review and final touch (15m)'
        ]
      }
    });
  }

  // 3. Propose a reorder suggestion putting High priority first
  const sortedIds = [...activeTasks]
    .sort((a, b) => {
      const priorities = { high: 3, medium: 2, low: 1 };
      return priorities[b.priority] - priorities[a.priority];
    })
    .map(t => t._id.toString());

  suggestions.push({
    id: 'suggest-reorder-default',
    actionType: 'reorder' as const,
    description: 'Prioritize High priority tasks at the top of your list today.',
    details: {
      orderedTaskIds: sortedIds
    }
  });

  const planOutput = {
    rationale: 'Generated rule-based local suggestions based on task priority weights and estimated duration thresholds.',
    suggestions
  };

  const agentRun = new AgentRun({
    userId,
    trigger,
    contextSnapshot: context,
    planOutput,
    actionsTaken: suggestions.map(s => ({
      suggestionId: s.id,
      actionType: s.actionType,
      status: 'pending'
    }))
  });

  await agentRun.save();
  return agentRun;
};

// ----------------------------------------------------
// 3. Reflect: Analyze performance & create memory insights
// ----------------------------------------------------
export interface ReflectionResult {
  reflectionSummary: string;
  insights: Array<{
    type: 'pattern' | 'preference' | 'adjustment' | 'general';
    category: string;
    content: string;
  }>;
}

export const runReflectionLoop = async (
  userId: string,
  targetDateStr?: string
): Promise<any> => {
  const context = await gatherUserContext(userId, targetDateStr);
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
  const client = getAnthropicClient();

  if (!client && !isNvidiaActive) {
    return runMockReflection(userId, context);
  }

  try {
    const prompt = `You are a personalized Productivity Agent. Run an end-of-day reflection on the user's logged logs vs planned tasks.
Analyze task completion rates, durations (estimates vs actual time), and highlight recurring trends.

Today's Context:
- Active Tasks: ${JSON.stringify(context.activeTasks.map((t: any) => ({ title: t.title, status: t.status, estimated: t.estimatedTime, actual: t.actualTime, priority: t.priority })), null, 2)}
- Work Logs: ${JSON.stringify(context.dailyLogs.map((l: any) => ({ title: l.title, duration: l.duration, notes: l.notes })), null, 2)}
- Existing Memories: ${JSON.stringify(context.memories.map((m: any) => m.content), null, 2)}

Provide:
1. A summary paragraph reflecting on the day (achievements, issues, streaks).
2. Actionable, long-term insights (memories) to store. Keep them highly specific: e.g., "You consistently underestimate writing tasks by ~40%", "You struggle to complete High priority tasks scheduled after 3 PM". Do not repeat existing memories.

Return ONLY a JSON object matching this schema, no other text:
{
  "reflectionSummary": "String summary of the day",
  "insights": [
    {
      "type": "pattern | preference | adjustment | general",
      "category": "estimation | scheduling | productivity | health",
      "content": "Specific insight description"
    }
  ]
}`;

    let responseText = '';

    if (isNvidiaActive) {
      responseText = await queryNvidiaNim([
        { role: 'user', content: prompt }
      ], 'meta/llama-3.1-405b-instruct', 0.2, 1000);
    } else if (client) {
      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      });
      responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    }

    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.slice(7);
    }
    if (cleanJson.endsWith('```')) {
      cleanJson = cleanJson.slice(0, -3);
    }

    const reflection: ReflectionResult = JSON.parse(cleanJson.trim());

    // Save reflection insights into AgentMemory
    const savedMemories: IAgentMemory[] = [];
    for (const insight of reflection.insights) {
      const memory = new AgentMemory({
        userId,
        type: insight.type,
        category: insight.category,
        content: insight.content,
        feedback: 'none' // User has to accept/dismiss in UI
      });
      await memory.save();
      savedMemories.push(memory);
    }

    return {
      summary: reflection.reflectionSummary,
      insights: savedMemories
    };
  } catch (error) {
    console.error('Claude API failed in Reflection Loop. Falling back.', error);
    return runMockReflection(userId, context);
  }
};

// Fallback Mock Reflection if offline
const runMockReflection = async (userId: string, context: any) => {
  const activeTasks = context.activeTasks as ITask[];
  const dailyLogs = context.dailyLogs as ILog[];

  const completed = activeTasks.filter(t => t.status === 'done');
  const pending = activeTasks.filter(t => t.status === 'todo' || t.status === 'in-progress');
  
  const totalActualTime = dailyLogs.reduce((acc, log) => acc + log.duration, 0);
  const totalEstTime = completed.reduce((acc, task) => acc + task.estimatedTime, 0);

  const summary = `Completed ${completed.length} of ${activeTasks.length} tasks today. Total logged focus time was ${totalActualTime} minutes.`;
  
  const insightsToSave = [];
  
  // Pattern check: tasks exceeding estimates
  if (totalActualTime > totalEstTime && totalEstTime > 0) {
    const pct = Math.round(((totalActualTime - totalEstTime) / totalEstTime) * 100);
    if (pct > 20) {
      insightsToSave.push({
        type: 'pattern' as const,
        category: 'estimation',
        content: `Your logged focus sessions exceeded estimates by roughly ${pct}% today. Focus on buffer scheduling.`
      });
    }
  }

  // Focus pattern: skipped items
  const skipped = activeTasks.filter(t => t.status === 'skipped');
  if (skipped.length > 0) {
    insightsToSave.push({
      type: 'adjustment' as const,
      category: 'productivity',
      content: `You skipped ${skipped.length} scheduled task(s) today. Assess if your daily planning load is too ambitious.`
    });
  }

  const savedMemories: IAgentMemory[] = [];
  for (const insight of insightsToSave) {
    const memory = new AgentMemory({
      userId,
      type: insight.type,
      category: insight.category,
      content: insight.content,
      feedback: 'none'
    });
    await memory.save();
    savedMemories.push(memory);
  }

  return {
    summary,
    insights: savedMemories
  };
};
