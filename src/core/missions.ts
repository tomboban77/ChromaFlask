/**
 * Daily missions: three rotating tasks per local day, the "appointment
 * mechanic" - a reason for today's session beyond "next level". Deterministic
 * per day (like the daily challenge), verified entirely client-side from
 * events the game already emits, and deliberately skill-steering: the no-undo
 * / no-hint / beat-the-clock tasks reward playing well, not grinding.
 *
 * Pure data + pure selection, so the whole system is unit-testable. Rewards
 * are flat (not par-scaled): a mission's effort is the constraint, not the
 * level it happens on.
 */
import { mulberry32, shuffle } from './rng';

export type MissionKind =
  | 'clears'
  | 'perfect'
  | 'noUndo'
  | 'noHint'
  | 'clock'
  | 'pours'
  | 'daily';

export interface MissionDef {
  readonly kind: MissionKind;
  readonly target: number;
  readonly coins: number;
}

/**
 * The rotation pool. Kinds map 1:1 to `missions.<kind>` message keys. Coins
 * sit between a scaled early-level win and a full one, so a mission is worth
 * a detour without becoming the main income.
 */
const POOL: readonly MissionDef[] = [
  { kind: 'clears', target: 3, coins: 30 },
  { kind: 'perfect', target: 1, coins: 40 },
  { kind: 'noUndo', target: 1, coins: 40 },
  { kind: 'noHint', target: 1, coins: 40 },
  { kind: 'clock', target: 2, coins: 40 },
  { kind: 'pours', target: 40, coins: 30 },
  { kind: 'daily', target: 1, coins: 50 },
];

export const MISSIONS_PER_DAY = 3;
/** Paid once on top when all three missions land, the day's real carrot. */
export const MISSIONS_ALL_BONUS = 60;

/** The day's three missions. Same day, same missions, on every device. */
export function missionsFor(day: number): readonly MissionDef[] {
  // Knuth's multiplicative constant spreads consecutive day numbers across
  // the seed space so neighbouring days do not deal similar shuffles.
  const rng = mulberry32(Math.imul(day, 2654435761) + 97);
  return shuffle([...POOL], rng).slice(0, MISSIONS_PER_DAY);
}

// ------------------------------------------------------------------ state
/** One local day's mission slots, parallel to missionsFor(day)'s order. */
export interface MissionsState {
  day: number;
  /** Raw progress per slot; the UI clamps to the target for display. */
  progress: number[];
  /** Whether each slot's reward has been paid (doubles as "completed"). */
  paid: boolean[];
  /** Whether the all-three completion bonus has been paid. */
  allPaid: boolean;
}

/**
 * Two devices' mission states for a cloud restore. The later day wins; on
 * the same day, progress takes the max and payouts the union, so a restore
 * can never re-open a mission this device (or the other) already paid.
 */
export function mergeMissions(
  a: MissionsState | null,
  b: MissionsState | null,
): MissionsState | null {
  if (!a || !b) return a ?? b;
  if (a.day !== b.day || a.progress.length !== b.progress.length) return a.day > b.day ? a : b;
  return {
    day: a.day,
    progress: a.progress.map((p, i) => Math.max(p, b.progress[i] ?? 0)),
    paid: a.paid.map((p, i) => p || (b.paid[i] ?? false)),
    allPaid: a.allPaid || b.allPaid,
  };
}
