import mongoose from 'mongoose';
import { Task, AgentMemory } from '../models/Schemas';
import { Goal } from '../models/Goal';
import Habit from '../models/Habit';
import { getRelevantMemories, findSimilarMemory } from '../services/similarity';
import { computeTaskHistoryStats, formatStatsDigest } from '../services/taskHistory';
import { ToolSchema } from '../config/nvidia';

export interface ToolContext {
  userId: string;
  now: Date;
}

export interface ToolExecutionResult {
  result: string;
  /** Present when the tool call should also surface as a human-reviewable suggestion (e.g. bulk reorders). */
  suggestion?: {
    id: string;
    actionType: string;
    description: string;
    details: Record<string, any>;
  };
}

/**
 * Tool schemas in OpenAI/NIM function-calling format. Kept intentionally small
 * (flat args, single responsibility) since smaller open models are more
 * reliable at picking and filling one tool at a time than orchestrating many.
 */
export const AGENT_TOOLS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'get_tasks',
      description: 'Read the user\'s current tasks. Use this to check state before proposing changes.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['today', 'overdue', 'all'], description: 'Which tasks to fetch' }
        },
        required: ['scope']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_memories',
      description: 'Semantically search the user\'s learned memories/preferences relevant to a topic.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for' },
          limit: { type: 'number', description: 'Max results (default 5)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_task_history',
      description: 'Get aggregated statistics over the user\'s full task history: completion rates by category/priority/weekday, estimation accuracy, chronically overdue tasks, and peak focus hours. Use this to ground suggestions in the user\'s actual track record instead of guessing.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'History window in days (default 90, max 365)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a new task for the user (e.g. a catch-up task or missing prerequisite step).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          estimatedTime: { type: 'number', description: 'Minutes' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          category: { type: 'string' },
          goalId: { type: 'string', description: 'If this task is catching up on a specific goal\'s deadline, pass that goal\'s id so a repeat catch-up task isn\'t created for the same goal every time it\'s still behind.' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'schedule_time_block',
      description: 'Assign a focus time block (start time + duration) to an existing task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          startTime: { type: 'string', description: 'HH:MM 24h local time' },
          duration: { type: 'number', description: 'Minutes' }
        },
        required: ['taskId', 'startTime', 'duration']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'break_down_task',
      description: 'Split a large/vague task into smaller ordered subtasks.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          subtasks: { type: 'array', items: { type: 'string' } }
        },
        required: ['taskId', 'subtasks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'defer_task',
      description: 'Push a non-critical task\'s due date to tomorrow, e.g. to reduce overload or fatigue.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['taskId', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_nudge_memory',
      description: 'Create a short-lived alert memory shown to the user (e.g. a habit streak at risk). Expires in 24h.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          category: { type: 'string' },
          importance: { type: 'number', description: '1-10' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_goal_note',
      description: 'Append an observational progress note to one of the user\'s goals.',
      parameters: {
        type: 'object',
        properties: {
          goalId: { type: 'string' },
          note: { type: 'string' }
        },
        required: ['goalId', 'note']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_reorder',
      description: 'Propose reordering today\'s task list. This is disruptive, so it is queued for human approval instead of applied immediately.',
      parameters: {
        type: 'object',
        properties: {
          orderedTaskIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' }
        },
        required: ['orderedTaskIds', 'reason']
      }
    }
  }
];

/**
 * Extra tools only relevant to the interactive chat assistant, where the user
 * explicitly drives one intent at a time (delete a task, add a habit, create a
 * goal, complete a milestone) rather than the autonomous background loop,
 * which never needs to delete data or create new goals/habits on its own.
 */
const CHAT_ONLY_TOOLS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Permanently delete a task the user asked to remove.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' }
        },
        required: ['taskId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_habit',
      description: 'Create a new recurring habit to track.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          frequency: { type: 'string', enum: ['daily', 'weekdays', 'custom'] },
          icon: { type: 'string', description: 'A single emoji representing the habit' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_goal',
      description: 'Create a new long-term goal with default milestones.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          deadline: { type: 'string', description: 'ISO date, optional' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_milestone',
      description: 'Mark a milestone on one of the user\'s goals as completed.',
      parameters: {
        type: 'object',
        properties: {
          goalId: { type: 'string' },
          milestoneIndex: { type: 'number' }
        },
        required: ['goalId', 'milestoneIndex']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember_fact',
      description: 'Save a durable fact, preference, or commitment the user shared, so it is remembered in all future planning and conversations. Use whenever the user mentions something worth remembering long-term: deadlines and events ("my exam is Aug 20"), preferences ("I hate meetings before 11"), constraints ("I commute Tuesdays"), or explicit "remember that..." requests. Do NOT use for one-off chit-chat.',
      parameters: {
        type: 'object',
        properties: {
          fact: { type: 'string', description: 'The fact to remember, written in third person about the user, self-contained with absolute dates' },
          type: { type: 'string', enum: ['preference', 'general'], description: 'preference for likes/dislikes/rules, general for facts/events' },
          category: { type: 'string', description: 'e.g. scheduling, health, work, learning' },
          importance: { type: 'number', description: '1-10, how strongly this should influence future planning' }
        },
        required: ['fact']
      }
    }
  }
];

