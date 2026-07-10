import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Task, Log, User, AgentMemory } from '../models/Schemas';
import { AuthRequest } from '../middleware/auth';
import Habit from '../models/Habit';
import { queryNvidiaNim } from '../config/nvidia';
import Anthropic from '@anthropic-ai/sdk';
import type { BurnoutStatusResponse, WeeklyReviewResponse } from '../types/apiContracts';

// ─── Shared AI Client Helpers ─────────────────────────────────────────────────

const getAnthropicClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') return null;
  return new Anthropic({ apiKey });
};

/**
 * Query active LLM (NVIDIA NIM first, then Anthropic). Returns raw string or null.
 */
async function queryLLM(prompt: string, maxTokens = 800): Promise<string | null> {
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
  const anthropicClient = getAnthropicClient();

  if (!isNvidiaActive && !anthropicClient) return null;

  if (isNvidiaActive) {
    try {
      // Every prompt through this helper asks for "Return ONLY valid JSON" —
      // jsonMode constrains the decoder so malformed JSON can't come back,
      // instead of relying on parseAiJson's regex-based repair.
      return await queryNvidiaNim(
        [{ role: 'user', content: prompt }],
        process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct',
        0.3,
        maxTokens,
        true
      );
    } catch (err) {
      console.warn('[aiRoutes] NVIDIA NIM query failed, attempting Anthropic fallback:', (err as any)?.message);
      if (anthropicClient) {
        try {
          const response = await anthropicClient.messages.create({
            model: 'claude-sonnet-5',
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }]
          });
          return response.content[0].type === 'text' ? response.content[0].text : null;
        } catch (anthropicErr) {
          console.error('[aiRoutes] Anthropic fallback query failed:', (anthropicErr as any)?.message);
        }
      }
    }
  } else if (anthropicClient) {
    try {
      const response = await anthropicClient.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      });
      return response.content[0].type === 'text' ? response.content[0].text : null;
    } catch (anthropicErr) {
      console.error('[aiRoutes] Anthropic query failed:', (anthropicErr as any)?.message);
    }
  }
  return null;
}

/**
 * Safely parse JSON from AI response – strips markdown code fences if present.
 */
