import { Router, Request, Response } from 'express';
import { authenticateApiKey } from '../middleware/apiKeyAuth';
import { Task, Log, User, AgentMemory } from '../models/Schemas';
import { Goal } from '../models/Goal';
import { parseNaturalLanguageTask } from '../agent/parser';
import { handleTaskResolution } from '../services/resolutionHook';
import { queryNvidiaNim } from '../config/nvidia';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Apply API Key auth middleware globally to all integration routes
router.use(authenticateApiKey);

// Instantiate Anthropic Client for Standup Fallback
const getAnthropicClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') return null;
  return new Anthropic({ apiKey });
};

// 1. GET /api/integration/context
// Returns full operational context for the coding agent (today's schedule, goals, memories, work mode)
router.get('/context', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await User.findById(userId).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);

    // Fetch active schedule tasks
    const activeTasks = await Task.find({
      userId,
      $or: [
        { dueDate: { $gte: startOfDay, $lte: endOfDay } },
        { dueDate: { $lt: startOfDay }, status: { $in: ['todo', 'in-progress'] } }
      ]
    }).sort({ order: 1 });

    // Fetch goals
    const goals = await Goal.find({ userId, status: 'active' });

    // Fetch recent SRE/Tech memories
    const memories = await AgentMemory.find({ 
      userId, 
      feedback: { $ne: 'rejected' } 
    }).sort({ updatedAt: -1 }).limit(10);

    const context = {
      workMode: user.preferences?.workMode || 'wfh',
      workingHours: {
        start: user.preferences?.workMode === 'office' ? '10:30' : '10:00',
        end: user.preferences?.workMode === 'office' ? '16:30' : '18:00'
      },
      tasks: activeTasks.map(t => ({
        id: t._id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        estimatedTime: t.estimatedTime,
        actualTime: t.actualTime,
        category: t.category,
        dueDate: t.dueDate,
        resolution: t.resolution
      })),
      goals: goals.map((g: any) => ({
        id: g._id,
        title: g.title,
        progress: g.progress,
        deadline: g.deadline
      })),
      recentMemories: memories.map(m => ({
        category: m.category,
        content: m.content
      }))
    };

    res.json(context);
  } catch (error: any) {
    console.error('Integration Context error:', error);
    res.status(500).json({ error: 'Failed to construct agent context snapshot' });
  }
});

// 2. POST /api/integration/task
// Add a task. Supports either raw text quick-add or structured JSON
router.post('/task', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { text, taskJson } = req.body;

    if (!text && !taskJson) {
      return res.status(400).json({ error: 'Provide either raw "text" string or "taskJson" object' });
    }

    let structuredTask: any = {};

    if (text) {
      // Natural Language Parsing
      const user = await User.findById(userId);
      const tz = user?.timezone || 'UTC';
      structuredTask = await parseNaturalLanguageTask(text, tz, userId);
    } else {
      structuredTask = taskJson;
    }

    const newTask = new Task({
      userId,
      title: structuredTask.title,
      description: structuredTask.description || '',
      dueDate: structuredTask.dueDate ? new Date(structuredTask.dueDate) : new Date(),
      priority: structuredTask.priority || 'medium',
      estimatedTime: structuredTask.estimatedTime || 30,
      category: structuredTask.category || 'Work',
      tags: structuredTask.tags || [],
      status: structuredTask.status || 'todo'
    });

    await newTask.save();
    res.status(201).json(newTask);
  } catch (error: any) {
    console.error('Integration task add failed:', error);
    res.status(500).json({ error: 'Failed to register integrated task' });
  }
});

// 3. POST /api/integration/task/:id/complete
// Expose task completion and resolution ingestion endpoint for agents
router.post('/task/:id/complete', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { actualTime, resolution } = req.body;

    const task = await Task.findOne({ _id: id, userId });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const finalDuration = actualTime ? Number(actualTime) : (task.estimatedTime || 30);

    // Create the daily log entry in background
    const workLog = new Log({
      userId,
      taskId: task._id,
      title: `Completed: ${task.title}`,
      duration: finalDuration,
      notes: resolution || 'Completed via Agent CLI.'
    });
    await workLog.save();

    // Mark task done and save resolution details
    task.status = 'done';
    task.actualTime = finalDuration;
    if (resolution) {
      task.resolution = resolution;
      // Trigger resolution loop synthesizer hook
      await handleTaskResolution(userId, task.title, task.category, resolution);
    }
    await task.save();

    res.json({ message: 'Task marked completed successfully', task });
  } catch (error: any) {
    console.error('Integration task completion failed:', error);
    res.status(500).json({ error: 'Failed to finalize task resolution' });
  }
});

// 4. POST /api/integration/memory
// Ingest long-term facts/cheat-sheets autonomously
router.post('/memory', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { content, category, importance } = req.body;

    if (!content) return res.status(400).json({ error: 'Provide "content" string' });

    const newMemory = new AgentMemory({
      userId,
      type: 'preference',
      category: category || 'Tech Reference',
      content,
      importance: importance || 6,
      feedback: 'accepted',
      source: 'autonomous',
      lastAccessedAt: new Date()
    });

    await newMemory.save();
    res.status(201).json(newMemory);
  } catch (error: any) {
    console.error('Integration memory dump failed:', error);
    res.status(500).json({ error: 'Failed to record technology memory' });
  }
});

// 5. GET /api/integration/standup
// Ingest standup generator endpoint
router.get('/standup', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Fetch completed
    const completedTasks = await Task.find({
      userId,
      status: 'done',
      updatedAt: { $gte: yesterday }
    });

    const completedLogs = await Log.find({
      userId,
      timestamp: { $gte: yesterday }
    });

    // Fetch today
    const todayStr = now.toISOString().split('T')[0];
    const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
    const todayTasks = await Task.find({
      userId,
      status: { $in: ['todo', 'in-progress'] },
      $or: [
        { dueDate: { $gte: startOfDay } }
      ]
    });

    const context = {
      completedTasks: completedTasks.map(t => t.title),
      completedLogs: completedLogs.map(l => l.title),
      todayTasks: todayTasks.map(t => t.title)
    };

    const prompt = `Write a short, highly professional Slack engineering standup report.
Context:
${JSON.stringify(context, null, 2)}

Only output the Markdown text.`;

    let standupText = '';
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
    const client = getAnthropicClient();

    if (isNvidiaActive) {
      standupText = await queryNvidiaNim([
        { role: 'user', content: prompt }
      ], process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct', 0.2, 500) || '';
    } else if (client) {
      const response = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      });
      standupText = response.content[0].type === 'text' ? response.content[0].text : '';
    }

    if (!standupText || !standupText.trim()) {
      standupText = `*Yesterday:* ${context.completedTasks.join(', ') || 'None'}\n*Today:* ${context.todayTasks.join(', ') || 'None'}`;
    }

    res.json({ standup: standupText.trim() });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to synthesize daily standup report' });
  }
});

export default router;
