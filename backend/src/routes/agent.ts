import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { AgentRun, AgentMemory, Task } from '../models/Schemas';
import Habit from '../models/Habit';
import { Goal } from '../models/Goal';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { runPlanningLoop, runReflectionLoop, gatherUserContext } from '../agent/loop';
import { queryNvidiaNim } from '../config/nvidia';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

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

// Trigger a new Planning loop run
router.post('/plan', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const trigger = req.body.trigger || 'manual';
    const run = await runPlanningLoop(userId, trigger);
    res.json(run);
  } catch (error: any) {
    console.error('Agent plan error:', error);
    res.status(500).json({ error: 'Failed to generate agent plan' });
  }
});

// Get the latest planning run
router.get('/last-run', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const run = await AgentRun.findOne({ userId: req.userId })
      .sort({ createdAt: -1 })
      .populate('planOutput.suggestions.taskId');
    res.json(run);
  } catch (error: any) {
    console.error('Get last agent run error:', error);
    res.status(500).json({ error: 'Failed to fetch agent suggestions' });
  }
});

// Act: Resolve/apply a suggestion (Accept or Reject)
router.post('/action', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { runId, suggestionId, status } = req.body; // status = 'accepted' | 'rejected'

    if (!runId || !suggestionId || !['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Missing runId, suggestionId or invalid status' });
    }

    const run = await AgentRun.findOne({ _id: runId, userId });
    if (!run) {
      return res.status(404).json({ error: 'Agent run not found' });
    }

    // Find the action in actionsTaken
    const actionIndex = run.actionsTaken.findIndex(a => a.suggestionId === suggestionId);
    if (actionIndex === -1) {
      return res.status(404).json({ error: 'Suggestion not found in this run' });
    }

    if (run.actionsTaken[actionIndex].status !== 'pending') {
      return res.status(400).json({ error: 'Suggestion already resolved' });
    }

    // Mark as resolved
    run.actionsTaken[actionIndex].status = status;
    run.actionsTaken[actionIndex].resolvedAt = new Date();

    // If accepted, execute the actual DB change
    if (status === 'accepted') {
      const suggestion = run.planOutput.suggestions.find(s => s.id === suggestionId);
      if (suggestion) {
        switch (suggestion.actionType) {
          case 'reorder': {
            const { orderedTaskIds } = suggestion.details;
            if (Array.isArray(orderedTaskIds)) {
              const bulkOps = orderedTaskIds.map((id, index) => ({
                updateOne: {
                  filter: { _id: id, userId },
                  update: { $set: { order: index } }
                }
              }));
              await Task.bulkWrite(bulkOps);
            }
            break;
          }
          case 'create_task': {
            const { title, estimatedTime } = suggestion.details;
            const lastTask = await Task.findOne({ userId }).sort({ order: -1 });
            const nextOrder = lastTask ? lastTask.order + 1 : 0;
            
            const newTask = new Task({
              userId,
              title,
              estimatedTime: estimatedTime || 30,
              dueDate: new Date(),
              priority: 'medium',
              source: 'agent-suggested',
              order: nextOrder
            });
            await newTask.save();
            break;
          }
          case 'break_down': {
            const { taskId, subtasks } = suggestion.details;
            if (taskId && Array.isArray(subtasks)) {
              const parentTask = await Task.findOne({ _id: taskId, userId });
              if (parentTask) {
                // Get start order
                const lastTask = await Task.findOne({ userId }).sort({ order: -1 });
                let currentOrder = lastTask ? lastTask.order + 1 : 0;

                // Create subtasks
                for (const subtaskTitle of subtasks) {
                  const subTask = new Task({
                    userId,
                    title: subtaskTitle,
                    dueDate: parentTask.dueDate,
                    priority: parentTask.priority,
                    category: parentTask.category,
                    tags: [...parentTask.tags, 'subtask'],
                    source: 'agent-suggested',
                    order: currentOrder++
                  });
                  await subTask.save();
                }
                
                // Mark parent task as in-progress or update its description
                parentTask.description = (parentTask.description ? parentTask.description + '\n' : '') + 
                  'Broken down by AI Agent into subtasks.';
                await parentTask.save();
              }
            }
            break;
          }
          case 'suggest_time_block': {
            const { taskId, startTime, duration } = suggestion.details;
            if (taskId) {
              const task = await Task.findOne({ _id: taskId, userId });
              if (task) {
                task.description = (task.description ? task.description + '\n' : '') + 
                  `Scheduled time block: ${startTime} (duration: ${duration}m)`;
                await task.save();
              }
            }
            break;
          }
          case 'nudge': {
            // Nudge is an alert/nudge action, no direct schema mutation is needed.
            break;
          }
        }
      }
    }

    await run.save();
    res.json({ message: `Suggestion ${status} and applied successfully.`, run });
  } catch (error: any) {
    console.error('Apply agent action error:', error);
    res.status(500).json({ error: 'Failed to apply agent action' });
  }
});

