import { Router, Request, Response } from 'express';
import Habit from '../models/Habit';

const router = Router();

// GET all habits
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const habits = await Habit.find({ userId });
    return res.json(habits);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST create a habit
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const habit = new Habit({
      ...req.body,
      userId
    });
    await habit.save();
    return res.status(201).json(habit);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// PUT update a habit
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const habit = await Habit.findOneAndUpdate(
      { _id: req.params.id, userId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }
    return res.json(habit);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// DELETE a habit
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const habit = await Habit.findOneAndDelete({ _id: req.params.id, userId });
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }
    return res.json({ message: 'Habit deleted' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST toggle habit completion for a specific date
router.post('/:id/toggle', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { date } = req.body; // Expects "YYYY-MM-DD"
    if (!date) {
      return res.status(400).json({ error: 'Date field is required (YYYY-MM-DD)' });
    }

    const habit = await Habit.findOne({ _id: req.params.id, userId });
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    const completions = habit.completions || [];
    const index = completions.findIndex(c => c.date === date);

    if (index > -1) {
      // Toggle existing entry
      completions[index].completed = !completions[index].completed;
    } else {
      // Add new completion entry
      completions.push({ date, completed: true });
    }

    habit.completions = completions;

    // --- Recalculate Streaks ---
    const activeCompletions = completions.filter(c => c.completed).map(c => c.date);
    
    // Sort completed dates chronologically
    const sortedDates = [...activeCompletions].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    let maxStreak = 0;
    let currentStreak = 0;
    let tempStreak = 0;
    let lastDate: Date | null = null;

    // Calculate longest streak
    sortedDates.forEach(dateStr => {
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);

      if (lastDate === null) {
        tempStreak = 1;
      } else {
        const diffTime = d.getTime() - lastDate.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
          tempStreak++;
        } else if (diffDays > 1) {
          tempStreak = 1;
        }
      }
      if (tempStreak > maxStreak) {
        maxStreak = tempStreak;
      }
      lastDate = d;
    });

    // Calculate current streak (scan backward from today/yesterday)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const hasCompletedToday = activeCompletions.includes(todayStr);
    const hasCompletedYesterday = activeCompletions.includes(yesterdayStr);

    if (hasCompletedToday || hasCompletedYesterday) {
      currentStreak = 0;
      let checkDate = hasCompletedToday ? new Date(today) : new Date(yesterday);

      while (true) {
        const checkStr = checkDate.toISOString().split('T')[0];
        if (activeCompletions.includes(checkStr)) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    } else {
      currentStreak = 0;
    }

    habit.currentStreak = currentStreak;
    habit.longestStreak = maxStreak;

    await habit.save();
    return res.json(habit);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;
