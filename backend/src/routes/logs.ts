import { Router, Response } from 'express';
import { Log, Task } from '../models/Schemas';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Get all logs, with optional filters
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { date, taskId } = req.query;

    let query: any = { userId };

    if (taskId && typeof taskId === 'string') {
      query.taskId = taskId;
    }

    if (date && typeof date === 'string') {
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);
      query.timestamp = { $gte: startOfDay, $lte: endOfDay };
    }

    const logs = await Log.find(query).sort({ timestamp: -1 });
    res.json(logs);
  } catch (error: any) {
    console.error('Fetch logs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Append a new log entry
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { taskId, title, duration, notes, timestamp } = req.body;

    if (!title || duration === undefined) {
      return res.status(400).json({ error: 'Title and duration are required' });
    }

    const log = new Log({
      userId: req.userId,
      taskId: taskId || undefined,
      title,
      duration: Number(duration),
      notes: notes || '',
      timestamp: timestamp ? new Date(timestamp) : new Date()
    });

    await log.save();

    // If taskId is provided, update actualTime on that task
    if (taskId) {
      await Task.findOneAndUpdate(
        { _id: taskId, userId: req.userId },
        { $inc: { actualTime: Number(duration) } }
      );
    }

    res.status(201).json(log);
  } catch (error: any) {
    console.error('Create log error:', error);
    res.status(500).json({ error: 'Failed to create log entry' });
  }
});

// Delete a log entry
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const log = await Log.findOneAndDelete({ _id: id, userId: req.userId });

    if (!log) {
      return res.status(404).json({ error: 'Log entry not found or unauthorized' });
    }

    // If task was associated, decrement actualTime
    if (log.taskId) {
      await Task.findOneAndUpdate(
        { _id: log.taskId, userId: req.userId },
        { $inc: { actualTime: -Number(log.duration) } }
      );
    }

    res.json({ message: 'Log entry deleted successfully' });
  } catch (error: any) {
    console.error('Delete log error:', error);
    res.status(500).json({ error: 'Failed to delete log entry' });
  }
});

export default router;
