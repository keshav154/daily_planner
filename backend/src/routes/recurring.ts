import { Router, Request, Response } from 'express';
import RecurringEvent from '../models/RecurringEvent';

const router = Router();

// GET all recurring events
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const events = await RecurringEvent.find({ userId });
    return res.json(events);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST create a recurring event
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const event = new RecurringEvent({
      ...req.body,
      userId
    });
    await event.save();
    return res.status(201).json(event);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// PUT update a recurring event
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const event = await RecurringEvent.findOneAndUpdate(
      { _id: req.params.id, userId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!event) {
      return res.status(404).json({ error: 'Recurring event not found' });
    }
    return res.json(event);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// DELETE a recurring event
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const event = await RecurringEvent.findOneAndDelete({ _id: req.params.id, userId });
    if (!event) {
      return res.status(404).json({ error: 'Recurring event not found' });
    }
    return res.json({ message: 'Recurring event deleted' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET instances for a specific date (materialize event occurrences)
router.get('/instances', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'Date query parameter is required (YYYY-MM-DD)' });
    }

    const targetDate = new Date(date as string);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    // Load active recurring events
    const events = await RecurringEvent.find({ userId, isActive: true });
    const instances: any[] = [];

    const targetDayOfWeek = targetDate.getDay(); // 0-6
    const targetDateStr = (date as string).split('T')[0];

    events.forEach(event => {
      // 1. Check if targetDate is after creation date (start time boundary)
      const createdDate = new Date(event.createdAt);
      createdDate.setHours(0, 0, 0, 0);
      const testDate = new Date(targetDate);
      testDate.setHours(0, 0, 0, 0);

      if (testDate < createdDate) return;

      // 2. Check if endDate has passed
      if (event.recurrence.endDate) {
        const endLimit = new Date(event.recurrence.endDate);
        endLimit.setHours(23, 59, 59, 999);
        if (testDate > endLimit) return;
      }

      // 3. Match recurrence pattern
      let isMatch = false;
      const pattern = event.recurrence.pattern;

      if (pattern === 'daily') {
        isMatch = true;
      } else if (pattern === 'weekdays') {
        isMatch = targetDayOfWeek >= 1 && targetDayOfWeek <= 5;
      } else if (pattern === 'weekly') {
        isMatch = event.recurrence.daysOfWeek.includes(targetDayOfWeek);
      } else if (pattern === 'biweekly') {
        const isDayMatch = event.recurrence.daysOfWeek.includes(targetDayOfWeek);
        if (isDayMatch) {
          // Compute difference in weeks since event creation
          const diffMs = testDate.getTime() - createdDate.getTime();
          const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
          const interval = event.recurrence.interval || 2;
          isMatch = diffWeeks % interval === 0;
        }
      } else if (pattern === 'monthly') {
        // Match day of month (e.g. 5th of every month)
        isMatch = targetDate.getDate() === createdDate.getDate();
      }

      if (isMatch) {
        instances.push({
          _id: `${event._id}_${targetDateStr}`,
          recurringEventId: event._id,
          title: event.title,
          description: event.description,
          type: event.type,
          startTime: event.startTime,
          endTime: event.endTime,
          category: event.category,
          color: event.color,
          location: event.location,
          meetingLink: event.meetingLink,
          date: targetDateStr
        });
      }
    });

    return res.json(instances);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
