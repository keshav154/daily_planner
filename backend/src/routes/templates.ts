import { Router, Request, Response } from 'express';
import TaskTemplate from '../models/TaskTemplate';
import { Task } from '../models/Schemas';

const router = Router();

// GET all task templates
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const templates = await TaskTemplate.find({ userId });
    return res.json(templates);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST create a task template
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const template = new TaskTemplate({
      ...req.body,
      userId
    });
    await template.save();
    return res.status(201).json(template);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// PUT update a task template
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const template = await TaskTemplate.findOneAndUpdate(
      { _id: req.params.id, userId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!template) {
      return res.status(404).json({ error: 'Task template not found' });
    }
    return res.json(template);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// DELETE a task template
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const template = await TaskTemplate.findOneAndDelete({ _id: req.params.id, userId });
    if (!template) {
      return res.status(404).json({ error: 'Task template not found' });
    }
    return res.json({ message: 'Task template deleted' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST apply a template (instantiate tasks for today)
router.post('/:id/apply', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const template = await TaskTemplate.findOne({ _id: req.params.id, userId });
    if (!template) {
      return res.status(404).json({ error: 'Task template not found' });
    }

    const today = new Date();
    // Default due date to 6:00 PM today
    today.setHours(18, 0, 0, 0);

    // Get current max order of tasks to prevent duplicates
    const maxOrderTask = await Task.findOne({ userId }).sort('-order');
    let startOrder = maxOrderTask ? maxOrderTask.order + 1 : 1;

    const createdTasks = [];
    for (const t of template.tasks) {
      const task = new Task({
        userId,
        title: t.title,
        description: `Instantiated from template: ${template.name}`,
        status: 'todo',
        priority: t.priority,
        dueDate: today,
        estimatedTime: t.estimatedTime,
        actualTime: 0,
        category: t.category,
        source: 'manual',
        order: startOrder++,
        subtasks: (t.subtasks || []).map(st => ({ title: st.title, completed: false }))
      });

      await task.save();
      createdTasks.push(task);
    }

    return res.status(201).json(createdTasks);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
