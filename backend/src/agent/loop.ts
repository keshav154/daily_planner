import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';
import { User, Task, Log, AgentMemory, AgentRun, ITask, ILog, IAgentMemory } from '../models/Schemas';
import { queryNvidiaNim } from '../config/nvidia';
import { getRelevantMemories, getPatternMemories, getUserRules, findSimilarMemory } from '../services/similarity';
import { computeTaskHistoryStats, formatStatsDigest } from '../services/taskHistory';
import { filterDuplicateSuggestions } from '../services/suggestionDedupe';

// Instantiate Anthropic Client
const getAnthropicClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return null;
  }
  return new Anthropic({ apiKey });
};

// Helper to query LLM with fallback
const askLLM = async (
  prompt: string,
  systemPrompt: string,
  isNvidiaActive: boolean,
  client: Anthropic | null
): Promise<string> => {
  if (isNvidiaActive) {
    return await queryNvidiaNim([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ], process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct', 0.3, 1500);
  } else if (client) {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    });
    return response.content[0].type === 'text' ? response.content[0].text : '';
  }
  throw new Error('No LLM client active');
};

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

  // Fetch semantically matched memories based on current tasks titles, plus
  // high-importance behavioral patterns mined from accept/reject history
  // (these describe the agent's own behavior, not task content, so they are
  // fetched unconditionally rather than by topical similarity).
  const tasksQuery = activeTasks.map(t => t.title).join(' ');
  const relevantMemories = await getRelevantMemories(userId, tasksQuery, 10);
  const patternMemories = await getPatternMemories(userId, 5);
  // User-authored rules and facts are direct instructions — always included,
  // never subject to topical-similarity filtering.
  const userRules = await getUserRules(userId, 10);
  const memoryKey = (m: any) => (m._id ? m._id.toString() : m.content);
  const seenMemoryIds = new Set(relevantMemories.map(memoryKey));
  const memories = [
    ...relevantMemories,
    ...[...patternMemories, ...userRules].filter((m: any) => {
      const key = memoryKey(m);
      if (seenMemoryIds.has(key)) return false;
      seenMemoryIds.add(key);
      return true;
    })
  ];

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

  const adjustedPreferences = { 
    ...user.preferences,
    workingHoursStart: user.preferences.workMode === 'office' ? '10:30' : '10:00',
    workingHoursEnd: user.preferences.workMode === 'office' ? '16:30' : '18:00'
  };

  return {
    user: {
      email: user.email,
      timezone: user.timezone,
      preferences: adjustedPreferences as any
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
// 2. Plan & Act: Execute Planning Loop (Chain-of-Thought Upgrade)
// ----------------------------------------------------
export const runPlanningLoop = async (
  userId: string,
  trigger: string = 'manual'
): Promise<any> => {
  const context = await gatherUserContext(userId);
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const isNvidiaActive = !!(nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here');
  const client = getAnthropicClient();

  if (!client && !isNvidiaActive) {
    return runMockPlanning(userId, trigger, context);
  }

  try {
    const systemPrompt = 'You are a deep-thinking, highly analytical Productivity Co-pilot Agent.';

    const draftPrompt = `You are a personalized Productivity Agent. Your job is to analyze the user's daily context and draft a daily plan.
Analyze constraints, overdue tasks, user preferences, logs, and learned memories:

Context Snapshot:
- Current Time (UTC): ${context.currentTime}
- User Timezone/Working Hours: ${context.user.timezone} (${context.user.preferences.workingHoursStart} to ${context.user.preferences.workingHoursEnd})
- Peak Energy: ${context.user.preferences.peakEnergyTime}
- Active Tasks (Today + Overdue):
${JSON.stringify(context.activeTasks.map(t => ({ id: t._id, title: t.title, priority: t.priority, status: t.status, estimatedTime: t.estimatedTime, order: t.order })), null, 2)}
- Daily Logs (today):
${JSON.stringify(context.dailyLogs.map(l => ({ title: l.title, duration: l.duration })), null, 2)}
- Learned Memories:
${JSON.stringify(context.memories.map(m => m.content), null, 2)}

Your task:
1. Provide a short, constructive rationale.
2. Generate recommendations/suggestions. Action types allowed:
   - "reorder": { orderedTaskIds: string[] }
   - "suggest_time_block": { taskId: string, startTime: string, duration: number }
   - "break_down": { taskId: string, subtasks: string[] }
   - "nudge": { taskId: string, message: string }
   - "create_task": { title: string, estimatedTime: number }

Format output strictly as JSON:
{
  "rationale": "Draft analysis of state",
  "suggestions": [
    {
      "id": "slug",
      "taskId": "task-id",
      "actionType": "reorder | suggest_time_block | break_down | nudge | create_task",
      "description": "Suggestion instructions",
      "details": { ... }
    }
  ]
}`;

    // STAGE 1: DRAFT
    logToBackgroundLogs('info', `Drafting daily plan for ${context.user.email} (Trigger: ${trigger})`);
    const draftText = await askLLM(draftPrompt, systemPrompt, isNvidiaActive, client);

    // STAGE 2: CRITIQUE / SELF-CORRECTION
    logToBackgroundLogs('info', `Executing self-critique loop stage for ${context.user.email}`);
    const critiquePrompt = `You are a strict daily schedule auditor. Critique this draft daily planner recommendations JSON:
${draftText}

Using:
- User timezone & preferences: ${context.user.preferences.workingHoursStart} to ${context.user.preferences.workingHoursEnd}
- Active Tasks count: ${context.activeTasks.length}
- Target memories: ${JSON.stringify(context.memories.map(m => m.content))}

Review:
1. Overbooking check: Are there too many hours planned?
2. Energy check: Are high-priority items aligned with peak hours?
3. Memory compliance check: Does it contradict past user feedback or memories?

Identify weaknesses or improvements needed. Write a short paragraph summarizing your feedback.`;

    const critiqueText = await askLLM(critiquePrompt, systemPrompt, isNvidiaActive, client);

    // STAGE 3: REFINE
    logToBackgroundLogs('info', `Refining final recommendations based on critique feedback`);
    const refinementPrompt = `Here is your draft planner recommendations:
${draftText}

Here is the audit critique:
${critiqueText}

Refine your planner recommendations to produce the final, optimized plan.
Return ONLY a valid JSON object matching the original schema. No explanations, no markdown except raw JSON:
{
  "rationale": "Refined rationale addressing criticisms and optimizing schedule",
  "suggestions": [
    {
      "id": "unique-slug",
      "taskId": "task-id",
      "actionType": "reorder | suggest_time_block | break_down | nudge | create_task",
      "description": "Clear display instruction",
      "details": { ... }
    }
  ]
}`;

    const refinedText = await askLLM(refinementPrompt, systemPrompt, isNvidiaActive, client);

    const planOutput = parseAiJson<any>(refinedText);
    planOutput.suggestions = await filterDuplicateSuggestions(userId, planOutput.suggestions || []);

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

// Helper for logger debugging
const logToBackgroundLogs = (type: 'info' | 'success' | 'warn' | 'error', msg: string) => {
  try {
    const { backgroundLogs } = require('../services/backgroundPlanner');
    backgroundLogs.push({ timestamp: new Date(), type, message: msg });
  } catch (e) {}
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

  const dedupedSuggestions = await filterDuplicateSuggestions(userId, suggestions);
  const planOutput = {
    rationale: 'Generated rule-based local suggestions based on task priority weights and estimated duration thresholds.',
    suggestions: dedupedSuggestions
  };

  const agentRun = new AgentRun({
    userId,
    trigger,
    contextSnapshot: context,
    planOutput,
    actionsTaken: dedupedSuggestions.map(s => ({
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

async function calculateEstimationBiases(userId: string) {
  try {
    const completedTasks = await Task.find({
      userId,
      status: 'done',
      estimatedTime: { $gt: 0 },
      actualTime: { $gt: 0 }
    })
    .sort({ updatedAt: -1 })
    .limit(15);

    if (completedTasks.length < 3) return;

    const categoryStats: Record<string, { totalActual: number; totalEst: number; count: number }> = {};
    for (const t of completedTasks) {
      const cat = t.category || 'Work';
      if (!categoryStats[cat]) {
        categoryStats[cat] = { totalActual: 0, totalEst: 0, count: 0 };
      }
      categoryStats[cat].totalActual += t.actualTime;
      categoryStats[cat].totalEst += t.estimatedTime;
      categoryStats[cat].count += 1;
    }

    for (const [cat, stats] of Object.entries(categoryStats)) {
      if (stats.count >= 2) {
        const factor = stats.totalActual / stats.totalEst;
        if (factor < 0.85 || factor > 1.15) {
          const roundedFactor = Math.round(factor * 100) / 100;
          
          await AgentMemory.deleteMany({
            userId,
            category: 'Estimation Bias',
            content: new RegExp(`^Estimation Bias for ${cat} tasks`, 'i')
          });

          const biasMemory = new AgentMemory({
            userId,
            type: 'pattern',
            category: 'Estimation Bias',
            content: `Estimation Bias for ${cat} tasks: factor ${roundedFactor} (Based on analysis of ${stats.count} tasks)`,
            feedback: 'accepted',
            importance: 8,
            source: 'reflection'
          });
          await biasMemory.save();
          console.log(`[Estimation Bias Loop] Set factor ${roundedFactor} for ${cat} tasks`);
        }
      }
    }
  } catch (err) {
    console.error('Failed to compute estimation biases:', err);
  }
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
    // Grounding: aggregate the user's full task history so insights come from
    // their actual track record, not from a single day's snapshot.
    const historyStats = await computeTaskHistoryStats(userId, 90);
    const statsDigest = formatStatsDigest(historyStats);

    const jsonSchemaBlock = `Return ONLY a JSON object matching this schema, no other text:
{
  "reflectionSummary": "String summary of the day",
  "insights": [
    {
      "type": "pattern | preference | adjustment | general",
      "category": "estimation | scheduling | productivity | health",
      "content": "Specific insight description citing concrete numbers from the stats"
    }
  ]
}`;

    // STAGE 1: DRAFT — reflect on today, grounded in the long-term stats
    const draftPrompt = `You are a personalized Productivity Agent. Run an end-of-day reflection on the user's logged logs vs planned tasks.
Analyze task completion rates, durations (estimates vs actual time), and highlight recurring trends.

Today's Context:
- Active Tasks: ${JSON.stringify(context.activeTasks.map((t: any) => ({ title: t.title, status: t.status, estimated: t.estimatedTime, actual: t.actualTime, priority: t.priority })), null, 2)}
- Work Logs: ${JSON.stringify(context.dailyLogs.map((l: any) => ({ title: l.title, duration: l.duration, notes: l.notes })), null, 2)}
- Existing Memories: ${JSON.stringify(context.memories.map((m: any) => m.content), null, 2)}

Long-term track record (computed from the user's real task data — treat as ground truth):
${statsDigest}

Provide:
1. A summary paragraph reflecting on the day (achievements, issues, streaks).
2. Actionable, long-term insights (memories) to store. Every insight MUST be supported by the long-term track record above and cite its concrete numbers (e.g. "Your Learning tasks complete at only 40% vs 85% for Work — schedule them earlier in the day"). Do not repeat existing memories. Do not output generic productivity advice that could apply to anyone.

${jsonSchemaBlock}`;

    const draftText = await askLLM(draftPrompt, 'You are a data-grounded productivity analyst.', !!isNvidiaActive, client);

    // STAGE 2: VERIFY — self-check each draft insight against the stats and
    // drop anything the numbers don't support. This is the "self reasoning"
    // pass: the model audits its own claims before they become memories.
    const verifyPrompt = `You are a strict data auditor. Below are draft reflection insights and the ground-truth statistics they must be based on.

Ground-truth statistics:
${statsDigest}

Draft output:
${draftText}

For each insight, verify it is directly supported by the statistics above:
- DROP any insight that is generic advice, speculation, or not backed by a specific number in the stats.
- CORRECT any insight whose numbers don't match the stats.
- KEEP the reflectionSummary (lightly improve wording if needed).

${jsonSchemaBlock}`;

    const verifiedText = await askLLM(verifyPrompt, 'You are a strict data auditor.', !!isNvidiaActive, client);

    let reflection: ReflectionResult;
    try {
      reflection = parseAiJson<ReflectionResult>(verifiedText);
    } catch {
      // If the verification pass returns unparseable output, fall back to the draft
      reflection = parseAiJson<ReflectionResult>(draftText);
    }

    // Save reflection insights into AgentMemory — skipping near-duplicates of
    // insights that already exist. The prompt asks the model not to repeat
    // itself, but models re-derive the same patterns from the same data, so
    // this is enforced in code rather than trusted to the prompt.
    const savedMemories: IAgentMemory[] = [];
    for (const insight of reflection.insights) {
      const duplicate = await findSimilarMemory(userId, insight.content);
      if (duplicate) {
        console.log(`[Reflection] Skipped near-duplicate insight: "${insight.content.slice(0, 60)}..."`);
        continue;
      }
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

    // Run estimation bias reinforcement learning loop
    await calculateEstimationBiases(userId);

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
    const duplicate = await findSimilarMemory(userId, insight.content);
    if (duplicate) continue;
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

  // Run estimation bias reinforcement learning loop
  await calculateEstimationBiases(userId);

  return {
    summary,
    insights: savedMemories
  };
};
