import mongoose, { Schema, Document } from 'mongoose';

// User Schema
export interface IUser extends Document {
  email: string;
  passwordHash: string;
  timezone: string;
  theme: string;
  xp: number;
  level: number;
  achievements: string[];
  preferences: {
    workingHoursStart: string; // e.g. "09:00"
    workingHoursEnd: string;   // e.g. "17:00"
    peakEnergyTime: 'morning' | 'afternoon' | 'evening' | 'night';
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  timezone: { type: String, default: 'UTC' },
  theme: { type: String, enum: ['dark', 'light'], default: 'dark' },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  achievements: [{ type: String }],
  preferences: {
    workingHoursStart: { type: String, default: '09:00' },
    workingHoursEnd: { type: String, default: '17:00' },
    peakEnergyTime: { type: String, enum: ['morning', 'afternoon', 'evening', 'night'], default: 'morning' }
  }
}, { timestamps: true });

// Task Schema
export interface ITask extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done' | 'skipped';
  priority: 'high' | 'medium' | 'low';
  dueDate: Date;
  estimatedTime: number; // in minutes
  actualTime: number;    // in minutes
  tags: string[];
  category: string;      // e.g. "Work", "Personal", "Health", "Learning"
  source: 'manual' | 'agent-suggested';
  order: number;
  subtasks: Array<{ title: string; completed: boolean }>;
  timeBlock?: { startTime: string; endTime: string };
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['todo', 'in-progress', 'done', 'skipped'], default: 'todo', index: true },
  priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium', index: true },
  dueDate: { type: Date, required: true, index: true },
  estimatedTime: { type: Number, default: 0 },
  actualTime: { type: Number, default: 0 },
  tags: [{ type: String }],
  category: { type: String, default: 'Work', index: true },
  source: { type: String, enum: ['manual', 'agent-suggested'], default: 'manual' },
  order: { type: Number, default: 0 },
  subtasks: [{
    title: { type: String, required: true },
    completed: { type: Boolean, default: false }
  }],
  timeBlock: {
    startTime: { type: String },
    endTime: { type: String }
  }
}, { timestamps: true });

// Log Schema
export interface ILog extends Document {
  userId: mongoose.Types.ObjectId;
  taskId?: mongoose.Types.ObjectId;
  title: string;
  duration: number; // in minutes
  timestamp: Date;
  notes: string;
}

const LogSchema = new Schema<ILog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  taskId: { type: Schema.Types.ObjectId, ref: 'Task', index: true },
  title: { type: String, required: true, trim: true },
  duration: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
  notes: { type: String, default: '' }
});

// AgentMemory Schema
export interface IAgentMemory extends Document {
  userId: mongoose.Types.ObjectId;
  type: 'pattern' | 'preference' | 'adjustment' | 'general';
  content: string;
  category: string; // e.g. "estimation", "productivity", "scheduling"
  feedback: 'none' | 'accepted' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

const AgentMemorySchema = new Schema<IAgentMemory>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['pattern', 'preference', 'adjustment', 'general'], default: 'pattern' },
  content: { type: String, required: true },
  category: { type: String, default: 'general' },
  feedback: { type: String, enum: ['none', 'accepted', 'rejected'], default: 'none', index: true }
}, { timestamps: true });

// AgentRun Schema
export interface IAgentRun extends Document {
  userId: mongoose.Types.ObjectId;
  trigger: string; // e.g. "manual", "new_task", "daily_reflection", "weekly_reflection"
  contextSnapshot: Record<string, any>;
  planOutput: {
    rationale: string;
    suggestions: Array<{
      id: string;
      taskId?: string;
      actionType: 'reorder' | 'suggest_time_block' | 'break_down' | 'nudge' | 'create_task';
      details: Record<string, any>;
      description: string;
    }>;
  };
  actionsTaken: Array<{
    suggestionId: string;
    actionType: string;
    status: 'pending' | 'accepted' | 'rejected';
    resolvedAt?: Date;
  }>;
  createdAt: Date;
}

const AgentRunSchema = new Schema<IAgentRun>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  trigger: { type: String, required: true },
  contextSnapshot: { type: Schema.Types.Map, of: Schema.Types.Mixed },
  planOutput: {
    rationale: { type: String, required: true },
    suggestions: [{
      id: { type: String, required: true },
      taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
      actionType: { type: String, enum: ['reorder', 'suggest_time_block', 'break_down', 'nudge', 'create_task'], required: true },
      details: { type: Schema.Types.Mixed },
      description: { type: String, required: true }
    }]
  },
  actionsTaken: [{
    suggestionId: { type: String, required: true },
    actionType: { type: String, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    resolvedAt: { type: Date }
  }],
  createdAt: { type: Date, default: Date.now }
});

// Compile and Export Models
export const User = mongoose.model<IUser>('User', UserSchema);
export const Task = mongoose.model<ITask>('Task', TaskSchema);
export const Log = mongoose.model<ILog>('Log', LogSchema);
export const AgentMemory = mongoose.model<IAgentMemory>('AgentMemory', AgentMemorySchema);
export const AgentRun = mongoose.model<IAgentRun>('AgentRun', AgentRunSchema);
