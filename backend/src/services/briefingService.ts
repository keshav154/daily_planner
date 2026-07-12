import { Task, User, AgentRun, AgentMemory } from '../models/Schemas';
import RecurringEvent from '../models/RecurringEvent';
import { queryNvidiaNim } from '../config/nvidia';
import Anthropic from '@anthropic-ai/sdk';

const getAnthropicClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return null;
  }
  return new Anthropic({ apiKey });
};

export interface DailyBriefingDigest {
  agentActions: string[];
  pendingSuggestionsCount: number;
  newInsightsCount: number;
}

export interface DailyBriefing {
  briefing: string;
  digest: DailyBriefingDigest;
}

/**
 * Builds the morning briefing text and "while you were away" digest.
 * Shared by the HTTP route (GET /api/briefing/daily) and the Telegram
 * notifier, which sends the exact same content proactively instead of
 * waiting for the user to open the app.
 */
export async function buildDailyBriefing(userId: string): Promise<DailyBriefing> {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const todayStr = new Date().toISOString().split('T')[0];
  const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);

  const tasks = await Task.find({
    userId,
    $or: [
      { dueDate: { $gte: startOfDay, $lte: endOfDay } },
      { dueDate: { $lt: startOfDay }, status: { $in: ['todo', 'in-progress'] } }
    ]
  });

  const recurringEvents = await RecurringEvent.find({ userId, isActive: true });

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

  // "While you were away" digest: news (what happened) is scoped to *today*,
  // not a rolling 24h window — a rolling window means opening the briefing
  // twice in the same day re-reports yesterday evening's actions as if they
  // just happened, since they're still within the trailing 24 hours.
  const recentRuns = await AgentRun.find({ userId, createdAt: { $gte: startOfDay } })
    .sort({ createdAt: -1 })
    .limit(30);

  const agentActions = recentRuns
    .flatMap(r => r.executedActions || [])
    .filter(a => a && !a.startsWith('[') && !a.startsWith('{') && !a.startsWith('Skipped') && a !== 'No matching tasks.')
    .slice(0, 8);
  const newInsightsCount = await AgentMemory.countDocuments({
    userId,
    createdAt: { $gte: startOfDay },
    feedback: 'none',
    source: { $in: ['reflection', 'autonomous', 'consolidation'] }
  });

  // Pending suggestions are a *backlog* count (how many things are currently
  // awaiting review), not news — scoping this to today only would under-report
  // older still-unreviewed suggestions. Bounded to 90 days for query sanity,
  // not as a "since when" cutoff.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const runsWithPending = await AgentRun.find({ userId, createdAt: { $gte: ninetyDaysAgo }, 'actionsTaken.status': 'pending' })
    .select('actionsTaken')
    .lean();
  const pendingSuggestionsCount = runsWithPending.reduce(
    (acc, r) => acc + r.actionsTaken.filter(a => a.status === 'pending').length,
    0
  );

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
- Actions the AI agent already took in the last 24h: ${agentActions.join('; ') || 'None'}
- Agent suggestions awaiting the user's review: ${pendingSuggestionsCount}

Keep the tone encouraging, high-agency, professional, and productivity-focused. If the agent took actions overnight, mention it briefly so the user knows their second brain has been working. Return ONLY the plain text briefing paragraph. Do not include markdown headers or greetings.`;

    try {
      if (isNvidiaActive) {
        try {
          briefingText = await queryNvidiaNim([
            { role: 'user', content: prompt }
          ], process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct', 0.5, 300);
        } catch (nvidiaErr) {
          console.warn('NVIDIA NIM API call failed, attempting Anthropic fallback:', nvidiaErr);
          if (anthropicClient) {
            const response = await anthropicClient.messages.create({
              model: 'claude-sonnet-5',
              max_tokens: 300,
              messages: [{ role: 'user', content: prompt }]
            });
            briefingText = response.content[0].type === 'text' ? response.content[0].text : '';
          } else {
            throw nvidiaErr;
          }
        }
      } else if (anthropicClient) {
        const response = await anthropicClient.messages.create({
          model: 'claude-sonnet-5',
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
    const taskCount = activeTasks.length;
    const meetingCount = todayRecurring.length;
    briefingText = `Good morning, Keshav! Today you have ${taskCount} active tasks to focus on${
      highPriorityTasks.length > 0 ? `, including ${highPriorityTasks.length} high-priority items` : ''
    }. You also have ${meetingCount} recurring meetings scheduled. Make sure to block out some solid deep work time in your calendar and keep your focus streak going!`;
  }

  return {
    briefing: briefingText.trim(),
    digest: {
      agentActions,
      pendingSuggestionsCount,
      newInsightsCount
    }
  };
}
