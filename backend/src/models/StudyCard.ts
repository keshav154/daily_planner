import mongoose, { Schema, Document } from 'mongoose';

/**
 * A persistent spaced-repetition card tied to a learning/cert goal. Unlike a
 * one-off daily question, a card lives across reviews and carries its own SM-2
 * schedule (see services/srs.ts): answered wrong → resurfaces tomorrow;
 * answered right → pushed further out. The daily study drip serves the most
 * overdue card (or grows the deck with a new one), so study time concentrates
 * on the topics the user actually keeps missing.
 */
export interface IStudyCard extends Document {
  userId: mongoose.Types.ObjectId;
  goalId: mongoose.Types.ObjectId;
  goalTitle: string;
  topic: string;
  question: string;
  expectedAnswer: string;
  // SM-2 schedule state
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueDate: Date;
  lastReviewedAt?: Date;
  status: 'active' | 'retired';
  createdAt: Date;
  updatedAt: Date;
}

const StudyCardSchema = new Schema<IStudyCard>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  goalId: { type: Schema.Types.ObjectId, ref: 'Goal', required: true },
  goalTitle: { type: String, required: true },
  topic: { type: String, default: '' },
  question: { type: String, required: true },
  expectedAnswer: { type: String, required: true },
  easeFactor: { type: Number, default: 2.5 },
  intervalDays: { type: Number, default: 0 },
  repetitions: { type: Number, default: 0 },
  lapses: { type: Number, default: 0 },
  dueDate: { type: Date, default: Date.now, index: true },
  lastReviewedAt: { type: Date },
  status: { type: String, enum: ['active', 'retired'], default: 'active', index: true }
}, { timestamps: true });

export const StudyCard = mongoose.model<IStudyCard>('StudyCard', StudyCardSchema);