// Trigger daily/weekly Reflection
router.post('/reflect', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { date } = req.body; // optional date override
    const reflection = await runReflectionLoop(userId, date);
    res.json(reflection);
  } catch (error: any) {
    console.error('Agent reflection error:', error);
    res.status(500).json({ error: 'Failed to generate agent reflection' });
  }
});

// Get user memories / insights
router.get('/memories', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const memories = await AgentMemory.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(memories);
  } catch (error: any) {
    console.error('Fetch memories error:', error);
    res.status(500).json({ error: 'Failed to fetch agent memory' });
  }
});

// Create a manual memory insight/preference
router.post('/memories', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { content, type, category } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const memory = new AgentMemory({
      userId: req.userId,
      content,
      type: type || 'preference',
      category: category || 'general',
      feedback: 'accepted' // Auto-approve manual entries
    });

    await memory.save();
    res.status(201).json(memory);
  } catch (error: any) {
    console.error('Create memory error:', error);
    res.status(500).json({ error: 'Failed to create memory' });
  }
});

// User feedback on Memory insights (accept/reject)
router.put('/memories/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { feedback } = req.body; // 'accepted' | 'rejected'

    if (!['accepted', 'rejected'].includes(feedback)) {
      return res.status(400).json({ error: 'Feedback must be accepted or rejected' });
    }

    const memory = await AgentMemory.findOneAndUpdate(
      { _id: id, userId: req.userId },
      { feedback },
      { new: true }
    );

    if (!memory) {
      return res.status(404).json({ error: 'Memory insight not found' });
    }

    res.json(memory);
  } catch (error: any) {
    console.error('Update memory error:', error);
    res.status(500).json({ error: 'Failed to update memory feedback' });
  }
});

