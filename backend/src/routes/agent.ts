import { Router, Response } from 'express';
import { AgentRun, AgentMemory, Task } from '../models/Schemas';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { runPlanningLoop, runReflectionLoop, gatherUserContext } from '../agent/loop';
import { queryNvidiaNim } from '../config/nvidia';
import { processAgentMessage } from '../services/agentChatService';
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

// Machine-internal memory categories: the agent uses these for its own
// reasoning (feedback rates, estimation calibration factors), but they read as
// jargon to a human ("Estimation Bias factor 0.83", "Suggestion Feedback
// Pattern for create_task"), so they're hidden from the user-facing list while
// staying in the DB for getPatternMemories to consume.
const INTERNAL_MEMORY_CATEGORIES = ['Suggestion Feedback Pattern', 'Estimation Bias'];

// Get user memories / insights (excluding expired transient nudges, which are
// only meaningful while live and clutter the review queue afterwards, and
// internal machine-telemetry categories that aren't human-readable insights)
router.get('/memories', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const memories = await AgentMemory.find({
      userId: req.userId,
      category: { $nin: INTERNAL_MEMORY_CATEGORIES },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
      ]
    }).sort({ createdAt: -1 });
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
      feedback: 'accepted', // Auto-approve manual entries
      source: 'user',       // User-authored: injected into every agent context by getUserRules
      importance: 8
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

    const chatHistory = (history || []).map((h: any) => ({ role: h.role, content: h.content }));
    const result = await processAgentMessage(userId, message, chatHistory, 'chat');
    res.json(result);
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
