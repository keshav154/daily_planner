import { StudyDrip } from '../models/StudyDrip';
import { StudyCard } from '../models/StudyCard';
import { Goal, IGoal } from '../models/Goal';
import { queryNvidiaNim } from '../config/nvidia';
import { sendTelegramMessage } from './telegramNotifier';
import { scheduleNext, dueDateFrom } from './srs';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Daily cert/learning "study drip", now a spaced-repetition system. Each day it
 * serves one card for the user's most deadline-pressing learning goal —
 * preferring a card that's due for review, otherwise growing the deck with a
 * fresh question. The reply is graded and the card is rescheduled via SM-2
 * (see services/srs.ts): wrong → back tomorrow, right → spaced further out. So
 * study time concentrates on the topics the user keeps missing, and stalled
 * cert goals become a compounding daily habit on the channel they check.
 */

// Grow each goal's deck up to this many cards before switching to pure review.
const TARGET_DECK = 20;

const LEARNING_KEYWORDS = ['learn', 'study', 'prepare', 'cert', 'exam', 'k8s', 'kubernetes', 'terraform', 'aws', 'docker', 'prometheus', 'grafana', 'ansible', 'istio', 'kyverno', 'nvidia'];

function isLearningGoal(title: string): boolean {
  const lower = title.toLowerCase();
  return LEARNING_KEYWORDS.some(kw => lower.includes(kw));
}

const getAnthropicClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') return null;
  return new Anthropic({ apiKey });
};

const isNvidiaActive = (): boolean => {
  const k = process.env.NVIDIA_API_KEY;
  return !!(k && k !== 'your_nvidia_api_key_here');
};

/** JSON completion with NIM primary + Anthropic fallback, mirroring briefingService. */
async function completeJson(prompt: string): Promise<any | null> {
  try {
    if (isNvidiaActive()) {
      const text = await queryNvidiaNim(
        [{ role: 'user', content: prompt }],
        process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct',
        0.4,
        400,
        true
      );
      return JSON.parse(text);
    }
  } catch (err) {
    console.warn('[StudyDrip] NIM JSON call failed, trying Anthropic fallback:', err);
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) return null;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 400,
      messages: [{ role: 'user', content: `${prompt}\n\nRespond with ONLY valid JSON, no prose.` }]
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (err) {
    console.error('[StudyDrip] Anthropic JSON call failed:', err);
    return null;
  }
}

/** Current correct-in-a-row streak for a user (from their last graded drip). */
async function currentStreak(userId: string): Promise<number> {
  const last = await StudyDrip.findOne({ userId, status: 'graded' }).sort({ gradedAt: -1 }).lean();
  return last?.streakAfter || 0;
}

/**
 * Serves one spaced-repetition card for the user's most deadline-pressing
 * learning goal. Prefers a due review card; if none is due and the deck isn't
 * full yet, generates a fresh card; if the deck is full and nothing's due,
 * serves the soonest card to keep the daily rhythm. No-ops (returns false) if
 * there's no learning goal or an unanswered question is already open.
 */
export async function runStudyDripForUser(userId: string, chatId: string): Promise<boolean> {
  const openDrip = await StudyDrip.findOne({ userId, status: 'open' });
  if (openDrip) return false; // wait for the current one to be answered

  const goals = await Goal.find({ userId, status: 'active' });
  const learningGoals = goals.filter((g: IGoal) => isLearningGoal(g.title));
  if (learningGoals.length === 0) return false;

  // Prefer the goal with the nearest deadline (most urgent to study for).
  learningGoals.sort((a, b) => {
    const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return da - db;
  });
  const goal = learningGoals[0];
  const now = new Date();

  // 1. A card that's due for review takes priority (reinforce before adding new).
  let card = await StudyCard.findOne({ userId, goalId: goal._id, status: 'active', dueDate: { $lte: now } }).sort({ dueDate: 1 });
  let isNew = false;

  if (!card) {
    const deckSize = await StudyCard.countDocuments({ userId, goalId: goal._id, status: 'active' });
    if (deckSize < TARGET_DECK) {
      // 2. Deck not full → generate a new card to broaden coverage.
      const existing = await StudyCard.find({ userId, goalId: goal._id }).sort({ createdAt: -1 }).limit(8).lean();
      const askedBefore = existing.map(c => c.question).join(' | ') || 'none yet';
      const prompt = `You are a certification study coach. Generate ONE focused exam-style question to help someone preparing for: "${goal.title}".
Avoid repeating these recently-asked questions: ${askedBefore}
Return JSON: {"question": "<a single specific question>", "answer": "<the correct answer, 1-3 sentences>", "topic": "<short topic tag>"}`;
      const result = await completeJson(prompt);
      if (!result?.question || !result?.answer) return false;
      card = await StudyCard.create({
        userId, goalId: goal._id, goalTitle: goal.title,
        topic: result.topic || '', question: result.question, expectedAnswer: result.answer,
        dueDate: now
      });
      isNew = true;
    } else {
      // 3. Deck full and nothing due → serve the soonest card to keep the habit.
      card = await StudyCard.findOne({ userId, goalId: goal._id, status: 'active' }).sort({ dueDate: 1 });
      if (!card) return false;
    }
  }

  const streak = await currentStreak(userId);
  await StudyDrip.create({
    userId,
    goalId: goal._id,
    cardId: card._id,
    goalTitle: goal.title,
    topic: card.topic,
    question: card.question,
    expectedAnswer: card.expectedAnswer,
    status: 'open',
    streakAfter: streak
  });

  const dueCount = await StudyCard.countDocuments({ userId, goalId: goal._id, status: 'active', dueDate: { $lte: now } });
  const moreDue = Math.max(0, dueCount - 1);
  const streakLine = streak > 0 ? `\n\n🔥 streak: ${streak} day${streak === 1 ? '' : 's'}` : '';
  const meta = `(${isNew ? 'new card' : 'review'}${moreDue > 0 ? ` · ${moreDue} more due` : ''})`;
  const text = `📚 Daily study — ${goal.title}\n\nQ: ${card.question}\n\nReply with your answer.\n${meta}${streakLine}`;
  return sendTelegramMessage(chatId, text);
}

