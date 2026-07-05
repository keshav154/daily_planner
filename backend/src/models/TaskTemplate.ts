import mongoose, { Schema, Document } from 'mongoose';

export interface ITaskTemplate extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  tasks: Array<{
    title: string;
    estimatedTime: number;
    priority: 'high' | 'medium' | 'low';
    category: string;
    subtasks: Array<{ title: string }>;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const TaskTemplateSchema = new Schema<ITaskTemplate>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  tasks: [{
    title: { type: String, required: true },
    estimatedTime: { type: Number, default: 30 },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    category: { type: String, default: 'Work' },
    subtasks: [{
      title: { type: String, required: true }
    }]
  }]
}, { timestamps: true });

export default mongoose.model<ITaskTemplate>('TaskTemplate', TaskTemplateSchema);