// Interactive agent chat endpoint
router.post('/chat', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const context = await gatherUserContext(userId);
    const activeGoals = await Goal.find({ userId, status: 'active' });
    const activeHabits = await Habit.find({ userId, isActive: true });

    const systemPrompt = `You are Kortex Assistant, custom-built for Keshav. You are a premium AI daily productivity assistant.
You are having an interactive chat with the user to help them plan, structure, and optimize their schedule.

Current Context Snapshot:
- Current Time (UTC): ${context.currentTime}
- User Timezone/Preferences: ${context.user.timezone} (${context.user.preferences.workingHoursStart} to ${context.user.preferences.workingHoursEnd})
- Peak Energy: ${context.user.preferences.peakEnergyTime}
- Today's Tasks: ${JSON.stringify(context.activeTasks.map(t => ({ id: t._id, title: t.title, status: t.status, priority: t.priority, estimatedTime: t.estimatedTime, actualTime: t.actualTime })), null, 2)}
- Today's Work Logs: ${JSON.stringify(context.dailyLogs.map(l => ({ title: l.title, duration: l.duration })), null, 2)}
- Agent Memories: ${JSON.stringify(context.memories.map(m => m.content), null, 2)}
- Active Goals: ${JSON.stringify(activeGoals.map(g => ({ id: g._id, title: g.title, progress: g.progress, deadline: g.deadline, milestones: g.milestones.map(m => ({ title: m.title, completed: m.completed })) })), null, 2)}
- Habits: ${JSON.stringify(activeHabits.map(h => ({ id: h._id, title: h.title, streak: h.currentStreak })), null, 2)}

You can respond with standard suggestions AND also trigger direct tool calls if the user explicitly asks you to create, delete, timeblock, or schedule something.
Allowed action types in suggestions:
- "reorder": { orderedTaskIds: string[] }
- "suggest_time_block": { taskId: string, startTime: string, duration: number }
- "break_down": { taskId: string, subtasks: string[] }
- "nudge": { taskId: string, message: string }
- "create_task": { title: string, estimatedTime: number }

Direct Tool Calls allowed in your output:
{
  "name": "create_task" | "delete_task" | "add_time_block" | "add_habit" | "create_goal" | "complete_milestone",
  "arguments": {
    // for create_task: { "title": string, "estimatedTime": number }
    // for delete_task: { "taskId": string }
    // for add_time_block: { "taskId": string, "startTime": string, "endTime": string }
    // for add_habit: { "title": string, "frequency": "daily" | "weekdays" | "custom", "icon": string }
    // for create_goal: { "title": string, "description": string, "deadline": string }
    // for complete_milestone: { "goalId": string, "milestoneIndex": number }
  }
}

Response JSON interface:
{
  "response": "Your friendly text reply analyzing their message and context...",
  "suggestions": [],
  "toolCall": null // or the tool call object
}

Format output as raw JSON only. Do not wrap in markdown \`\`\`json block.`;

    const nvidiaKey = process.env.NVIDIA_API_KEY;
    const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    let responseText = '';
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...(history || []).map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: message }
    ];

    if (isNvidiaActive) {
      try {
        responseText = await queryNvidiaNim(messages, process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct', 0.5, 1000);
      } catch (nvidiaErr) {
        console.warn('NVIDIA NIM chat generation failed, attempting Anthropic fallback:', nvidiaErr);
        if (anthropicApiKey && anthropicApiKey !== 'your_anthropic_api_key_here') {
          const claudeMessages = messages.filter(m => m.role !== 'system');
          const anthropic = new Anthropic({ apiKey: anthropicApiKey });
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-5',
            max_tokens: 1000,
            system: systemPrompt,
            messages: claudeMessages
          });
          responseText = response.content[0].type === 'text' ? response.content[0].text : '';
        } else {
          throw nvidiaErr;
        }
      }
    } else if (anthropicApiKey && anthropicApiKey !== 'your_anthropic_api_key_here') {
      const claudeMessages = messages.filter(m => m.role !== 'system');
      const anthropic = new Anthropic({ apiKey: anthropicApiKey });
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system: systemPrompt,
        messages: claudeMessages
      });
      responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    } else {
      responseText = JSON.stringify({
        response: `Offline Mode: I received your message "${message}". Add an API key (Claude or NVIDIA NIM) to enable interactive chat scheduling.`,
        suggestions: []
      });
    }

    const parsedResponse = parseAiJson<any>(responseText);
    const suggestions = parsedResponse.suggestions || [];
    let toolCallResult = null;

    // Execute direct tool call if present
    if (parsedResponse.toolCall && parsedResponse.toolCall.name) {
      const { name, arguments: args } = parsedResponse.toolCall;
      try {
        switch (name) {
          case 'create_task': {
            const lastTask = await Task.findOne({ userId }).sort({ order: -1 });
            const nextOrder = lastTask ? lastTask.order + 1 : 0;
            const newTask = new Task({
              userId,
              title: args.title,
              estimatedTime: args.estimatedTime || 30,
              dueDate: new Date(),
              priority: 'medium',
              source: 'agent-suggested',
              order: nextOrder
            });
            await newTask.save();
            toolCallResult = `Successfully executed tool create_task: "${args.title}"`;
            break;
          }
          case 'delete_task': {
            await Task.deleteOne({ _id: args.taskId, userId });
            toolCallResult = `Successfully executed tool delete_task.`;
            break;
          }
          case 'add_time_block': {
            await Task.updateOne(
              { _id: args.taskId, userId },
              { $set: { timeBlock: { startTime: args.startTime, endTime: args.endTime } } }
            );
            toolCallResult = `Successfully scheduled focus block from ${args.startTime} to ${args.endTime}`;
            break;
          }
          case 'add_habit': {
            const newHabit = new Habit({
              userId,
              title: args.title,
              frequency: args.frequency || 'daily',
              icon: args.icon || '✨',
              completions: [],
              currentStreak: 0,
              longestStreak: 0,
              isActive: true
            });
            await newHabit.save();
            toolCallResult = `Successfully added habit: ${args.title}`;
            break;
          }
          case 'create_goal': {
            const newGoal = new Goal({
              userId,
              title: args.title,
              description: args.description || '',
              deadline: args.deadline ? new Date(args.deadline) : undefined,
              milestones: [
                { title: 'Define scope and roadmap', completed: false },
                { title: 'Implement key logic steps', completed: false },
                { title: 'Validate and review milestones', completed: false }
              ],
              status: 'active',
              agentNotes: ['Goal created autonomously via conversational AI interface.']
            });
            await newGoal.save();
            toolCallResult = `Successfully created goal: ${args.title}`;
            break;
          }
          case 'complete_milestone': {
            const goal = await Goal.findOne({ _id: args.goalId, userId });
            if (goal) {
              const idx = parseInt(args.milestoneIndex, 10);
              if (!isNaN(idx) && idx >= 0 && idx < goal.milestones.length) {
                goal.milestones[idx].completed = true;
                goal.milestones[idx].completedAt = new Date();
                goal.agentNotes.push(`Milestone index ${idx} completed autonomously via chat tool execution.`);
                await goal.save();
                toolCallResult = `Successfully completed milestone "${goal.milestones[idx].title}" for goal "${goal.title}"`;
              } else {
                toolCallResult = `Milestone index out of bounds.`;
              }
            } else {
              toolCallResult = `Goal not found.`;
            }
            break;
          }
        }
      } catch (e: any) {
        console.error('Failed to run tool call:', e);
        toolCallResult = `Tool call execution failed: ${e.message}`;
      }
    }

    let runId = null;
    const chatContextSnapshot = {
      ...context,
      goals: activeGoals.map(g => ({ id: g._id.toString(), title: g.title, progress: g.progress })),
      habits: activeHabits.map(h => ({ id: h._id.toString(), title: h.title, streak: h.currentStreak }))
    };

    if (suggestions.length > 0) {
      const agentRun = new AgentRun({
        userId,
        trigger: 'chat',
        contextSnapshot: chatContextSnapshot,
        planOutput: {
          rationale: `Chat: ${message}`,
          suggestions
        },
        actionsTaken: suggestions.map((s: any) => ({
          suggestionId: s.id,
          actionType: s.actionType,
          status: 'pending'
        }))
      });
      await agentRun.save();
      runId = agentRun._id;
    }

    res.json({
      response: parsedResponse.response,
      suggestions,
      toolCall: parsedResponse.toolCall ? { ...parsedResponse.toolCall, result: toolCallResult } : null,
      runId
    });
  } catch (error: any) {
    console.error('Agent chat error:', error);
    res.status(500).json({ error: 'Failed to process agent chat' });
  }
});

