import mongoose from 'mongoose';
import { Task, AgentMemory } from '../models/Schemas';
import { Goal } from '../models/Goal';
import Habit from '../models/Habit';
import { getRelevantMemories } from '../services/similarity';
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
      name: 'create_task',
      description: 'Create a new task for the user (e.g. a catch-up task or missing prerequisite step).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          estimatedTime: { type: 'number', description: 'Minutes' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          category: { type: 'string' }
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
  }
];

export const CHAT_TOOLS: ToolSchema[] = [...AGENT_TOOLS, ...CHAT_ONLY_TOOLS];

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

    case 'create_task': {
      const lastTask = await Task.findOne({ userId }).sort({ order: -1 });
      const nextOrder = lastTask ? lastTask.order + 1 : 0;
      const task = new Task({
        userId,
        title: args.title,
        estimatedTime: args.estimatedTime || 30,
        priority: args.priority || 'medium',
        category: args.category || 'Work',
        dueDate: now,
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
      const lastTask = await Task.findOne({ userId }).sort({ order: -1 });
      let currentOrder = lastTask ? lastTask.order + 1 : 0;
      for (const subtaskTitle of args.subtasks) {
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
      const mem = new AgentMemory({
        userId,
        type: 'adjustment',
        content: args.content,
        category: args.category || 'productivity',
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

    default:
      return { result: `Error: unknown tool "${name}".` };
  }
}

function computeEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + (durationMinutes || 0);
  const endH = Math.floor((total % 1440) / 60);
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}
