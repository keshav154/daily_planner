import { User, Task, Log, AgentMemory, AgentRun, ITask, ILog, IAgentMemory } from '../models/Schemas';
import { Goal } from '../models/Goal';
import Habit from '../models/Habit';
import { queryNvidiaNim } from '../config/nvidia';
import { getRelevantMemories } from './similarity';
import { searchSreResources } from './webSearch';
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
    const memories = await getRelevantMemories(userId, tasksQuery, 10);

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

    // 2. THINK PHASE: Reason about current state and formulate suggestions
    const systemPrompt = `You are Kortex Cognitive Brain, an autonomous agent managing a user's second brain.
You run in a Think-Act-Observe loop. Your job is to analyze the user's daily planner, habits, and goals context to propose adjustments.

Allowed proposal actions in suggestions:
- "reorder": { "orderedTaskIds": string[] } (Reorder tasks to prioritize)
- "suggest_time_block": { "taskId": string, "startTime": string, "duration": number } (Schedule a task to a focus block)
- "break_down": { "taskId": string, "subtasks": string[] } (Decompose a big task)
- "nudge": { "taskId": string, "message": string } (Alert the user to focus on an overdue item or daily calendar overloading)
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
1. Goal timelines: Are deadlines approaching but progress is low? Recommend creating catch-up tasks or add a goal warning.
2. Habit streaks: Are streaks at risk of breaking? Propose creating a nudge task or memory warning.
3. Task load & Calendar Load-Balancing: If user is in "office" workMode (working hours 10:30-16:30, i.e., 6-hour capacity), check if total task estimates exceed 4 hours. If overloaded, recommend a "nudge" or "reorder" proposing to defer low-priority tasks to tomorrow.
4. Overdue tasks: Suggest rescheduling or breaking down overdue todo items.
5. Past memories: Ensure your plan conforms to user preferences.

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

  // 3. Overdue task suggestions & Calendar Load-Balancer
  const overdueTasks = context.tasks.filter((t: any) => t.status !== 'done' && t.status !== 'skipped');
  const totalEstimated = overdueTasks.reduce((sum: number, t: any) => sum + (t.estimatedTime || 0), 0);
  const isOffice = context.user.preferences?.workMode === 'office';

  if (isOffice && totalEstimated > 240) {
    const lowPriorityTasks = overdueTasks.filter((t: any) => t.priority === 'low');
    suggestions.push({
      id: 'suggest-office-load-balance',
      actionType: 'nudge',
      description: `Office Day Focus Guard: You have ${totalEstimated} minutes of estimated tasks scheduled today. This exceeds your safe 4-hour office capacity (10:30-16:30). Consider rescheduling low-priority items like: ${lowPriorityTasks.map((t: any) => `"${t.title}"`).join(', ') || 'some items'}.`,
      details: {
        rescheduleCandidateIds: lowPriorityTasks.map((t: any) => t.id)
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
    suggestions.push({
      id: 'suggest-burnout-deload',
      actionType: 'nudge',
      description: `Burnout Sentinel Alert (Fatigue Score: ${fatigueScore}/100): High work intensity detected. I recommend deferring low-priority items and taking a mandatory recovery break.`,
      details: {
        fatigueScore,
        mitigation: 'Schedule recovery and defer low-priority tasks.'
      }
    });

    const lowPriorityTask = overdueTasks.find((t: any) => t.priority === 'low');
    if (lowPriorityTask) {
      suggestions.push({
        id: `suggest-reschedule-fatigue-${lowPriorityTask.id}`,
        actionType: 'nudge',
        description: `Fatigue Auto-Shedding: Defer non-critical task "${lowPriorityTask.title}" to tomorrow to prevent exhaustion.`,
        details: {
          taskId: lowPriorityTask.id,
          suggestedDate: new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
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
