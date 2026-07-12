import Anthropic from '@anthropic-ai/sdk';
import { AgentRun } from '../models/Schemas';
import { Goal } from '../models/Goal';
import Habit from '../models/Habit';
import { gatherUserContext } from '../agent/loop';
import { CHAT_TOOLS } from '../agent/tools';
import { runNimToolLoop, runAnthropicToolLoop, ToolLoopResult, ToolLoopHistoryTurn } from '../agent/toolLoop';

export interface AgentMessageResult {
  response: string;
  executedActions: string[];
  suggestions: Array<{ id: string; actionType: string; description: string; details: Record<string, any> }>;
  runId: string | null;
}

/**
 * Runs a single user message through the same tool-calling reasoning used by
 * the in-app chat panel: gathers context, picks NIM or Anthropic, executes
 * whatever tools are warranted, and persists any suggestions that need
 * approval. Shared by /agent/chat (JWT, multi-turn with history) and
 * /integration/smart-capture (API key, one-shot, no history) so both surfaces
 * reason identically instead of one being "dumb storage only".
 */
export async function processAgentMessage(
  userId: string,
  message: string,
  history: ToolLoopHistoryTurn[] = [],
  trigger: string = 'chat'
): Promise<AgentMessageResult> {
  const context = await gatherUserContext(userId);
  const activeGoals = await Goal.find({ userId, status: 'active' });
  const activeHabits = await Habit.find({ userId, isActive: true });

  const systemPrompt = `You are Kortex Assistant, custom-built for Keshav. You are a premium AI daily productivity assistant.
${history.length > 0
    ? 'You are having an interactive chat with the user to help them plan, structure, and optimize their schedule.'
    : 'You just received a single one-shot message from the user\'s quick-capture tool (no back-and-forth is possible — act on it fully now, don\'t ask clarifying questions).'}

Current Context Snapshot:
- Current Time (UTC): ${context.currentTime}
- User Timezone/Preferences: ${context.user.timezone} (${context.user.preferences.workingHoursStart} to ${context.user.preferences.workingHoursEnd})
- Peak Energy: ${context.user.preferences.peakEnergyTime}
- Today's Tasks: ${JSON.stringify(context.activeTasks.map(t => ({ id: t._id, title: t.title, status: t.status, priority: t.priority, estimatedTime: t.estimatedTime, actualTime: t.actualTime })), null, 2)}
- Today's Work Logs: ${JSON.stringify(context.dailyLogs.map(l => ({ title: l.title, duration: l.duration })), null, 2)}
- Agent Memories: ${JSON.stringify(context.memories.map(m => m.content), null, 2)}
- Active Goals: ${JSON.stringify(activeGoals.map(g => ({ id: g._id, title: g.title, progress: g.progress, deadline: g.deadline, milestones: g.milestones.map(m => ({ title: m.title, completed: m.completed })) })), null, 2)}
- Habits: ${JSON.stringify(activeHabits.map(h => ({ id: h._id, title: h.title, streak: h.currentStreak })), null, 2)}

Use the available tools to take action whenever the user asks you to create, delete, reschedule, break down, or organize something — don't just describe what you would do, actually call the tool. Reordering the whole day's task list is disruptive, so use propose_reorder for that instead of applying it directly; everything else (create_task, delete_task, schedule_time_block, break_down_task, defer_task, add_habit, create_goal, complete_milestone, add_goal_note) is safe to execute immediately. Not every message needs a tool call — plain questions just get a plain answer.

You are also the user's second brain — you remember what they tell you:
- When the user mentions a durable fact, deadline, preference, constraint, or says "remember...", call remember_fact to store it (convert relative dates like "next Friday" to absolute dates using the current time above). If the fact also implies work to do (a deadline, an exam, an event on a specific date), ALSO create a task for that date via create_task or schedule_time_block — remembering a date without putting it on the schedule is an incomplete response.
- If a message mentions an existing goal (e.g. a certification, a project) and gives a new deadline or date, also call add_goal_note so the goal reflects it.
- Before answering questions about the user's own life, habits, or past ("when is my exam?", "what did I say about..."), call search_memories first instead of guessing — the context snapshot above only shows a small sample of memories.
After any tool calls, reply with a short, friendly summary of what you did (or your answer, if no action was needed).`;

  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const isNvidiaActive = !!(nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here');
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const isAnthropicActive = !!(anthropicApiKey && anthropicApiKey !== 'your_anthropic_api_key_here');

  const toolCtx = { userId, now: new Date() };

  let loopResult: ToolLoopResult | null = null;

  if (isNvidiaActive) {
    try {
      loopResult = await runNimToolLoop(systemPrompt, message, toolCtx, { tools: CHAT_TOOLS, history });
    } catch (nvidiaErr) {
      console.warn('[AgentMessage] NIM tool loop failed, attempting Anthropic fallback:', nvidiaErr);
    }
  }

  if (!loopResult && isAnthropicActive) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicApiKey });
      loopResult = await runAnthropicToolLoop(anthropic, systemPrompt, message, toolCtx, { tools: CHAT_TOOLS, history });
    } catch (anthropicErr) {
      console.error('[AgentMessage] Anthropic tool loop failed:', anthropicErr);
    }
  }

  const responseText = loopResult
    ? loopResult.rationale
    : `Offline Mode: I received your message "${message}". Add an API key (Claude or NVIDIA NIM) to enable AI reasoning.`;
  const executedActions = loopResult?.executedLogs || [];
  const suggestions = loopResult?.suggestions || [];

  let runId: string | null = null;
  if (suggestions.length > 0) {
    const contextSnapshot = {
      ...context,
      goals: activeGoals.map(g => ({ id: g._id.toString(), title: g.title, progress: g.progress })),
      habits: activeHabits.map(h => ({ id: h._id.toString(), title: h.title, streak: h.currentStreak }))
    };

    const agentRun = new AgentRun({
      userId,
      trigger,
      contextSnapshot,
      planOutput: {
        rationale: `${trigger}: ${message}`,
        suggestions
      },
      executedActions,
      actionsTaken: suggestions.map((s: any) => ({
        suggestionId: s.id,
        actionType: s.actionType,
        status: 'pending'
      }))
    });
    await agentRun.save();
    runId = agentRun._id.toString();
  }

  return { response: responseText, executedActions, suggestions, runId };
}
