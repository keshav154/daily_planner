import mongoose, { Schema, Document } from 'mongoose';

export interface IRecurringEvent extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  type: 'meeting' | 'standup' | 'task' | 'break' | 'block';
  recurrence: {
    pattern: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';
    daysOfWeek: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
    interval: number; // For biweekly (2) or monthly
    endDate?: Date;
  };
  startTime: string; // "09:00"
  endTime: string;   // "09:30"
  category: string;  // "Work", "Personal", etc.
  color: string;     // Hex color code or Tailwind name
  location?: string;
  meetingLink?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringEventSchema = new Schema<IRecurringEvent>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  type: { type: String, enum: ['meeting', 'standup', 'task', 'break', 'block'], required: true },
  recurrence: {
    pattern: { type: String, enum: ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'], required: true },
    daysOfWeek: [{ type: Number }],
    interval: { type: Number, default: 1 },
    endDate: { type: Date }
  },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  category: { type: String, default: 'Work' },
  color: { type: String, default: '#6366f1' },
  location: { type: String },
  meetingLink: { type: String },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model<IRecurringEvent>('RecurringEvent', RecurringEventSchema);
