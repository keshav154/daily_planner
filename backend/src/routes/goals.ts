import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { Goal } from '../models/Goal';
import { Task } from '../models/Schemas';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { queryNvidiaNim } from '../config/nvidia';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Query LLM helper for goal milestone suggestions
async function queryLLMForMilestones(title: string, description: string): Promise<string[] | null> {
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const isAnthropicActive = anthropicKey && anthropicKey !== 'your_anthropic_api_key_here';

  if (!isNvidiaActive && !isAnthropicActive) return null;

  const prompt = `You are a goal setting expert. Create a list of 3 to 6 logical, clear milestones to achieve the following goal:
Goal: "${title}"
Description: "${description}"

Return ONLY a valid JSON array of strings containing milestone names. Do not include markdown formatting or explanation:
[
  "Milestone 1",
  "Milestone 2",
  "Milestone 3"
]`;

  try {
    let responseText = '';
    if (isNvidiaActive) {
      responseText = await queryNvidiaNim(
        [{ role: 'user', content: prompt }],
        process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
        0.3,
        500
      );
    } else if (isAnthropicActive) {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      });
      responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    }

    let cleanJson = responseText.trim();
    if (cleanJson.startsWith('```json')) cleanJson = cleanJson.slice(7);
    if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3);

    const parsed = JSON.parse(cleanJson.trim());
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.error('Milestone AI generation error:', err);
  }
  return null;
}

// GET / - List all user goals
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const goals = await Goal.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json(goals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST / - Create goal
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, deadline, milestones, autoDecompose } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Goal title is required' });
    }

    let milestonesList = milestones || [];

    if (autoDecompose && milestonesList.length === 0) {
      const aiMilestones = await queryLLMForMilestones(title, description || '');
      if (aiMilestones) {
        milestonesList = aiMilestones.map(m => ({ title: m, completed: false }));
      }
    }

    // Default milestones if none provided/generated
    if (milestonesList.length === 0) {
      milestonesList = [
        { title: 'Define strategy & start execution', completed: false },
        { title: 'Complete major core work items', completed: false },
        { title: 'Review output & finalize deliverables', completed: false }
      ];
    }

    const newGoal = new Goal({
      userId: req.userId,
      title,
      description: description || '',
      deadline: deadline ? new Date(deadline) : undefined,
      milestones: milestonesList,
      linkedTaskIds: [],
      status: 'active',
      agentNotes: [`Goal created on ${new Date().toLocaleDateString()}.`]
    });

    await newGoal.save();
    res.status(201).json(newGoal);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /:id - Update goal
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, deadline, milestones, status, linkedTaskIds } = req.body;
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.userId });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    if (title !== undefined) goal.title = title;
    if (description !== undefined) goal.description = description;
    if (deadline !== undefined) goal.deadline = deadline ? new Date(deadline) : undefined;
    if (milestones !== undefined) goal.milestones = milestones;
    if (status !== undefined) goal.status = status;
    if (linkedTaskIds !== undefined) goal.linkedTaskIds = linkedTaskIds;

    await goal.save();
    res.json(goal);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /:id - Delete goal
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await Goal.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!deleted) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ message: 'Goal successfully deleted.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/link-task - Link a task to the goal
router.post('/:id/link-task', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });

    const goal = await Goal.findOne({ _id: req.params.id, userId: req.userId });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const task = await Task.findOne({ _id: taskId, userId: req.userId });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (!goal.linkedTaskIds.includes(taskId)) {
      goal.linkedTaskIds.push(taskId);
      goal.agentNotes.push(`Linked task "${task.title}" to this goal.`);
      await goal.save();
    }

    res.json(goal);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/milestones/:mIdx/toggle - Toggle milestone completion
router.post('/:id/milestones/:mIdx/toggle', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.userId });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const mIdx = parseInt(req.params.mIdx, 10);
    if (isNaN(mIdx) || mIdx < 0 || mIdx >= goal.milestones.length) {
      return res.status(400).json({ error: 'Invalid milestone index' });
    }

    const currentCompleted = goal.milestones[mIdx].completed;
    goal.milestones[mIdx].completed = !currentCompleted;
    goal.milestones[mIdx].completedAt = !currentCompleted ? new Date() : undefined;
    
    goal.agentNotes.push(
      `Milestone "${goal.milestones[mIdx].title}" marked as ${!currentCompleted ? 'completed' : 'incomplete'}.`
    );

    await goal.save();
    res.json(goal);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /suggest-milestones - Get AI suggestions without saving
router.post('/suggest-milestones', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Goal title is required' });

    const suggested = await queryLLMForMilestones(title, description || '');
    if (!suggested) {
      return res.json({
        milestones: [
          'Initial scoping and alignment',
          'Execution of milestone checkpoints',
          'Final validation and handoff'
        ]
      });
    }
    res.json({ milestones: suggested });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
