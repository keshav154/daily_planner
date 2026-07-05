import mongoose, { Schema, Document } from 'mongoose';

export interface IScheduleTemplate extends Document {
  userId: mongoose.Types.ObjectId;
  name: string; // e.g., "Office Day", "WFH Day"
  isDefault: boolean;
  blocks: Array<{
    startTime: string; // "09:00"
    endTime: string;   // "12:00"
    label: string;     // "Deep Work Block"
    type: 'work' | 'meeting' | 'break' | 'personal' | 'focus';
    color: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduleTemplateSchema = new Schema<IScheduleTemplate>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  blocks: [{
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ['work', 'meeting', 'break', 'personal', 'focus'], default: 'work' },
    color: { type: String, default: '#6366f1' }
  }]
}, { timestamps: true });

export default mongoose.model<IScheduleTemplate>('ScheduleTemplate', ScheduleTemplateSchema);