// Autonomous co-pilot background logs endpoint
router.get('/autonomous-status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { backgroundLogs } = require('../services/backgroundPlanner');
    // Also fetch the last few background agent runs. Trigger values are set in
    // backgroundPlanner.ts — background_hourly_check is the autonomous
    // Think-Act-Observe loop, background_auto_plan is the morning planner.
    const recentBackgroundRuns = await AgentRun.find({
      userId: req.userId,
      trigger: { $in: ['background_hourly_check', 'background_auto_plan'] }
    })
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      logs: backgroundLogs || [],
      runs: recentBackgroundRuns
    });
  } catch (error: any) {
    console.error('Fetch background planner status error:', error);
    res.status(500).json({ error: 'Failed to fetch background planner status' });
  }
});

// Virtual Boardroom multi-agent debate endpoint
router.post('/boardroom/debate', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Debate topic query is required' });
    }

    const context = await gatherUserContext(userId);

    const boardroomPrompt = `You are hosting the Kortex Boardroom, simulating a debate between three productivity specialists planning Keshav's schedule:
1. **Scrum Master**: Focused on estimations, sprint targets, dividing goals into actionable task lists.
2. **Productivity Coach**: Focused on focus fatigue, stress thresholds, avoiding burnout, protecting peak energy.
3. **Calendar Planner**: Focused on calendar layouts, time blocks, meeting conflicts, and scheduling.

Review details:
- Peak Energy Hours: ${context.user.preferences.peakEnergyTime}
- Working Hours: ${context.user.preferences.workingHoursStart} to ${context.user.preferences.workingHoursEnd}
- Tasks list: ${JSON.stringify(context.activeTasks.map(t => t.title))}
- Learned Memories: ${JSON.stringify(context.memories.map(m => m.content))}
- User Request / Debate Topic: "${query}"

Generate a short conversational script representing a debate among the three specialists, followed by a final Moderator consensus with 2-4 task recommendations/suggestions.

Return ONLY a JSON matching this exact structure:
{
  "debate": [
    { "agent": "Scrum Master", "message": "First comment..." },
    { "agent": "Productivity Coach", "message": "Second comment..." },
    { "agent": "Calendar Planner", "message": "Third comment..." }
  ],
  "suggestions": [
    {
      "id": "boardroom-slug-1",
      "actionType": "create_task | reorder | suggest_time_block | break_down",
      "description": "Moderator recommendation description",
      "details": { ... }
    }
  ]
}`;

    const nvidiaKey = process.env.NVIDIA_API_KEY;
    const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    let responseText = '';
    const messages = [{ role: 'user' as const, content: boardroomPrompt }];

    if (isNvidiaActive) {
      try {
        responseText = await queryNvidiaNim(messages, process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct', 0.6, 1500);
      } catch (nvidiaErr) {
        console.warn('NVIDIA NIM boardroom debate failed, attempting Anthropic fallback:', nvidiaErr);
        if (anthropicApiKey && anthropicApiKey !== 'your_anthropic_api_key_here') {
          const anthropic = new Anthropic({ apiKey: anthropicApiKey });
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-5',
            max_tokens: 1500,
            messages
          });
          responseText = response.content[0].type === 'text' ? response.content[0].text : '';
        } else {
          throw nvidiaErr;
        }
      }
    } else if (anthropicApiKey && anthropicApiKey !== 'your_anthropic_api_key_here') {
      const anthropic = new Anthropic({ apiKey: anthropicApiKey });
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        messages
      });
      responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    } else {
      // Mock debate fallback
      responseText = JSON.stringify({
        debate: [
          { agent: "Scrum Master", message: `Let's break down "${query}" into manageable subtasks first.` },
          { agent: "Productivity Coach", message: "Wait, we need to ensure we scheduled enough break buffers in this day." },
          { agent: "Calendar Planner", message: "Agreed. I will block morning focus hours to tackle this." }
        ],
        suggestions: [
          {
            id: 'boardroom-mock-task',
            actionType: 'create_task',
            description: `Start action item for: ${query}`,
            details: { title: `Work on: ${query}`, estimatedTime: 60 }
          }
        ]
      });
    }

    const debateOutput = parseAiJson<any>(responseText);

    // Save debate suggestions as a run to resolve
    let runId = null;
    if (debateOutput.suggestions && debateOutput.suggestions.length > 0) {
      const agentRun = new AgentRun({
        userId,
        trigger: 'boardroom_debate',
        contextSnapshot: context,
        planOutput: {
          rationale: `Boardroom debate: ${query}`,
          suggestions: debateOutput.suggestions
        },
        actionsTaken: debateOutput.suggestions.map((s: any) => ({
          suggestionId: s.id,
          actionType: s.actionType,
          status: 'pending'
        }))
      });
      await agentRun.save();
      runId = agentRun._id;
    }

    res.json({
      debate: debateOutput.debate,
      suggestions: debateOutput.suggestions || [],
      runId
    });
  } catch (error: any) {
    console.error('Boardroom debate error:', error);
    res.status(500).json({ error: 'Failed to process boardroom debate' });
  }
});

export default router;
