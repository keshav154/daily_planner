import { User, Task, Log, AgentMemory, AgentRun, ITask, ILog, IAgentMemory } from '../models/Schemas';
import { Goal } from '../models/Goal';
import Habit from '../models/Habit';
import { getRelevantMemories, getPatternMemories, getUserRules } from './similarity';
import { searchSreResources } from './webSearch';
import { runNimToolLoop, runAnthropicToolLoop, ToolLoopResult } from '../agent/toolLoop';
import { executeAgentTool, OBSERVE_TOOLS } from '../agent/tools';
import { filterDuplicateSuggestions } from './suggestionDedupe';
import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';

/**
 * Executes a full autonomous agent cycle (Think-Act-Observe) for a user.
 */
export const runAutonomousAgentLoop = async (userId: string, trigger: string = 'autonomous_check') => {
  console.log(`[Autonomous Loop] Starting cycle for user ${userId} via ${trigger}...`);
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);

    // 1. OBSERVE PHASE: Gather full workspace snapshot
    const activeTasks = await Task.find({
      userId,
      $or: [
        { dueDate: { $gte: startOfDay, $lte: endOfDay } },
        { dueDate: { $lt: startOfDay }, status: { $in: ['todo', 'in-progress'] } }
      ]
    }).sort({ order: 1 });

    const dailyLogs = await Log.find({
      userId,
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ timestamp: -1 });

    const activeGoals = await Goal.find({ userId, status: 'active' });
    const habits = await Habit.find({ userId, isActive: true });
    
    // Check habit completions & find streaks at risk (completed yesterday but not yet today)
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const habitDetails = habits.map(h => {
      const completionMap = new Map(h.completions.map(c => [c.date, c.completed]));
      const completedToday = completionMap.get(todayStr) === true;
      const completedYesterday = completionMap.get(yesterdayStr) === true;
      const streak = h.currentStreak || 0;
      const atRisk = streak > 0 && completedYesterday && !completedToday;
      
      return {
        id: h._id.toString(),
        title: h.title,
        streak,
        completedToday,
        atRisk
      };
    });

    // Research SRE/Learning goals autonomously in the background
    for (const g of activeGoals) {
      const titleLower = g.title.toLowerCase();
      const isLearningGoal = ['learn', 'study', 'prepare', 'cert', 'exam', 'k8s', 'kubernetes', 'terraform', 'aws', 'docker', 'prometheus', 'grafana', 'ansible'].some(kw => titleLower.includes(kw));

      if (isLearningGoal) {
        try {
          const existingRef = await AgentMemory.findOne({
            userId,
            category: 'Tech Reference',
            content: new RegExp(g.title, 'i')
          });

          if (!existingRef) {
            console.log(`[Knowledge Loop] Autonomously researching SRE topic for Goal: "${g.title}"`);
            const searchResult = await searchSreResources(g.title);
            
            const memoryContent = `### Technology Reference for Goal: "${g.title}"
Source: ${searchResult.sourceUrl || 'Web'}

${searchResult.content}`;

            const refMemory = new AgentMemory({
              userId,
              type: 'preference',
              category: 'Tech Reference',
              content: memoryContent,
              feedback: 'accepted',
              importance: 7,
              source: 'autonomous'
            });
            await refMemory.save();
            
            g.agentNotes.push(`[Autonomous Research] Added technology reference cheat-sheet: "${searchResult.title}" to your memory vault.`);
            await g.save();
            console.log(`[Knowledge Loop] Saved SRE reference for "${g.title}"`);
          }
        } catch (searchErr) {
          console.error('[Knowledge Loop] Failed to research topic:', searchErr);
        }
      }
    }

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

    const adjustedPreferences = { 
      ...user.preferences,
      workingHoursStart: user.preferences.workMode === 'office' ? '10:30' : '10:00',
      workingHoursEnd: user.preferences.workMode === 'office' ? '16:30' : '18:00'
    };

    const context = {
      currentTime: now.toISOString(),
      user: {
        email: user.email,
        timezone: user.timezone,
        preferences: adjustedPreferences as any
      },
      tasks: activeTasks.map(t => ({ id: t._id.toString(), title: t.title, priority: t.priority, status: t.status, estimatedTime: t.estimatedTime, order: t.order })),
      logs: dailyLogs.map(l => ({ title: l.title, duration: l.duration })),
      goals: activeGoals.map(g => ({ id: g._id.toString(), title: g.title, progress: g.progress, deadline: g.deadline, milestoneCount: g.milestones.length })),
      habits: habitDetails,
      memories: memories.map(m => m.content)
    };

    // 2 & 3. THINK + ACT PHASE: A real tool-calling loop instead of a single JSON blob.
    // The model calls tools (get_tasks, create_task, schedule_time_block, break_down_task,
    // defer_task, create_nudge_memory, add_goal_note, search_memories, propose_reorder),
    // sees each result, and can decide on further actions before concluding.
    const systemPrompt = `You are Kortex Cognitive Brain, a quiet background observer of the user's second brain.
You run periodically to UNDERSTAND the user's planner, habits, and goals — not to rearrange them.

IMPORTANT — you are in observe-only mode. You do NOT create tasks, break tasks down, reschedule, reorder, or send nudges on your own. The user has consistently rejected unsolicited changes, so those actions only happen when they explicitly ask via chat. Your job is to notice what matters and, at most, record a concise note on a goal.

What to do:
1. Use get_tasks, get_task_history, and search_memories to understand the current state and the user's real track record (completion rates, estimation accuracy, peak focus hours).
2. Only if there is a genuinely important, specific, and NEW observation about a goal (e.g. a deadline is close and progress is stalled), call add_goal_note ONCE to record it — do not repeat notes you've already made.
3. Never contradict an accepted user preference.

Most cycles, the right action is to take NO action — just observe. Do not act to look busy. When done, respond with a one-sentence summary of what you observed (no further tool calls).`;

    const userPrompt = `Here is the current workspace snapshot:
${JSON.stringify(context, null, 2)}

Review goal timelines, habit streaks, task load, and overdue tasks as described in your instructions, taking any warranted tool actions. Finish with a concise rationale summarizing what you observed and did.`;

    const nvidiaKey = process.env.NVIDIA_API_KEY;
    const isNvidiaActive = !!(nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here');
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const isAnthropicActive = !!(anthropicKey && anthropicKey !== 'your_anthropic_api_key_here');

    let loopResult: ToolLoopResult | null = null;
    const toolCtx = { userId, now };

    if (isNvidiaActive) {
      try {
        loopResult = await runNimToolLoop(systemPrompt, userPrompt, toolCtx, { tools: OBSERVE_TOOLS });
      } catch (err) {
        console.error('[Autonomous Loop] NIM tool loop failed, attempting Anthropic fallback:', err);
      }
    }

    if (!loopResult && isAnthropicActive) {
      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey });
        loopResult = await runAnthropicToolLoop(anthropic, systemPrompt, userPrompt, toolCtx, { tools: OBSERVE_TOOLS });
      } catch (err) {
        console.error('[Autonomous Loop] Anthropic tool loop failed:', err);
      }
    }

    let planOutput: { rationale: string; suggestions: any[] };
    let executedLogs: string[] = [];

    if (loopResult) {
      planOutput = { rationale: loopResult.rationale, suggestions: loopResult.suggestions };
      executedLogs = loopResult.executedLogs;
    } else {
      // No LLM active or both providers failed: deterministic rule-based fallback.
      const mockPlan = runMockThinking(context);
      executedLogs = await executeMockDirectActions(userId, now, mockPlan.directActions);
      planOutput = { rationale: mockPlan.rationale, suggestions: mockPlan.suggestions };
    }

    // Save pending suggestions to AgentRun so the user can accept/reject them in
    // the dashboard — deduped against what's already pending from recent runs,
    // since the hourly cycle would otherwise re-propose the same thing every hour.
    const dedupedSuggestions = await filterDuplicateSuggestions(userId, planOutput.suggestions);
    const run = new AgentRun({
      userId,
      trigger,
      contextSnapshot: context,
      planOutput: {
        rationale: planOutput.rationale || `Triggered by ${trigger}`,
        suggestions: dedupedSuggestions
      },
      executedActions: executedLogs,
      actionsTaken: dedupedSuggestions.map((s: any) => ({
        suggestionId: s.id,
        actionType: s.actionType,
        status: 'pending'
      }))
    });

    await run.save();
    
    // Log to background planner logs
    logToBackgroundLogs(
      'success',
      `Autonomous cycle run completed for ${user.email}. Executed ${executedLogs.length} actions. Generated ${dedupedSuggestions.length} suggestions.`
    );

    return {
      run,
      executedLogs
    };
  } catch (error: any) {
    console.error('[Autonomous Loop] Cycle execution failed:', error);
    logToBackgroundLogs('error', `Autonomous cycle run failed: ${error.message}`);
    return null;
  }
};