export const CHAT_TOOLS: ToolSchema[] = [...AGENT_TOOLS, ...CHAT_ONLY_TOOLS];

/**
 * Observe-only tool set for the AUTONOMOUS background loop. The user rejects
 * the agent's unsolicited task mutations 90-100% of the time (create_task 93%,
 * break_down 100%, reorder 94%, time_block 93%, nudge 100% — from its own
 * feedback mining), so the background loop no longer gets those tools at all.
 * It can read state and record goal notes, but it never creates, breaks down,
 * reschedules, or reorders tasks on its own — that only happens when the user
 * explicitly asks via chat/Telegram (which still use the full CHAT_TOOLS).
 */
export const OBSERVE_TOOLS: ToolSchema[] = AGENT_TOOLS.filter(t =>
  ['get_tasks', 'search_memories', 'get_task_history', 'add_goal_note'].includes(t.function.name)
);

/**
 * Tools that only observe state and change nothing. Their results feed the
 * model's next reasoning step but must NOT be reported as "actions taken" —
 * otherwise digests and activity feeds fill up with raw task-list JSON.
 */
export const READ_ONLY_TOOLS = new Set(['get_tasks', 'search_memories', 'get_task_history']);

function summarizeTasks(tasks: any[]): string {
  if (tasks.length === 0) return 'No matching tasks.';
  return JSON.stringify(
    tasks.map(t => ({
      id: t._id.toString(),
      title: t.title,
      status: t.status,
      priority: t.priority,
      estimatedTime: t.estimatedTime,
      dueDate: t.dueDate,
      timeBlock: t.timeBlock
    }))
  );
}

/**
 * Executes a single tool call against Mongo and returns a string result to
 * feed back into the model's next turn.
 */
