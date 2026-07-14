import { User, Task, Log, AgentMemory, AgentRun, ITask, ILog, IAgentMemory } from '../models/Schemas';
import { Goal } from '../models/Goal';
import Habit from '../models/Habit';
import { getRelevantMemories, getPatternMemories, getUserRules } from './similarity';
import { searchSreResources } from './webSearch';
import { runNimToolLoop, runAnthropicToolLoop, ToolLoopResult } from '../agent/toolLoop';
import { executeAgentTool } from '../agent/tools';
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
    const systemPrompt = `You are Kortex Cognitive Brain, an autonomous agent managing a user's second brain.
You run in a Think-Act-Observe loop using tools to inspect and adjust the user's daily planner, habits, and goals.

Guidance:
1. Goal timelines: If a deadline is approaching (<=4 days) but progress is low (<70%), call add_goal_note to log a warning and create_task for a catch-up task, passing that goal's id as goalId (this stops a fresh catch-up task from being created for the same goal every time this check re-runs while one is still open).
2. Habit streaks: If a habit is at risk (streak active but not completed today), call create_nudge_memory to warn the user before midnight.
3. Task load & Calendar Load-Balancing: If the user is in "office" workMode (6-hour capacity), and total estimated task time exceeds 4 hours, call defer_task on low-priority items or propose_reorder to prioritize.
4. Overdue tasks: Use break_down_task or schedule_time_block to make overdue todo items actionable.
5. Past memories: Use search_memories if you need more context before acting, and never contradict an accepted user preference.
6. Ground your reasoning in history: before proposing schedule or workload changes, call get_task_history and justify the change with the user's actual track record (completion rates, estimation accuracy, peak focus hours) — not generic productivity advice.

Only call tools when there is a genuine, specific issue to address — do not act just to act. Small, safe, reversible changes (create_task, schedule_time_block, break_down_task, defer_task, create_nudge_memory, add_goal_note) should be executed directly via tool calls. Anything that reshuffles the whole day (propose_reorder) is queued for human approval instead of applied immediately.
When you are done taking actions, respond with a final short text message summarizing your rationale (no further tool calls).`;

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
        loopResult = await runNimToolLoop(systemPrompt, userPrompt, toolCtx);
      } catch (err) {
        console.error('[Autonomous Loop] NIM tool loop failed, attempting Anthropic fallback:', err);
      }
    }

    if (!loopResult && isAnthropicActive) {
      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey });
        loopResult = await runAnthropicToolLoop(anthropic, systemPrompt, userPrompt, toolCtx);
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

// Fallback rule-based thinking generator (deterministic checks)
function runMockThinking(context: any): any {
  const suggestions: any[] = [];
  const directActions: any[] = [];
  const now = new Date();

  // 1. Goal timeline warnings
  for (const g of context.goals) {
    if (g.deadline) {
      const deadlineDate = new Date(g.deadline);
      const daysLeft = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysLeft > 0 && daysLeft <= 4 && g.progress < 70) {
        directActions.push({
          actionType: 'add_agent_note',
          details: {
            goalId: g.id,
            note: `Deadline in ${Math.round(daysLeft)} days, but goal progress is only ${g.progress}%. Plan execution immediately.`
          }
        });
        suggestions.push({
          id: `suggest-catchup-goal-${g.id}`,
          actionType: 'create_task',
          description: `Create catch-up task to advance milestones for goal: "${g.title}"`,
          details: {
            title: `Goal Catch-up: ${g.title}`,
            estimatedTime: 60
          }
        });
      }
    }
  }

  // 2. Habit streak warnings
  for (const h of context.habits) {
    if (h.atRisk) {
      directActions.push({
        actionType: 'create_nudge_memory',
        details: {
          content: `Your daily habit streak of ${h.streak} for "${h.title}" is at risk! Finish it before midnight.`,
          category: 'productivity',
          importance: 7
        }
      });
    }
  }

  // 3. Overdue task suggestions & Calendar Load-Balancer
  const overdueTasks = context.tasks.filter((t: any) => t.status !== 'done' && t.status !== 'skipped');
  const totalEstimated = overdueTasks.reduce((sum: number, t: any) => sum + (t.estimatedTime || 0), 0);
  const isOffice = context.user.preferences?.workMode === 'office';

  if (isOffice && totalEstimated > 240) {
    const lowPriorityTasks = overdueTasks.filter((t: any) => t.priority === 'low');
    // Nudges are informational only — accepting/rejecting one is a no-op in
    // agent.ts, so putting it in the approval queue was pure friction. Write
    // it straight to nudge memory instead (same dedup/expiry guards as every
    // other autonomous nudge).
    directActions.push({
      actionType: 'create_nudge_memory',
      details: {
        content: `Office Day Focus Guard: You have ${totalEstimated} minutes of estimated tasks scheduled today. This exceeds your safe 4-hour office capacity (10:30-16:30). Consider rescheduling low-priority items like: ${lowPriorityTasks.map((t: any) => `"${t.title}"`).join(', ') || 'some items'}.`,
        category: 'workload',
        importance: 6
      }
    });
  } else if (overdueTasks.length > 5) {
    suggestions.push({
      id: 'suggest-reschedule-overload',
      actionType: 'reorder',
      description: 'You have too many tasks. Reorder to prioritize top 3 items today.',
      details: {
        orderedTaskIds: overdueTasks.slice(0, 3).map((t: any) => t.id)
      }
    });
  }

  // 4. Fatigue Sentinel & Auto-Shedder
  let fatigueScore = 0;
  const recentLogsDuration = context.logs.reduce((sum: number, l: any) => sum + (l.duration || 0), 0);
  if (recentLogsDuration > 300) fatigueScore += 40;
  else if (recentLogsDuration > 180) fatigueScore += 20;

  const activeOverdueCount = overdueTasks.length;
  if (activeOverdueCount > 6) fatigueScore += 30;
  else if (activeOverdueCount > 3) fatigueScore += 15;

  const currentHour = now.getHours();
  if (currentHour >= 21 || currentHour < 5) {
    fatigueScore += 30;
  }

  if (fatigueScore >= 70) {
    directActions.push({
      actionType: 'create_nudge_memory',
      details: {
        content: `Burnout Sentinel Alert (Fatigue Score: ${fatigueScore}/100): High work intensity detected. I recommend deferring low-priority items and taking a mandatory recovery break.`,
        category: 'burnout',
        importance: 8
      }
    });

    const lowPriorityTask = overdueTasks.find((t: any) => t.priority === 'low');
    if (lowPriorityTask) {
      directActions.push({
        actionType: 'create_nudge_memory',
        details: {
          content: `Fatigue Auto-Shedding: Defer non-critical task "${lowPriorityTask.title}" to tomorrow to prevent exhaustion.`,
          category: 'fatigue-shedding',
          importance: 6
        }
      });
    }

    const hasRecoveryTask = context.tasks.some((t: any) => t.title.toLowerCase().includes('recovery') || t.title.toLowerCase().includes('rest session'));
    if (!hasRecoveryTask) {
      suggestions.push({
        id: 'suggest-recovery-break',
        actionType: 'create_task',
        description: 'Create a mandatory 60-minute Focus Recovery & Recharge session.',
        details: {
          title: '🔋 Focus Recovery & Rest Session',
          estimatedTime: 60,
          category: 'Health',
          priority: 'high'
        }
      });
    }
  }

  return {
    rationale: `Offline rule-based checks evaluated goal deadlines, habit risks, task capacity, and computed a Fatigue Score of ${fatigueScore}/100.`,
    suggestions,
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
