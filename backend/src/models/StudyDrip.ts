import mongoose, { Schema, Document } from 'mongoose';

/**
 * A single daily spaced-repetition question tied to a learning/cert goal.
 * One "open" drip per user awaits an answer; the user's next Telegram reply
 * is graded against it, updating their streak. This turns stalled cert goals
 * (which sit at low progress for weeks) into a 2-minute daily habit delivered
 * on the channel the user actually checks.
 */
export interface IStudyDrip extends Document {
  userId: mongoose.Types.ObjectId;
  goalId: mongoose.Types.ObjectId;
  goalTitle: string;
  topic: string;
  question: string;
  expectedAnswer: string;
  status: 'open' | 'graded';
  userAnswer?: string;
  correct?: boolean;
  feedback?: string;
  streakAfter: number; // running correct-in-a-row streak as of this drip
  gradedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StudyDripSchema = new Schema<IStudyDrip>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  goalId: { type: Schema.Types.ObjectId, ref: 'Goal', required: true },
  goalTitle: { type: String, required: true },
  topic: { type: String, default: '' },
  question: { type: String, required: true },
  expectedAnswer: { type: String, required: true },
  status: { type: String, enum: ['open', 'graded'], default: 'open', index: true },
  userAnswer: { type: String },
  correct: { type: Boolean },
  feedback: { type: String },
  streakAfter: { type: Number, default: 0 },
  gradedAt: { type: Date }
}, { timestamps: true });

export const StudyDrip = mongoose.model<IStudyDrip>('StudyDrip', StudyDripSchema);
