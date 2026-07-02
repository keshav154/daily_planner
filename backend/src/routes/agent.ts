import { Router, Response } from 'express';
import { AgentRun, AgentMemory, Task } from '../models/Schemas';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { runPlanningLoop, runReflectionLoop } from '../agent/loop';

const router = Router();

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

export default router;
