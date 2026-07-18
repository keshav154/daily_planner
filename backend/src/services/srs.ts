/**
 * Spaced-repetition scheduling (SM-2, the algorithm behind Anki). Pure and
 * side-effect-free so it's trivially testable. Given a card's current state and
 * whether the user answered correctly, it returns the next interval, ease, and
 * repetition count. Wrong answers reset the card so it resurfaces tomorrow;
 * correct answers push it further out, so study time targets what you don't
 * know yet instead of re-drilling what you've mastered.
 */

export interface SrsState {
  easeFactor: number;   // >= 1.3; how fast intervals grow
  intervalDays: number; // days until next review
  repetitions: number;  // consecutive correct answers
  lapses: number;       // times forgotten (answered wrong after learning)
}

export const INITIAL_SRS: SrsState = {
  easeFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0
};

/**
 * Advance a card's schedule after a review. `correct` maps to an SM-2 quality
 * of 4 (good recall) vs 2 (failed recall) — a binary grade is all we get from
 * free-text answers graded by the LLM.
 */
export function scheduleNext(state: SrsState, correct: boolean): SrsState {
  const q = correct ? 4 : 2;
  let { easeFactor, intervalDays, repetitions, lapses } = state;

  if (!correct) {
    // Failed: relearn from the start — back tomorrow.
    repetitions = 0;
    intervalDays = 1;
    lapses += 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);
  }

  // Ease adjustment (standard SM-2 formula); wrong answers lower ease, floor 1.3.
  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  return { easeFactor, intervalDays, repetitions, lapses };
}

/** Next due Date from an interval, relative to `from` (defaults to now). */
export function dueDateFrom(intervalDays: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + Math.max(0, intervalDays) * 24 * 60 * 60 * 1000);
}