export async function executeAgentTool(
  name: string,
  args: any,
  ctx: ToolContext
): Promise<ToolExecutionResult> {
  const { userId, now } = ctx;

  switch (name) {
    case 'get_tasks': {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      let query: any = { userId };
      if (args.scope === 'today') {
        query.dueDate = { $gte: startOfDay, $lte: endOfDay };
      } else if (args.scope === 'overdue') {
        query.dueDate = { $lt: startOfDay };
        query.status = { $in: ['todo', 'in-progress'] };
      }
      const tasks = await Task.find(query).sort({ order: 1 }).limit(50);
      return { result: summarizeTasks(tasks) };
    }

    case 'search_memories': {
      const memories = await getRelevantMemories(userId, args.query || '', args.limit || 5);
      return { result: JSON.stringify(memories.map((m: any) => m.content)) };
    }

    case 'get_task_history': {
      const stats = await computeTaskHistoryStats(userId, args.days || 90);
      return { result: formatStatsDigest(stats) };
    }

    case 'create_task': {
      if (!args.title) return { result: 'Error: title is required.' };
      // The hourly loop re-detects the same condition (e.g. a lagging goal)
      // every cycle — refuse to stack another copy of an identical open task.
      const existingOpen = await Task.findOne({
        userId,
        title: new RegExp(`^${args.title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        status: { $in: ['todo', 'in-progress'] }
      });
      if (existingOpen) {
        return { result: `Skipped: an open task titled "${existingOpen.title}" already exists (id: ${existingOpen._id.toString()}, status: ${existingOpen.status}).` };
      }

      // Goal-linked catch-up tasks: the LLM re-phrases the title differently
      // each time it re-detects the same lagging goal ("Catch-up on X" vs
      // "Catch-up on Learn X" vs ...), which slips past the exact-title check
      // above and stacks a fresh task for the same goal every day. Tag by
      // goalId instead and block on that tag while one is still open.
      const goalTag = args.goalId ? `goal:${args.goalId}` : null;
      if (goalTag) {
        const existingForGoal = await Task.findOne({
          userId,
          tags: goalTag,
          status: { $in: ['todo', 'in-progress'] }
        });
        if (existingForGoal) {
          return { result: `Skipped: an open catch-up task for this goal already exists ("${existingForGoal.title}", id: ${existingForGoal._id.toString()}).` };
        }
      }

      const lastTask = await Task.findOne({ userId }).sort({ order: -1 });
      const nextOrder = lastTask ? lastTask.order + 1 : 0;
      const task = new Task({
        userId,
        title: args.title,
        estimatedTime: args.estimatedTime || 30,
        priority: args.priority || 'medium',
        category: args.category || 'Work',
        dueDate: now,
        tags: goalTag ? [goalTag] : [],
        source: 'agent-suggested',
        order: nextOrder
      });
      await task.save();
      return { result: `Created task "${task.title}" (id: ${task._id.toString()})` };
    }

    case 'schedule_time_block': {
      const task = await Task.findOne({ _id: args.taskId, userId });
      if (!task) return { result: `Error: task ${args.taskId} not found.` };
      task.timeBlock = { startTime: args.startTime, endTime: computeEndTime(args.startTime, args.duration) };
      await task.save();
      return { result: `Scheduled "${task.title}" at ${args.startTime} for ${args.duration}m.` };
    }

    case 'break_down_task': {
      const parentTask = await Task.findOne({ _id: args.taskId, userId });
      if (!parentTask) return { result: `Error: task ${args.taskId} not found.` };
      if (!Array.isArray(args.subtasks) || args.subtasks.length === 0) {
        return { result: 'Error: subtasks array is required and cannot be empty.' };
      }

      // A subtask is already atomic — breaking it down again just spawns a
      // near-identical child set ("Read istio documentation" → "Read istio
      // documentation" → …), which is exactly how the planner filled up with
      // recursive duplicates. Refuse to break down anything that is itself a
      // subtask, or a task that has already been broken down once.
      if (parentTask.tags.includes('subtask')) {
        return { result: `Skipped: "${parentTask.title}" is already a subtask — it's atomic, no further breakdown.` };
      }
      if ((parentTask.description || '').includes('Broken down by autonomous agent')) {
        return { result: `Skipped: "${parentTask.title}" was already broken down previously.` };
      }

      // The hourly loop re-detects the same overdue parent every cycle it's
      // still open — refuse to break it down again while a prior breakdown's
      // subtasks are still outstanding, or this stacks a fresh duplicate set
      // (e.g. "Read istio documentation" x2) every time the check re-fires.
      const parentTag = `subtask-of:${parentTask._id.toString()}`;
      const existingSubtasks = await Task.find({
        userId,
        tags: parentTag,
        status: { $in: ['todo', 'in-progress'] }
      });
      if (existingSubtasks.length > 0) {
        return { result: `Skipped: "${parentTask.title}" already has ${existingSubtasks.length} open subtasks from a prior breakdown.` };
      }

      const lastTask = await Task.findOne({ userId }).sort({ order: -1 });
      let currentOrder = lastTask ? lastTask.order + 1 : 0;
      // Subtasks should never be born already overdue: if the parent's due
      // date has already passed (e.g. a stale goal being broken down late),
      // schedule the new subtasks for today instead of inheriting the past date.
      const subtaskDueDate = parentTask.dueDate > now ? parentTask.dueDate : now;
      for (const subtaskTitle of args.subtasks) {
        const subTask = new Task({
          userId,
          title: subtaskTitle,
          dueDate: subtaskDueDate,
          priority: parentTask.priority,
          category: parentTask.category,
          tags: [...parentTask.tags, 'subtask', parentTag],
          source: 'agent-suggested',
          order: currentOrder++
        });
        await subTask.save();
      }
      parentTask.description = (parentTask.description ? parentTask.description + '\n' : '') +
        'Broken down by autonomous agent into subtasks.';
      await parentTask.save();
      return { result: `Broke "${parentTask.title}" into ${args.subtasks.length} subtasks.` };
    }

    case 'defer_task': {
      const task = await Task.findOne({ _id: args.taskId, userId });
      if (!task) return { result: `Error: task ${args.taskId} not found.` };
      const newDue = new Date(task.dueDate.getTime() + 24 * 60 * 60 * 1000);
      task.dueDate = newDue;
      task.description = (task.description ? task.description + '\n' : '') +
        `Deferred to ${newDue.toISOString().split('T')[0]} by autonomous agent: ${args.reason || 'load balancing'}`;
      await task.save();
      return { result: `Deferred "${task.title}" to ${newDue.toISOString().split('T')[0]}.` };
    }

    case 'create_nudge_memory': {
      if (!args.content) return { result: 'Error: content is required.' };
      if (!hasSufficientQuality(args.content)) {
        return { result: `Error: content is too brief to be a useful nudge ("${args.content}"). Write a full sentence with specifics — what is at risk and what the user should do about it.` };
      }
      const category = (args.category || 'productivity').toLowerCase();

      // The hourly loop re-detects the same condition every cycle (e.g. a
      // habit streak at risk stays at risk all day). Two guards stop it from
      // stacking a dozen copies of the same warning:
      // 1. At most one unexpired autonomous nudge per category.
      const activeNudge = await AgentMemory.findOne({
        userId,
        source: 'autonomous',
        expiresAt: { $gt: now },
        category: new RegExp(`^${category}$`, 'i')
      });
      if (activeNudge) {
        return { result: `Skipped: an active "${category}" nudge already exists ("${activeNudge.content.slice(0, 60)}..."). It expires ${activeNudge.expiresAt?.toISOString()}.` };
      }
      // 2. Semantic near-duplicate check across all live memories.
      const similar = await findSimilarMemory(userId, args.content);
      if (similar) {
        return { result: `Skipped: a similar memory already exists ("${similar.content.slice(0, 60)}...").` };
      }

      const mem = new AgentMemory({
        userId,
        type: 'adjustment',
        content: args.content,
        category,
        feedback: 'none',
        source: 'autonomous',
        importance: args.importance || 6,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
      });
      await mem.save();
      return { result: `Created nudge memory: "${args.content}"` };
    }

    case 'add_goal_note': {
      const goal = await Goal.findOne({ _id: args.goalId, userId });
      if (!goal) return { result: `Error: goal ${args.goalId} not found.` };
      if (!args.note) return { result: 'Error: note is required.' };
      // Skip when an equivalent note is already on the goal, and cap
      // autonomous notes at one per goal per day — the hourly loop otherwise
      // appends a (re-phrased) copy of the same deadline warning every cycle.
      const coreNote = String(args.note).trim().toLowerCase();
      const todayMarker = `(${now.toLocaleDateString()})`;
      const alreadyNoted = goal.agentNotes.some(n =>
        n.toLowerCase().includes(coreNote.slice(0, 80)) ||
        (n.startsWith('[Autonomous Brain]') && n.endsWith(todayMarker))
      );
      if (alreadyNoted) {
        return { result: `Skipped: goal "${goal.title}" already has an autonomous note for today.` };
      }
      goal.agentNotes.push(`[Autonomous Brain] ${args.note} (${now.toLocaleDateString()})`);
      await goal.save();
      return { result: `Added note to goal "${goal.title}".` };
    }

    case 'propose_reorder': {
      if (!Array.isArray(args.orderedTaskIds) || args.orderedTaskIds.length === 0) {
        return { result: 'Error: orderedTaskIds array is required.' };
      }
      const id = `suggest-reorder-${new mongoose.Types.ObjectId().toString()}`;
      return {
        result: `Queued a reorder proposal for human approval (${args.orderedTaskIds.length} tasks).`,
        suggestion: {
          id,
          actionType: 'reorder',
          description: args.reason || 'Reorder tasks based on autonomous analysis.',
          details: { orderedTaskIds: args.orderedTaskIds }
        }
      };
    }

    case 'delete_task': {
      const task = await Task.findOne({ _id: args.taskId, userId });
      if (!task) return { result: `Error: task ${args.taskId} not found.` };
      await Task.deleteOne({ _id: args.taskId, userId });
      return { result: `Deleted task "${task.title}".` };
    }

    case 'add_habit': {
      if (!args.title) return { result: 'Error: title is required.' };
      const habit = new Habit({
        userId,
        title: args.title,
        frequency: args.frequency || 'daily',
        icon: args.icon || '✨',
        completions: [],
        currentStreak: 0,
        longestStreak: 0,
        isActive: true
      });
      await habit.save();
      return { result: `Added habit "${habit.title}" (id: ${habit._id.toString()})` };
    }

    case 'create_goal': {
      if (!args.title) return { result: 'Error: title is required.' };
      const goal = new Goal({
        userId,
        title: args.title,
        description: args.description || '',
        deadline: args.deadline ? new Date(args.deadline) : undefined,
        milestones: [
          { title: 'Define scope and roadmap', completed: false },
          { title: 'Implement key logic steps', completed: false },
          { title: 'Validate and review milestones', completed: false }
        ],
        status: 'active',
        agentNotes: ['Goal created via conversational AI interface.']
      });
      await goal.save();
      return { result: `Created goal "${goal.title}" (id: ${goal._id.toString()})` };
    }

    case 'complete_milestone': {
      const goal = await Goal.findOne({ _id: args.goalId, userId });
      if (!goal) return { result: `Error: goal ${args.goalId} not found.` };
      const idx = Number(args.milestoneIndex);
      if (isNaN(idx) || idx < 0 || idx >= goal.milestones.length) {
        return { result: 'Error: milestoneIndex out of bounds.' };
      }
      goal.milestones[idx].completed = true;
      goal.milestones[idx].completedAt = now;
      goal.agentNotes.push(`Milestone "${goal.milestones[idx].title}" completed via chat (${now.toLocaleDateString()}).`);
      await goal.save();
      return { result: `Completed milestone "${goal.milestones[idx].title}" for goal "${goal.title}".` };
    }

    case 'remember_fact': {
      if (!args.fact) return { result: 'Error: fact is required.' };
      // Facts stated by the user in chat are first-party input, so they are
      // stored as source 'user' and auto-accepted — unlike reflection insights,
      // which require review before influencing planning.
      const dedupe = await findSimilarMemory(userId, args.fact);
      if (dedupe) return { result: `Already remembered — a similar memory exists: "${dedupe.content.slice(0, 80)}"` };
      const factMemory = new AgentMemory({
        userId,
        type: args.type === 'preference' ? 'preference' : 'general',
        content: args.fact,
        category: args.category || 'general',
        feedback: 'accepted',
        source: 'user',
        importance: Math.min(10, Math.max(1, args.importance || 7))
      });
      await factMemory.save();
      return { result: `Remembered: "${args.fact}"` };
    }

    default:
      return { result: `Error: unknown tool "${name}".` };
  }
}

/**
 * Rejects bare, low-information memory content ("Habit streak at risk") that
 * carries no actionable specifics. Models sometimes emit a title-length stub
 * instead of following the tool description's instruction to be concrete —
 * this enforces that at write time instead of trusting the prompt.
 */
function hasSufficientQuality(content: string): boolean {
  const words = content.trim().split(/\s+/).filter(Boolean);
  return words.length >= 6 && content.trim().length >= 25;
}

function computeEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + (durationMinutes || 0);
  const endH = Math.floor((total % 1440) / 60);
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}