// Executes the directActions produced by the deterministic mock planner (used
// when no LLM is active). Delegates to the shared tool executor so the offline
// path gets the exact same behavior and dedupe guards as the tool-calling loop
// — the mock path previously had its own copy of the nudge logic, which is how
// hourly runs stacked a dozen identical "habit at risk" memories in one day.
async function executeMockDirectActions(userId: string, now: Date, directActions: any[]): Promise<string[]> {
  const executedLogs: string[] = [];
  const toolNameByAction: Record<string, string> = {
    add_agent_note: 'add_goal_note',
    create_nudge_memory: 'create_nudge_memory'
  };

  for (const dAct of directActions || []) {
    const toolName = toolNameByAction[dAct.actionType];
    if (!toolName) continue;
    try {
      const execResult = await executeAgentTool(toolName, dAct.details || {}, { userId, now });
      if (!execResult.result.startsWith('Error') && !execResult.result.startsWith('Skipped')) {
        executedLogs.push(execResult.result);
      }
    } catch (e: any) {
      console.error(`[Autonomous Loop] Failed to run direct action ${dAct.actionType}:`, e.message);
    }
  }
  return executedLogs;
}

// Fallback rule-based observer (used when no LLM is active). Observe-only:
// it records at most a single goal note for a genuinely stalled deadline and
// proposes NO task mutations — the user rejected the old catch-up/reorder/
// nudge/recovery suggestions 90-100% of the time, so they're gone.
function runMockThinking(context: any): any {
  const directActions: any[] = [];
  const now = new Date();

  // Only observation worth recording autonomously: a near deadline with
  // stalled progress. One note per such goal; downstream dedup stops repeats.
  for (const g of context.goals) {
    if (g.deadline) {
      const deadlineDate = new Date(g.deadline);
      const daysLeft = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysLeft > 0 && daysLeft <= 4 && g.progress < 70) {
        directActions.push({
          actionType: 'add_agent_note',
          details: {
            goalId: g.id,
            note: `Deadline in ${Math.round(daysLeft)} days with progress at ${g.progress}%.`
          }
        });
      }
    }
  }

  return {
    rationale: 'Observed goal timelines; no autonomous task changes (observe-only mode).',
    suggestions: [],
    directActions
  };
}

// Logger helper
const logToBackgroundLogs = (type: 'info' | 'success' | 'warn' | 'error', msg: string) => {
  try {
    const { backgroundLogs } = require('./backgroundPlanner');
    backgroundLogs.push({ timestamp: new Date(), type, message: msg });
  } catch (e) {}
};
