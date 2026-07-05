import { Router, Request, Response } from 'express';
import { Task, User } from '../models/Schemas';
import RecurringEvent from '../models/RecurringEvent';
import { queryNvidiaNim } from '../config/nvidia';
import Anthropic from '@anthropic-ai/sdk';

// Instantiate Anthropic Client
const getAnthropicClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return null;
  }
  return new Anthropic({ apiKey });
};

const router = Router();

router.get('/daily', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);

    // Fetch tasks due today plus overdue
    const tasks = await Task.find({
      userId,
      $or: [
        { dueDate: { $gte: startOfDay, $lte: endOfDay } },
        { dueDate: { $lt: startOfDay }, status: { $in: ['todo', 'in-progress'] } }
      ]
    });

    // Fetch active recurring events
    const recurringEvents = await RecurringEvent.find({ userId, isActive: true });
    
    // Check which ones occur today
    const targetDayOfWeek = new Date().getDay();
    const todayRecurring = recurringEvents.filter(event => {
      const createdDate = new Date(event.createdAt);
      createdDate.setHours(0, 0, 0, 0);
      if (startOfDay < createdDate) return false;

      if (event.recurrence.endDate) {
        const endLimit = new Date(event.recurrence.endDate);
        endLimit.setHours(23, 59, 59, 999);
        if (startOfDay > endLimit) return false;
      }

      const pattern = event.recurrence.pattern;
      if (pattern === 'daily') return true;
      if (pattern === 'weekdays') return targetDayOfWeek >= 1 && targetDayOfWeek <= 5;
      if (pattern === 'weekly' || pattern === 'biweekly') return event.recurrence.daysOfWeek.includes(targetDayOfWeek);
      if (pattern === 'monthly') return new Date().getDate() === createdDate.getDate();
      return false;
    });

    const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'skipped');
    const highPriorityTasks = activeTasks.filter(t => t.priority === 'high');

    const nvidiaKey = process.env.NVIDIA_API_KEY;
    const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
    const anthropicClient = getAnthropicClient();

    let briefingText = '';

    if (isNvidiaActive || anthropicClient) {
      const prompt = `You are a personalized daily executive assistant. Write a short, motivating morning briefing paragraph (3-4 sentences max) for Keshav.
Summary statistics:
- Total active tasks today: ${activeTasks.length}
- High-priority tasks: ${highPriorityTasks.map(t => t.title).join(', ') || 'None'}
- Total estimated duration: ${activeTasks.reduce((acc, t) => acc + t.estimatedTime, 0)} minutes
- Recurring meetings/standups scheduled today: ${todayRecurring.map(e => `${e.title} (${e.startTime}-${e.endTime})`).join(', ') || 'None'}
- User Timezone: ${user.timezone || 'UTC'}
- Work hours preferences: ${user.preferences?.workingHoursStart || '09:00'} to ${user.preferences?.workingHoursEnd || '17:00'}

Keep the tone encouraging, high-agency, professional, and productivity-focused. Return ONLY the plain text briefing paragraph. Do not include markdown headers or greetings.`;

      try {
        if (isNvidiaActive) {
          briefingText = await queryNvidiaNim([
            { role: 'user', content: prompt }
          ], process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct', 0.5, 300);
        } else if (anthropicClient) {
          const response = await anthropicClient.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 300,
            messages: [{ role: 'user', content: prompt }]
          });
          briefingText = response.content[0].type === 'text' ? response.content[0].text : '';
        }
      } catch (err) {
        console.warn('AI Briefing generation failed, using mock generator.', err);
      }
    }

    if (!briefingText) {
      // Offline / fallback text generator
      const taskCount = activeTasks.length;
      const meetingCount = todayRecurring.length;
      briefingText = `Good morning, Keshav! Today you have ${taskCount} active tasks to focus on${
        highPriorityTasks.length > 0 ? `, including ${highPriorityTasks.length} high-priority items` : ''
      }. You also have ${meetingCount} recurring meetings scheduled. Make sure to block out some solid deep work time in your calendar and keep your focus streak going!`;
    }

    return res.json({ briefing: briefingText.trim() });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
