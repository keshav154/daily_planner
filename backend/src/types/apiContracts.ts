/**
 * Wire contracts shared between backend route handlers and frontend views.
 *
 * These exist because of a real bug class: the backend response shape and the
 * frontend's expected shape drifted apart silently (nested vs flat fields,
 * renamed fields) with no compile-time signal on either side. Both the route
 * handler and the consuming component should import these instead of using
 * ad-hoc inline object shapes, so a rename on one side breaks the build on
 * the other.
 *
 * Frontend imports this file directly via a relative path (see
 * frontend/src/components/BurnoutAlert.tsx and WeeklyReviewView.tsx) — the
 * frontend TS project runs with `noEmit: true`, so there's no build-output
 * path conflict. The backend build DOES emit, so this file must stay inside
 * backend/src (i.e. within `rootDir`) rather than in a top-level `shared/`
 * folder, or `tsc` fails with TS6059.
 */

// GET /api/ai/burnout-status
export interface BurnoutStatusResponse {
  riskLevel: 'low' | 'medium' | 'high';
  message: string;
  advice?: string;
  totalMinutesThisWeek: number;
  overdueTasksCount: number;
  stats: {
    totalMinutesThisWeek: number;
    dailyAverageMinutes: number;
    daysWithLogs: number;
    overdueTasks: number;
  };
}

// GET /api/ai/weekly-review
export interface WeeklyReviewCategoryStat {
  name: string;
  percentage: number;
  count: number;
}

export interface WeeklyReviewHabitStat {
  name: string;
  completionRate: number;
}

export interface WeeklyReviewResponse {
  completionRate: number;
  totalFocusHours: number;
  tasksCompleted: number;
  currentLevel: number | string;
  summary: string;
  categories: WeeklyReviewCategoryStat[];
  habitStats: WeeklyReviewHabitStat[];
  highlights: string[];
  improvement: string;
}