/**
 * If the user has an open study question, grades their reply against it,
 * updates the streak, and returns feedback to send back. Returns null if no
 * question is open (so the caller falls through to normal message handling).
 */
export async function gradeStudyReply(userId: string, replyText: string): Promise<string | null> {
  const drip = await StudyDrip.findOne({ userId, status: 'open' }).sort({ createdAt: -1 });
  if (!drip) return null;

  const prompt = `Grade this certification practice answer.
Question: ${drip.question}
Correct answer: ${drip.expectedAnswer}
User's answer: ${replyText}
Return JSON: {"correct": <true if substantially correct, else false>, "feedback": "<one or two sentences: confirm what's right or gently correct, and add one memorable detail>"}`;

  const result = await completeJson(prompt);
  // If grading is unavailable, don't lose the user's attempt — record it
  // ungraded and acknowledge, rather than silently dropping it.
  const correct = result?.correct === true;
  const feedback = result?.feedback || 'Answer recorded.';

  const prevStreak = await currentStreak(userId);
  const newStreak = result ? (correct ? prevStreak + 1 : 0) : prevStreak;

  drip.status = 'graded';
  drip.userAnswer = replyText;
  drip.correct = result ? correct : undefined;
  drip.feedback = feedback;
  drip.streakAfter = newStreak;
  drip.gradedAt = new Date();
  await drip.save();

  // Reschedule the spaced-repetition card via SM-2 — but only when we actually
  // graded it (skip if the LLM was unavailable, so we don't punish/advance a
  // card on a non-grade).
  let nextReviewLine = '';
  if (result && drip.cardId) {
    const card = await StudyCard.findOne({ _id: drip.cardId, userId });
    if (card) {
      const next = scheduleNext(
        { easeFactor: card.easeFactor, intervalDays: card.intervalDays, repetitions: card.repetitions, lapses: card.lapses },
        correct
      );
      card.easeFactor = next.easeFactor;
      card.intervalDays = next.intervalDays;
      card.repetitions = next.repetitions;
      card.lapses = next.lapses;
      card.dueDate = dueDateFrom(next.intervalDays);
      card.lastReviewedAt = new Date();
      await card.save();
      nextReviewLine = `\n\n🗓 back in ${next.intervalDays} day${next.intervalDays === 1 ? '' : 's'}`;
    }
  }

  // Nudge goal progress on a correct answer for goals with no milestone
  // structure (typical for cert goals) so daily study visibly moves the bar.
  if (correct) {
    const goal = await Goal.findOne({ _id: drip.goalId, userId });
    if (goal && (!goal.milestones || goal.milestones.length === 0)) {
      goal.progress = Math.min(100, goal.progress + 2);
      await goal.save();
    }
  }

  const mark = result ? (correct ? '✅ Correct!' : '❌ Not quite.') : '📝 Recorded.';
  const streakLine = newStreak > 0 ? `\n\n🔥 streak: ${newStreak} day${newStreak === 1 ? '' : 's'}` : '';
  return `${mark}\n\n${feedback}${streakLine}${nextReviewLine}`;
}
