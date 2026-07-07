import { User, Task, Log, AgentMemory, AgentRun, ITask, ILog, IAgentMemory } from '../models/Schemas';
import { Goal } from '../models/Goal';
import Habit from '../models/Habit';
import { queryNvidiaNim } from '../config/nvidia';
import { getRelevantMemories } from './similarity';
import Anthropic from '@anthropic-ai/sdk';
import mongoose from 'mongoose';

// Helper to query LLM
async function queryLLM(prompt: string, systemPrompt: string): Promise<string | null> {
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const isAnthropicActive = anthropicKey && anthropicKey !== 'your_anthropic_api_key_here';

  if (!isNvidiaActive && !isAnthropicActive) return null;

  try {
    if (isNvidiaActive) {
      return await queryNvidiaNim(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
        0.3,
        1500
      );
    } else if (isAnthropicActive) {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      });
      return response.content[0].type === 'text' ? response.content[0].text : null;
    }
  } catch (err) {
    console.error('[Autonomous Loop] LLM query failed:', err);
  }
  return null;
}

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

    const tasksQuery = activeTasks.map(t => t.title).join(' ');
    const memories = await getRelevantMemories(userId, tasksQuery, 10);

    const context = {
      currentTime: now.toISOString(),
      user: {
        email: user.email,
        timezone: user.timezone,
        preferences: user.preferences
      },
      tasks: activeTasks.map(t => ({ id: t._id.toString(), title: t.title, priority: t.priority, status: t.status, estimatedTime: t.estimatedTime, order: t.order })),
      logs: dailyLogs.map(l => ({ title: l.title, duration: l.duration })),
      goals: activeGoals.map(g => ({ id: g._id.toString(), title: g.title, progress: g.progress, deadline: g.deadline, milestoneCount: g.milestones.length })),
      habits: habitDetails,
      memories: memories.map(m => m.content)
    };

    // 2. THINK PHASE: Reason about current state and formulate suggestions
    const systemPrompt = `You are Kortex Cognitive Brain, an autonomous agent managing a user's second brain.
You run in a Think-Act-Observe loop. Your job is to analyze the user's daily planner, habits, and goals context to propose adjustments.

Allowed proposal actions in suggestions:
- "reorder": { "orderedTaskIds": string[] } (Reorder tasks to prioritize)
- "suggest_time_block": { "taskId": string, "startTime": string, "duration": number } (Schedule a task to a focus block)
- "break_down": { "taskId": string, "subtasks": string[] } (Decompose a big task)
- "nudge": { "taskId": string, "message": string } (Alert the user to focus on an overdue item)
- "create_task": { "title": string, "estimatedTime": number } (Create a catch-up or missing prerequisite task)

Autonomous actions you can execute directly (returned under "directActions"):
- "add_agent_note": { "goalId": string, "note": string } (Add an observational note to a goal's progress feed)
- "create_nudge_memory": { "content": string, "category": string, "importance": number } (Create a temporary memory warning, e.g. habit streak at risk)

Format output strictly as a JSON object containing:
{
  "rationale": "Detailed step-by-step thinking explaining your analysis of goals, streaks, and focus metrics",
  "suggestions": [
    {
      "id": "unique-slug",
      "taskId": "task-id-if-applicable",
      "actionType": "reorder|suggest_time_block|break_down|nudge|create_task",
      "description": "Short rationale for the user",
      "details": { ... }
    }
  ],
  "directActions": [
    {
      "actionType": "add_agent_note|create_nudge_memory",
      "details": { ... }
    }
  ]
}`;

    const prompt = `Here is the current workspace snapshot:
${JSON.stringify(context, null, 2)}

Inspect:
1. Goal timelines: Are deadlines approaching but progress is low? If so, recommend creating catch-up tasks or add an agent note warning to the goal.
2. Habit streaks: Are streaks at risk of breaking (atRisk: true) and is it late in the day (current local hour)? Propose creating a nudge task or memory warning.
3. Task load: Are there overdue todo items or too many tasks scheduled? Recommend rescheduling or breaking them down.
4. Past memories: Ensure your plan conforms to user preferences.

Analyze the state, write your rationale, and output the suggestions and direct actions.`;

    interface PlanOutput {
      rationale: string;
      suggestions: any[];
      directActions: any[];
    }

    const raw = await queryLLM(prompt, systemPrompt);
    let planOutput: PlanOutput = { rationale: '', suggestions: [], directActions: [] };

    if (raw) {
      try {
        let cleanJson = raw.trim();
        if (cleanJson.startsWith('```json')) cleanJson = cleanJson.slice(7);
        if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3);
        const parsed = JSON.parse(cleanJson.trim());
        planOutput = {
          rationale: parsed.rationale || '',
          suggestions: parsed.suggestions || [],
          directActions: parsed.directActions || []
        };
      } catch (err) {
        console.error('[Autonomous Loop] Failed to parse AI plan JSON. Using mock planner.', err);
        planOutput = runMockThinking(context);
      }
    } else {
      planOutput = runMockThinking(context);
    }

    // 3. ACT PHASE: Execute directActions and save suggestions for human approval
    const executedLogs: string[] = [];

    if (planOutput.directActions && planOutput.directActions.length > 0) {
      for (const dAct of planOutput.directActions) {
        try {
          switch (dAct.actionType) {
            case 'add_agent_note': {
              const { goalId, note } = dAct.details;
              if (goalId && note) {
                await Goal.updateOne(
                  { _id: new mongoose.Types.ObjectId(goalId), userId },
                  { $push: { agentNotes: `[Autonomous Brain] ${note} (${now.toLocaleDateString()})` } }
                );
                executedLogs.push(`Added notes to goal ${goalId}: "${note}"`);
              }
              break;
            }
            case 'create_nudge_memory': {
              const { content, category, importance } = dAct.details;
              if (content) {
                const newMem = new AgentMemory({
                  userId,
                  type: 'adjustment',
                  content,
                  category: category || 'productivity',
                  feedback: 'none', // pending user dismissal
                  source: 'autonomous',
                  importance: importance || 6,
                  expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) // expires in 24 hours
                });
                await newMem.save();
                executedLogs.push(`Created temporary agent nudge memory: "${content}"`);
              }
              break;
            }
          }
        } catch (e: any) {
          console.error(`[Autonomous Loop] Failed to run direct action ${dAct.actionType}:`, e.message);
        }
      }
    }

    // Save pending suggestions to AgentRun so the user can accept/reject them in the dashboard
    const run = new AgentRun({
      userId,
      trigger,
      contextSnapshot: context,
      planOutput: {
        rationale: planOutput.rationale || `Triggered by ${trigger}`,
        suggestions: planOutput.suggestions
      },
      actionsTaken: planOutput.suggestions.map((s: any) => ({
        suggestionId: s.id,
        actionType: s.actionType,
        status: 'pending'
      }))
    });

    await run.save();
    
    // Log to background planner logs
    logToBackgroundLogs(
      'success',
      `Autonomous cycle run completed for ${user.email}. Executed ${executedLogs.length} actions. Generated ${planOutput.suggestions.length} suggestions.`
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

  // 3. Overdue task suggestions
  const overdueTasks = context.tasks.filter((t: any) => t.status !== 'done' && t.status !== 'skipped');
  if (overdueTasks.length > 5) {
    suggestions.push({
      id: 'suggest-reschedule-overload',
      actionType: 'reorder',
      description: 'You have too many tasks. Reorder to prioritize top 3 items today.',
      details: {
        orderedTaskIds: overdueTasks.slice(0, 3).map((t: any) => t.id)
      }
    });
  }

  return {
    rationale: 'Offline rule-based checks evaluated approaching goal deadlines, habit streak risks, and daily task overload.',
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