function parseAiJson<T>(raw: string): T | null {
  try {
    // Strip ```json ... ``` or ``` ... ``` wrappers
    const stripped = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    return JSON.parse(stripped) as T;
  } catch {
    // Try to extract the first JSON array or object from the string
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    const objMatch = raw.match(/\{[\s\S]*\}/);
    const candidate = arrMatch?.[0] ?? objMatch?.[0];
    if (candidate) {
      try { return JSON.parse(candidate) as T; } catch { /* fall through */ }
    }
    return null;
  }
}

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /decompose-task
// ─────────────────────────────────────────────────────────────────────────────
router.post('/decompose-task', async (req: Request, res: Response) => {
  try {
    const { goal } = req.body as { goal: string };
    if (!goal) return res.status(400).json({ error: 'goal is required' });

    const prompt = `You are a productivity expert. Break the following goal into 3-7 actionable subtasks.
Goal: "${goal}"

Return ONLY valid JSON with no explanation or markdown, as an object with a "tasks" array:
{
  "tasks": [
    {
      "title": "task title",
      "estimatedTime": 30,
      "priority": "high|medium|low",
      "category": "Work|Personal|Health|Learning",
      "subtasks": ["optional subtask 1", "optional subtask 2"]
    }
  ]
}`;

    const raw = await queryLLM(prompt, 600);
    if (raw) {
      const parsed = parseAiJson<any>(raw);
      const parsedTasks = Array.isArray(parsed) ? parsed : parsed?.tasks;
      if (Array.isArray(parsedTasks)) {
        return res.json({ tasks: parsedTasks });
      }
    }

    // Offline fallback – 3 generic tasks
    const words = goal.split(' ').slice(0, 4).join(' ');
    return res.json({
      tasks: [
        { title: `Research and plan: ${words}`, estimatedTime: 30, priority: 'high', category: 'Work', subtasks: [] },
        { title: `Execute core work: ${words}`, estimatedTime: 60, priority: 'high', category: 'Work', subtasks: [] },
        { title: `Review and wrap up: ${words}`, estimatedTime: 20, priority: 'medium', category: 'Work', subtasks: [] }
      ]
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /from-meeting
// ─────────────────────────────────────────────────────────────────────────────
router.post('/from-meeting', async (req: Request, res: Response) => {
  try {
    const { notes } = req.body as { notes: string };
    if (!notes) return res.status(400).json({ error: 'notes is required' });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDateStr = tomorrow.toISOString().split('T')[0];

    const prompt = `You are a meeting assistant. Extract all action items from the following meeting notes.
Meeting Notes:
"""
${notes}
"""

Return ONLY valid JSON as an object with a "tasks" array:
{
  "tasks": [
    {
      "title": "action item title",
      "priority": "high|medium|low",
      "estimatedTime": 30,
      "dueDate": "${dueDateStr}",
      "category": "Work|Personal|Health|Learning"
    }
  ]
}`;

    const raw = await queryLLM(prompt, 600);
    if (raw) {
      const parsed = parseAiJson<any>(raw);
      const parsedTasks = Array.isArray(parsed) ? parsed : parsed?.tasks;
      if (Array.isArray(parsedTasks)) {
        return res.json({ tasks: parsedTasks });
      }
    }

    // Offline fallback – extract lines starting with common action verbs
    const actionVerbs = /^(review|update|send|schedule|create|write|fix|check|follow|prepare|discuss|share|complete|finish|implement|research|analyze|call|email|meet)/i;
    const lines = notes.split('\n').map(l => l.trim()).filter(l => actionVerbs.test(l));
    const tasks = lines.length > 0
      ? lines.map(line => ({
          title: line.replace(/^[-*•]\s*/, ''),
          priority: 'medium',
          estimatedTime: 30,
          dueDate: dueDateStr,
          category: 'Work'
        }))
      : [{ title: 'Follow up on meeting items', priority: 'medium', estimatedTime: 30, dueDate: dueDateStr, category: 'Work' }];

    return res.json({ tasks });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /smart-schedule
// ─────────────────────────────────────────────────────────────────────────────
router.get('/smart-schedule', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const todayStr = new Date().toISOString().split('T')[0];
    const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);

    // Fetch today's active tasks
    const tasks = await Task.find({
      userId,
      status: { $in: ['todo', 'in-progress'] },
      dueDate: { $gte: startOfDay, $lte: endOfDay }
    });

    // Fetch last 30 logs to find hourly completion patterns
    const logs = await Log.find({ userId }).sort({ timestamp: -1 }).limit(30);

    // Build hourly map
    const hourlyCount: Record<number, number> = {};
    for (const log of logs) {
      const hr = new Date(log.timestamp).getHours();
      hourlyCount[hr] = (hourlyCount[hr] || 0) + 1;
    }
    const peakHour = Object.entries(hourlyCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '9';

    const taskSummary = tasks.map(t => ({
      id: t._id.toString(),
      title: t.title,
      priority: t.priority,
      estimatedTime: t.estimatedTime,
      category: t.category
    }));

    const prompt = `You are a scheduling assistant. Propose an optimal ordering and time blocks for these tasks.
Peak productive hour based on historical logs: ${peakHour}:00
Tasks:
${JSON.stringify(taskSummary, null, 2)}

Return ONLY valid JSON:
{
  "orderedTaskIds": ["id1", "id2"],
  "rationale": "brief explanation",
  "scheduleBlocks": [
    { "taskId": "id1", "suggestedStartTime": "09:00", "suggestedEndTime": "09:30" }
  ]
}`;

    const raw = await queryLLM(prompt, 800);
    if (raw) {
      const parsed = parseAiJson<any>(raw);
      if (parsed?.orderedTaskIds) {
        return res.json(parsed);
      }
    }

    // Offline fallback – sort by priority weight then estimatedTime asc
    const priorityWeight = { high: 3, medium: 2, low: 1 };
    const sorted = [...tasks].sort((a, b) => {
      const pw = (priorityWeight[b.priority] || 1) - (priorityWeight[a.priority] || 1);
      if (pw !== 0) return pw;
      return (a.estimatedTime || 0) - (b.estimatedTime || 0);
    });

    let cursor = 9 * 60; // start at 09:00 in minutes
    const scheduleBlocks = sorted.map(t => {
      const start = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`;
      cursor += (t.estimatedTime || 30);
      const end = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`;
      return { taskId: t._id.toString(), suggestedStartTime: start, suggestedEndTime: end };
    });

    return res.json({
      orderedTaskIds: sorted.map(t => t._id.toString()),
      rationale: 'Tasks ordered by priority (high → low), then by shortest estimated time first.',
      scheduleBlocks
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /burnout-status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/burnout-status', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Fetch last 7 days of logs
    const logs = await Log.find({ userId, timestamp: { $gte: sevenDaysAgo } });

    // Calculate stats
    const totalMinutesThisWeek = logs.reduce((acc, l) => acc + (l.duration || 0), 0);
    const daysWithLogsSet = new Set(logs.map(l => new Date(l.timestamp).toISOString().split('T')[0]));
    const daysWithLogs = daysWithLogsSet.size;
    const dailyAverageMinutes = daysWithLogs > 0 ? Math.round(totalMinutesThisWeek / daysWithLogs) : 0;

    // Count overdue tasks
    const today = new Date(`${now.toISOString().split('T')[0]}T00:00:00.000Z`);
    const overdueTasks = await Task.countDocuments({
      userId,
      dueDate: { $lt: today },
      status: { $in: ['todo', 'in-progress'] }
    });

    const stats = { totalMinutesThisWeek, dailyAverageMinutes, daysWithLogs, overdueTasks };

    const prompt = `You are a wellness and productivity coach. Assess the user's burnout risk based on these statistics:
- Total work minutes this week: ${totalMinutesThisWeek} (${Math.round(totalMinutesThisWeek / 60 * 10) / 10}h)
- Daily average: ${dailyAverageMinutes} min/day
- Days with logged activity: ${daysWithLogs}/7
- Overdue tasks: ${overdueTasks}

Return ONLY valid JSON:
{
  "riskLevel": "low|medium|high",
  "message": "brief empathetic message about their situation",
  "advice": "one concrete actionable suggestion"
}`;

    // Typed against BurnoutStatusResponse so a field rename here breaks the
    // build instead of silently producing a blank value in BurnoutAlert.tsx.
    const raw = await queryLLM(prompt, 400);
    if (raw) {
      const parsed = parseAiJson<any>(raw);
      if (parsed?.riskLevel) {
        const response: BurnoutStatusResponse = {
          riskLevel: parsed.riskLevel,
          message: parsed.message,
          advice: parsed.advice,
          totalMinutesThisWeek,
          overdueTasksCount: overdueTasks,
          stats
        };
        return res.json(response);
      }
    }

    // Offline fallback rules
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    let message = 'Your workload looks healthy. Keep it up!';
    let advice = 'Take short breaks every 90 minutes to maintain focus.';

    if (totalMinutesThisWeek > 2400 || overdueTasks > 10) {
      riskLevel = 'high';
      message = 'Your workload is very high. You may be approaching burnout.';
      advice = 'Block tomorrow morning as protected recovery time and prioritize ruthlessly.';
    } else if (totalMinutesThisWeek > 1800 || overdueTasks > 5) {
      riskLevel = 'medium';
      message = 'You\'re working hard but the pace is becoming unsustainable.';
      advice = 'Try to defer or delegate 2-3 lower priority tasks this week.';
    }

    const response: BurnoutStatusResponse = {
      riskLevel,
      message,
      advice,
      totalMinutesThisWeek,
      overdueTasksCount: overdueTasks,
      stats
    };
    return res.json(response);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /estimation-coach
// ─────────────────────────────────────────────────────────────────────────────
router.get('/estimation-coach', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // Fetch last 30 completed tasks with both time fields
    const tasks = await Task.find({
      userId,
      status: 'done',
      actualTime: { $gt: 0 },
      estimatedTime: { $gt: 0 }
    }).sort({ updatedAt: -1 }).limit(30);

    if (tasks.length === 0) {
      return res.json({
        categories: [],
        overallRatio: 1,
        insight: 'Not enough data yet. Complete tasks with time tracking to get insights.',
        tip: 'Start estimating your tasks in minutes before beginning them.'
      });
    }

    // Aggregate per category
    const categoryMap: Record<string, { totalEstimated: number; totalActual: number; count: number }> = {};
    for (const t of tasks) {
      const cat = t.category || 'Uncategorized';
      if (!categoryMap[cat]) categoryMap[cat] = { totalEstimated: 0, totalActual: 0, count: 0 };
      categoryMap[cat].totalEstimated += t.estimatedTime;
      categoryMap[cat].totalActual += t.actualTime;
      categoryMap[cat].count++;
    }

    const categories = Object.entries(categoryMap).map(([category, data]) => ({
      category,
      avgEstimated: Math.round(data.totalEstimated / data.count),
      avgActual: Math.round(data.totalActual / data.count),
      accuracyPct: Math.round((data.totalEstimated / data.totalActual) * 100),
      taskCount: data.count
    }));

    const totalEstimated = tasks.reduce((acc, t) => acc + t.estimatedTime, 0);
    const totalActual = tasks.reduce((acc, t) => acc + t.actualTime, 0);
    const overallRatio = Math.round((totalActual / totalEstimated) * 100) / 100;

    const prompt = `You are a time management coach. Analyze the user's estimation accuracy data and provide personalized advice.
Overall ratio (actual/estimated): ${overallRatio} (>1 means they underestimate, <1 means they overestimate)
Per-category breakdown:
${JSON.stringify(categories, null, 2)}

Return ONLY valid JSON:
{
  "insight": "specific observation about their estimation patterns",
  "tip": "one concrete technique to improve estimation accuracy"
}`;

    const raw = await queryLLM(prompt, 400);
    if (raw) {
      const parsed = parseAiJson<any>(raw);
      if (parsed?.insight) {
        return res.json({ categories, overallRatio, ...parsed });
      }
    }

    // Offline fallback
    let insight: string;
    let tip: string;
    if (overallRatio > 1.3) {
      const pct = Math.round((overallRatio - 1) * 100);
      insight = `You tend to underestimate by ${pct}% on average.`;
      tip = 'Try multiplying your estimates by 1.3 as a buffer, especially for complex tasks.';
    } else if (overallRatio < 0.7) {
      const pct = Math.round((1 - overallRatio) * 100);
      insight = `You tend to overestimate by ${pct}% on average.`;
      tip = 'Your estimates are conservative – great for planning! Consider scheduling more tasks per day.';
    } else {
      insight = 'Your time estimates are fairly accurate. Great self-awareness!';
      tip = 'Keep tracking actual time to maintain this calibration.';
    }

    return res.json({ categories, overallRatio, insight, tip });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /focus-recommendation
// ─────────────────────────────────────────────────────────────────────────────
router.get('/focus-recommendation', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // Fetch last 30 logs
    const logs = await Log.find({ userId }).sort({ timestamp: -1 }).limit(30);

    // Group by hour
    const hourMap: Record<number, { count: number; totalDuration: number }> = {};
    for (const log of logs) {
      const hr = new Date(log.timestamp).getHours();
      if (!hourMap[hr]) hourMap[hr] = { count: 0, totalDuration: 0 };
      hourMap[hr].count++;
      hourMap[hr].totalDuration += log.duration || 0;
    }

    const hourlyData = Object.entries(hourMap).map(([hour, data]) => ({
      hour: Number(hour),
      sessionCount: data.count,
      avgDuration: data.count > 0 ? Math.round(data.totalDuration / data.count) : 0
    })).sort((a, b) => a.hour - b.hour);

    // Count completed pomodoros (duration >= 15 min)
    const pomodoroCount = logs.filter(l => (l.duration || 0) >= 15).length;

    const hourLabels: Record<number, string> = {
      6: '6 AM', 7: '7 AM', 8: '8 AM', 9: '9 AM', 10: '10 AM', 11: '11 AM',
      12: '12 PM', 13: '1 PM', 14: '2 PM', 15: '3 PM', 16: '4 PM', 17: '5 PM',
      18: '6 PM', 19: '7 PM', 20: '8 PM', 21: '9 PM', 22: '10 PM'
    };

    const prompt = `You are a focus and productivity coach. Analyze when this user is most productive and recommend an optimal focus time.
Hourly session data (hour: number of sessions, avg duration):
${JSON.stringify(hourlyData, null, 2)}
Total completed focus sessions (≥15 min): ${pomodoroCount}

Return ONLY valid JSON:
{
  "bestHour": 9,
  "bestHourLabel": "9 AM",
  "recommendedSound": "lo-fi beats|nature sounds|white noise|binaural beats|silence",
  "reasoning": "brief explanation of why this hour and sound"
}`;

    const raw = await queryLLM(prompt, 400);
    if (raw) {
      const parsed = parseAiJson<any>(raw);
      if (parsed?.bestHour !== undefined) {
        return res.json({ ...parsed, hourlyData });
      }
    }

    // Offline fallback – pick hour with highest session count
    const bestEntry = hourlyData.sort((a, b) => b.sessionCount - a.sessionCount)[0] ?? { hour: 9, sessionCount: 0, avgDuration: 0 };
    const bestHour = bestEntry.hour;
    return res.json({
      bestHour,
      bestHourLabel: hourLabels[bestHour] ?? `${bestHour}:00`,
      recommendedSound: 'lo-fi beats',
      reasoning: `You have the most focus sessions at ${hourLabels[bestHour] ?? `${bestHour}:00`} based on your logs.`,
      hourlyData
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /habit-coaching
// ─────────────────────────────────────────────────────────────────────────────
router.get('/habit-coaching', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const habits = await Habit.find({ userId, isActive: true });

    if (habits.length === 0) {
      return res.json({ coaching: [] });
    }

    // Compute missed days in last 7 days for each habit
    const today = new Date();
    const last7Days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      last7Days.push(d.toISOString().split('T')[0]);
    }

    const habitStats = habits.map(h => {
      const completionMap = new Map(h.completions.map(c => [c.date, c.completed]));
      const missedDaysInLast7 = last7Days.filter(day => {
        const val = completionMap.get(day);
        return val === false || val === undefined;
      }).length;
      return {
        habitId: h._id.toString(),
        habitTitle: h.title,
        currentStreak: h.currentStreak,
        missedDaysInLast7
      };
    });

    const habitsNeedingCoaching = habitStats.filter(h => h.missedDaysInLast7 >= 2);

    if (habitsNeedingCoaching.length === 0) {
      return res.json({ coaching: [] });
    }

    const prompt = `You are a habit coach. Provide motivating coaching messages for habits the user has been missing.
Habits needing attention:
${JSON.stringify(habitsNeedingCoaching, null, 2)}

Return ONLY valid JSON:
{
  "coaching": [
    {
      "habitId": "...",
      "habitTitle": "...",
      "message": "empathetic personalized message",
      "tip": "one concrete tip to get back on track"
    }
  ]
}`;

    const raw = await queryLLM(prompt, 600);
    if (raw) {
      const parsed = parseAiJson<any>(raw);
      if (parsed?.coaching && Array.isArray(parsed.coaching)) {
        return res.json(parsed);
      }
    }

    // Offline fallback
    const coaching = habitsNeedingCoaching.map(h => ({
      habitId: h.habitId,
      habitTitle: h.habitTitle,
      message: `You've missed "${h.habitTitle}" ${h.missedDaysInLast7} days this week. Don't break the chain!`,
      tip: `Try linking "${h.habitTitle}" to an existing routine you already do every day.`
    }));

    return res.json({ coaching });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /smart-reschedule
// ─────────────────────────────────────────────────────────────────────────────
router.post('/smart-reschedule', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { taskId } = req.body as { taskId: string };
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });

    const task = await Task.findOne({ _id: taskId, userId });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const now = new Date();
    const dueDate = new Date(task.dueDate);
    const dayOverdue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Fetch logs for this task
    const taskLogs = await Log.find({ userId, taskId: new mongoose.Types.ObjectId(taskId) });
    const totalWorkedMinutes = taskLogs.reduce((acc, l) => acc + (l.duration || 0), 0);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const prompt = `You are a task management advisor. Decide whether this overdue task should be rescheduled, broken into subtasks, or archived.
Task: "${task.title}"
Days overdue: ${dayOverdue}
Estimated time: ${task.estimatedTime} minutes
Actual time worked: ${totalWorkedMinutes} minutes
Priority: ${task.priority}
Category: ${task.category}

Return ONLY valid JSON:
{
  "recommendation": "reschedule|break_down|archive",
  "reason": "clear explanation for the recommendation",
  "suggestedDate": "${tomorrowStr}"
}`;

    const raw = await queryLLM(prompt, 400);
    if (raw) {
      const parsed = parseAiJson<any>(raw);
      if (parsed?.recommendation) {
        return res.json({ ...parsed, taskTitle: task.title });
      }
    }

    // Offline fallback rules
    let recommendation: 'reschedule' | 'break_down' | 'archive';
    let reason: string;
    let suggestedDate: string | undefined;

    if (dayOverdue <= 3) {
      recommendation = 'reschedule';
      reason = `Task is only ${dayOverdue} day(s) overdue. Reschedule to tomorrow to get back on track.`;
      suggestedDate = tomorrowStr;
    } else if (dayOverdue <= 7 && (task.estimatedTime || 0) >= 60) {
      recommendation = 'break_down';
      reason = `Task is ${dayOverdue} days overdue and estimated at ${task.estimatedTime} minutes. Breaking it into smaller pieces may make it easier to complete.`;
    } else {
      recommendation = 'archive';
      reason = `Task is ${dayOverdue} days overdue. Consider archiving if it's no longer relevant.`;
    }

    return res.json({ recommendation, reason, suggestedDate, taskTitle: task.title });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /weekly-review
// ─────────────────────────────────────────────────────────────────────────────
router.get('/weekly-review', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Fetch user for XP
    const user = await User.findById(userId);

    // Fetch tasks updated in last 7 days
    const tasks = await Task.find({ userId, updatedAt: { $gte: sevenDaysAgo } });
    const doneTasks = tasks.filter(t => t.status === 'done');
    const completionRate = tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0;

    // Top categories by completion count
    const categoryMap: Record<string, number> = {};
    for (const t of doneTasks) {
      const cat = t.category || 'Uncategorized';
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    }
    const topCategories = Object.entries(categoryMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    // Total focus minutes from logs this week
    const logs = await Log.find({ userId, timestamp: { $gte: sevenDaysAgo } });
    const totalFocusMinutes = logs.reduce((acc, l) => acc + (l.duration || 0), 0);

    // Habit stats
    const habits = await Habit.find({ userId, isActive: true });
    const last7Days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      last7Days.push(d.toISOString().split('T')[0]);
    }

    const habitStats = habits.map(h => {
      const completionMap = new Map(h.completions.map(c => [c.date, c.completed]));
      const completedDays = last7Days.filter(day => completionMap.get(day) === true).length;
      return {
        title: h.title,
        completedDays,
        completionRate7d: Math.round((completedDays / 7) * 100)
      };
    });

    const prompt = `You are a weekly productivity reviewer. Generate a brief weekly summary and one improvement suggestion.
Stats for this week:
- Tasks completed: ${doneTasks.length} / ${tasks.length} (${completionRate}% completion rate)
- Total focus time: ${Math.round(totalFocusMinutes / 60 * 10) / 10} hours
- Top categories: ${topCategories.map(c => `${c.category} (${c.count} done)`).join(', ') || 'none'}
- User XP: ${user?.xp || 0}, Level: ${user?.level || 1}
- Active habits: ${habits.length}, avg 7-day completion: ${habitStats.length > 0 ? Math.round(habitStats.reduce((acc, h) => acc + h.completionRate7d, 0) / habitStats.length) : 0}%

Return ONLY valid JSON:
{
  "summary": "2-3 sentence summary of the week",
  "improvement": "one specific, actionable improvement for next week",
  "highlights": ["highlight 1", "highlight 2", "highlight 3"]
}`;

    // WeeklyReviewView.tsx expects: totalFocusHours (not totalFocusMinutes),
    // tasksCompleted, currentLevel (not level), categories (with name/percentage,
    // not topCategories with category/count), and habitStats with name/completionRate
    // (not title/completionRate7d). Shape the response to that contract directly.
    const totalFocusHours = Math.round((totalFocusMinutes / 60) * 10) / 10;
    const categories = topCategories.map(c => ({
      name: c.category,
      count: c.count,
      percentage: doneTasks.length > 0 ? Math.round((c.count / doneTasks.length) * 100) : 0
    }));
    const shapedHabitStats = habitStats.map(h => ({
      name: h.title,
      completionRate: h.completionRate7d
    }));

    // Typed against WeeklyReviewResponse so a field rename here breaks the
    // build instead of silently rendering "N/A"/"0h" in WeeklyReviewView.tsx.
    const raw = await queryLLM(prompt, 600);
    if (raw) {
      const parsed = parseAiJson<any>(raw);
      if (parsed?.summary) {
        const response: WeeklyReviewResponse = {
          completionRate,
          categories,
          totalFocusHours,
          tasksCompleted: doneTasks.length,
          currentLevel: user?.level || 1,
          habitStats: shapedHabitStats,
          summary: parsed.summary,
          improvement: parsed.improvement,
          highlights: parsed.highlights || []
        };
        return res.json(response);
      }
    }

    // Offline fallback
    let summary: string;
    let improvement: string;
    const highlights: string[] = [];

    if (completionRate >= 80) {
      summary = `Excellent week! You completed ${doneTasks.length} of ${tasks.length} tasks (${completionRate}%). Your focus time was ${totalFocusHours} hours.`;
      improvement = 'Consider adding stretch goals next week to keep growing.';
      highlights.push('High completion rate this week!');
    } else if (completionRate >= 50) {
      summary = `Solid week with ${completionRate}% task completion. You logged ${totalFocusHours} hours of focus time.`;
      improvement = 'Try time-blocking your calendar to protect deep work hours.';
      highlights.push('Good progress on tasks');
    } else {
      summary = `This week had some challenges with ${completionRate}% task completion. Review what held you back to improve next week.`;
      improvement = 'Reduce your task list — commit to fewer, higher-impact tasks next week.';
      highlights.push('Room for improvement next week');
    }

    if (topCategories.length > 0) highlights.push(`Most productive area: ${topCategories[0].category}`);
    if (totalFocusMinutes > 0) highlights.push(`${totalFocusHours}h total focus time logged`);

    const response: WeeklyReviewResponse = {
      completionRate,
      categories,
      totalFocusHours,
      tasksCompleted: doneTasks.length,
      currentLevel: user?.level || 1,
      habitStats: shapedHabitStats,
      summary,
      improvement,
      highlights
    };
    return res.json(response);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /parse-clipboard
// ─────────────────────────────────────────────────────────────────────────────
router.post('/parse-clipboard', async (req: Request, res: Response) => {
  try {
    const { text } = req.body as { text: string };
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text content is required' });
    }

    const authReq = req as any;
    const userId = authReq.userId;

    const prompt = `You are an AI task and reference extraction assistant. The user has copied raw text from their SRE work environment (Jira ticket details, terminal logs, Slack chats, code blocks, or setup guides).
Analyze the following text and extract:
1. Actionable tasks.
2. Technical commands, runbooks, architectural facts, or incident insights that are valuable for long-term reference.

Text to analyze:
"""
${text}
"""

Guidelines:
- Actionable Tasks:
  - Extract any specific TODOs or action items.
  - If Jira tickets are mentioned (e.g. "DEV-204" or "[PRJ-99]"), prefix the task title with the Jira key: e.g. "[DEV-204] Fix login crash".
  - Estimate task duration in minutes (estimatedTime). Story points can be mapped: 1pt = 60m, 2pt = 120m, etc. Default to 60.
  - Deduce priority (high|medium|low) and category (Work|Personal|Health|Learning).
  - Extract subtasks if the task involves multiple steps.
- Technical References & Commands (Memories):
  - Extract specific terminal commands (e.g. kubectl commands, docker runs, git commands), environment setups, architectural configuration notes, or post-mortem incident facts.
  - Keep the content concise but detailed enough to be useful for copy-pasting or querying later.
  - Group them under the category "Tech Reference" or "SRE Command".

Format your output strictly as a JSON object containing two keys: "tasks" (array of task objects) and "memories" (array of reference/command objects):
{
  "tasks": [
    {
      "title": "task title",
      "description": "short description or ticket summary",
      "priority": "high|medium|low",
      "estimatedTime": 60,
      "category": "Work",
      "subtasks": ["subtask 1", "subtask 2"]
    }
  ],
  "memories": [
    {
      "content": "Description of the SRE command or configuration details, including exact syntax (e.g., 'kubectl get pods -n kube-system')",
      "category": "Tech Reference|SRE Command",
      "importance": 6
    }
  ]
}`;

    const raw = await queryLLM(prompt, 1200);
    let tasks: any[] = [];
    let savedMemories: any[] = [];

    if (raw) {
      const parsed = parseAiJson<{ tasks?: any[]; memories?: any[] }>(raw);
      if (parsed) {
        tasks = parsed.tasks || [];
        const extractedMemories = parsed.memories || [];

        // Save any extracted memories autonomously
        if (extractedMemories.length > 0 && userId) {
          for (const m of extractedMemories) {
            const memory = new AgentMemory({
              userId,
              type: 'preference',
              content: m.content,
              category: m.category || 'Tech Reference',
              source: 'autonomous',
              importance: m.importance || 6,
              feedback: 'accepted',
              lastAccessedAt: new Date()
            });
            await memory.save();
            savedMemories.push(memory);
          }
        }
      }
    }

    // Offline fallback if LLM query failed or tasks were empty
    if (tasks.length === 0) {
      const jiraPattern = /([A-Z]{2,10}-\d+)/gi;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);

      for (const line of lines) {
        const jiraMatch = line.match(jiraPattern);
        if (jiraMatch) {
          tasks.push({
            title: line.replace(/^[-*•]\s*/, ''),
            description: `Extracted from Jira ticket mention: ${jiraMatch.join(', ')}`,
            priority: 'high',
            estimatedTime: 60,
            category: 'Work',
            subtasks: []
          });
        } else if (/^[-*•]/.test(line)) {
          tasks.push({
            title: line.replace(/^[-*•]\s*/, ''),
            description: 'Extracted list item.',
            priority: 'medium',
            estimatedTime: 30,
            category: 'Work',
            subtasks: []
          });
        }
      }
    }

    // Default task if nothing was matched at all
    if (tasks.length === 0) {
      tasks.push({
        title: 'Review pasted workspace clipboard items',
        description: 'Check pasted notes for action items.',
        priority: 'medium',
        estimatedTime: 30,
        category: 'Work',
        subtasks: []
      });
    }

    return res.json({ tasks, memories: savedMemories });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /daily-standup
router.get('/daily-standup', async (req: Request, res: Response) => {
  try {
    const authReq = req as any;
    const userId = authReq.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. Fetch completed tasks/logs from yesterday (done or logged in the last 24h)
    const completedTasks = await Task.find({
      userId,
      status: 'done',
      updatedAt: { $gte: yesterday }
    });

    const completedLogs = await Log.find({
      userId,
      timestamp: { $gte: yesterday }
    });

    // 2. Fetch planned tasks for today
    const todayStr = now.toISOString().split('T')[0];
    const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);
    const todayTasks = await Task.find({
      userId,
      status: { $in: ['todo', 'in-progress'] },
      $or: [
        { dueDate: { $gte: startOfDay, $lte: endOfDay } },
        { dueDate: { $lt: startOfDay } } // overdue items
      ]
    });

    // 3. Fetch active blockers (overdue high priority tasks)
    const blockers = todayTasks.filter(t => t.priority === 'high' && new Date(t.dueDate) < startOfDay);

    // Prompt LLM to format a standup
    const context = {
      completedTasks: completedTasks.map(t => t.title),
      completedLogs: completedLogs.map(l => l.title),
      todayTasks: todayTasks.map(t => t.title),
      blockers: blockers.map(t => t.title)
    };

    const prompt = `You are an expert SRE daily planner assistant. Write a clean, professional, and well-structured Slack/Teams daily standup status message based on this work context:
${JSON.stringify(context, null, 2)}

Format guidelines:
- Use clear bullet points and simple emojis (e.g. ✅ Yesterday, 🚀 Today, ⚠️ Blockers).
- Keep it concise, professional, and easy to read.
- If blockers are empty, say "None." under Blockers.
- Adjust phrasing so it sounds natural, like an engineer wrote it.

Output ONLY the formatted Markdown standup message text, no other greeting or wrap-up text.`;

    let standupText = '';
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    const isNvidiaActive = nvidiaKey && nvidiaKey !== 'your_nvidia_api_key_here';
    const client = getAnthropicClient();

    if (isNvidiaActive) {
      const response = await queryNvidiaNim([
        { role: 'user', content: prompt }
      ], process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct', 0.3, 800);
      standupText = response || '';
    } else if (client) {
      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      });
      standupText = response.content[0].type === 'text' ? response.content[0].text : '';
    }

    if (!standupText || !standupText.trim()) {
      // Offline fallback formatting
      const completedList = context.completedTasks.length > 0 ? context.completedTasks : ['No tasks logged.'];
      const todayList = context.todayTasks.length > 0 ? context.todayTasks : ['No tasks scheduled.'];
      const blockerList = context.blockers.length > 0 ? context.blockers : ['None.'];

      standupText = `*✅ Yesterday / Completed:*
${completedList.map(t => `- ${t}`).join('\n')}

*🚀 Today / Priorities:*
${todayList.map(t => `- ${t}`).join('\n')}

*⚠️ Blockers / Overdue:*
${blockerList.map(t => `- ${t}`).join('\n')}`;
    }

    res.json({ standup: standupText.trim() });
  } catch (error: any) {
    console.error('Standup generation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
