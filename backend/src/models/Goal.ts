import mongoose, { Schema, Document } from 'mongoose';

export interface IMilestone {
  title: string;
  completed: boolean;
  completedAt?: Date;
}

export interface IGoal extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  deadline?: Date;
  milestones: IMilestone[];
  linkedTaskIds: mongoose.Types.ObjectId[];
  progress: number; // 0 to 100 percentage
  status: 'active' | 'completed' | 'paused';
  agentNotes: string[];
  createdAt: Date;
  updatedAt: Date;
}

const GoalSchema = new Schema<IGoal>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  deadline: { type: Date },
  milestones: [{
    title: { type: String, required: true },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date }
  }],
  linkedTaskIds: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
  progress: { type: Number, default: 0, min: 0, max: 100 },
  status: { type: String, enum: ['active', 'completed', 'paused'], default: 'active', index: true },
  agentNotes: [{ type: String }]
}, { timestamps: true });

// Pre-save hook to calculate progress based on milestone completion
GoalSchema.pre('save', function(next) {
  if (this.milestones && this.milestones.length > 0) {
    const completedCount = this.milestones.filter(m => m.completed).length;
    this.progress = Math.round((completedCount / this.milestones.length) * 100);
  }
  next();
});

export const Goal = mongoose.model<IGoal>('Goal', GoalSchema);
