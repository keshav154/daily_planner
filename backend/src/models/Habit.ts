import mongoose, { Schema, Document } from 'mongoose';

export interface IHabit extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  icon: string;
  frequency: 'daily' | 'weekdays' | 'custom';
  daysOfWeek?: number[];
  completions: Array<{ date: string; completed: boolean }>; // YYYY-MM-DD completion mapping
  currentStreak: number;
  longestStreak: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const HabitSchema = new Schema<IHabit>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  icon: { type: String, default: '⭐' },
  frequency: { type: String, enum: ['daily', 'weekdays', 'custom'], default: 'daily' },
  daysOfWeek: [{ type: Number }],
  completions: [{
    date: { type: String, required: true },
    completed: { type: Boolean, default: false }
  }],
  currentStreak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model<IHabit>('Habit', HabitSchema);
