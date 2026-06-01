// Central hint config. Lifts the cost map + labels out of EJS templates and
// dashboard route handlers so a future tier change is one file, not seven.
//
// Curve: compressed — the spoiler ceiling stays at 10pts (was the old L3),
// intermediate steps fill below it. Asking for L1 is cheap, L5 is expensive.

export const MAX_HINT_LEVEL = 5 as const;

export type HintLevel = 1 | 2 | 3 | 4 | 5;

export const HINT_COSTS: Record<HintLevel, number> = {
  1: 1,
  2: 2,
  3: 4,
  4: 7,
  5: 10,
};

export const HINT_LABELS: Record<HintLevel, string> = {
  1: 'nudge',
  2: 'direction',
  3: 'technique',
  4: 'strong',
  5: 'spoiler',
};

export const HINT_LEVELS: HintLevel[] = [1, 2, 3, 4, 5];

export function isHintLevel(n: unknown): n is HintLevel {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_HINT_LEVEL;
}
