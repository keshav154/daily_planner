import { Router, Response } from 'express';
import { Task } from '../models/Schemas';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { parseNaturalLanguageTask } from '../agent/parser';

const router = Router();

// Get all tasks, with optional filter by date and automatic inclusion of overdue tasks
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { date } = req.query; // format: YYYY-MM-DD

    let query: any = { userId };

    if (date && typeof date === 'string') {
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);

      // Match tasks due today OR tasks that are overdue (due in the past and still todo/in-progress)
      query.$or = [
        { dueDate: { $gte: startOfDay, $lte: endOfDay } },
        { dueDate: { $lt: startOfDay }, status: { $in: ['todo', 'in-progress'] } }
      ];
    }

    const tasks = await Task.find(query).sort({ order: 1, createdAt: -1 });
    res.json(tasks);
  } catch (error: any) {
    console.error('Fetch tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Create a task manually
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, priority, dueDate, estimatedTime, tags, category, source } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Task title is required' });
    }

    // Get max order to append at the end
    const lastTask = await Task.findOne({ userId: req.userId }).sort({ order: -1 });
    const nextOrder = lastTask ? lastTask.order + 1 : 0;

    const task = new Task({
      userId: req.userId,
      title,
      description: description || '',
      priority: priority || 'medium',
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      estimatedTime: estimatedTime || 0,
      tags: tags || [],
      category: category || 'Work',
      source: source || 'manual',
      order: nextOrder
    });

    await task.save();
    res.status(201).json(task);
  } catch (error: any) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update a task
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const task = await Task.findOneAndUpdate(
      { _id: id, userId: req.userId },
      updates,
      { new: true, runValidators: true }
    );

    if (!task) {
      return res.status(404).json({ error: 'Task not found or unauthorized' });
    }

    res.json(task);
  } catch (error: any) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Reorder tasks
router.post('/reorder', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { orders } = req.body; // Array of { id: string, order: number }

    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'Invalid orders data' });
    }

    const bulkOps = orders.map((item) => ({
      updateOne: {
        filter: { _id: item.id, userId: req.userId },
        update: { $set: { order: item.order } }
      }
    }));

    await Task.bulkWrite(bulkOps);
    res.json({ message: 'Tasks reordered successfully' });
  } catch (error: any) {
    console.error('Reorder tasks error:', error);
    res.status(500).json({ error: 'Failed to reorder tasks' });
  }
});

// Quick-add task via Natural Language Parsing
router.post('/quick-add', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { text, timezone } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text query is required' });
    }

    const parsedTask = await parseNaturalLanguageTask(text, timezone || 'UTC');
    res.json(parsedTask);
  } catch (error: any) {
    console.error('Quick add parsing error:', error);
    res.status(500).json({ error: 'Failed to parse task description' });
  }
});

// Delete a task
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const task = await Task.findOneAndDelete({ _id: id, userId: req.userId });

    if (!task) {
      return res.status(404).json({ error: 'Task not found or unauthorized' });
    }

    res.json({ message: 'Task deleted successfully' });
  } catch (error: any) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
