/**
 * Shared label formatting for AgentMemory display. Raw memory records store
 * `type` (pattern|preference|adjustment|general) and a free-form `category`
 * string that models sometimes populate with the whole insight slug (e.g.
 * "task-duration-underestimation"). Rendered naively as "{type} / {category}"
 * this produces ugly, redundant badges like "PATTERN / WEEKLY PATTERN" or
 * "ADJUSTMENT / TASK-DURATION-UNDERESTIMATION".
 */

/** Converts kebab-case/snake_case/lowercase into readable Title Case. */
export function humanizeLabel(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Returns the badge(s) to render for a memory: the category alone when it
 * already conveys the type (e.g. category "Weekly Pattern" for type
 * "pattern"), otherwise both, humanized.
 */
export function getMemoryBadges(type: string, category: string): string[] {
  const humanType = humanizeLabel(type);
  const humanCategory = humanizeLabel(category);

  if (!humanCategory) return [humanType];
  if (humanCategory.toLowerCase().includes(humanType.toLowerCase())) return [humanCategory];
  return [humanType, humanCategory];
}
