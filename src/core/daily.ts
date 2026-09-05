/**
 * Daily challenge: one board per calendar day, the same for everyone, with a
 * streak for playing on consecutive days. No server: the date is the seed.
 *
 * Days are counted in the player's *local* calendar (a challenge should turn
 * over at their midnight, not UTC's), then folded into a level id far above
 * the campaign and endless ranges so the rest of the game can treat it as a
 * level. Records live in their own save section, never in the campaign map.
 */
import type { LevelSpec } from './types';

/** Daily ids start here; campaign ids are 1..500 and endless ids follow on. */
export const DAILY_BASE = 1_000_000;

export function isDaily(id: number): boolean {
  return id >= DAILY_BASE;
}

const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 for the local calendar date of `d`. */
export function dayNumberFromDate(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
}

export function todayDayNumber(now: Date = new Date()): number {
  return dayNumberFromDate(now);
}

/** Local-midnight Date for a day number (for display only). */
export function dateFromDay(day: number): Date {
  const utc = new Date(day * MS_PER_DAY);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

export function dailyId(day: number): number {
  return DAILY_BASE + day;
}

export function dayFromDailyId(id: number): number {
  return id - DAILY_BASE;
}

/**
 * The day's shape. Mid-campaign depth on purpose: a player at level 60 and
 * one at level 400 should both find it a fair single sitting. Five shapes
 * rotate so a week never repeats a feel; murk alternates on top.
 */
export function dailySpec(id: number): LevelSpec {
  const day = dayFromDailyId(id);
  const murky = day % 2 === 1;
  const name = 'Daily challenge';
  switch (((day % 5) + 5) % 5) {
    case 0:
      return { id, colors: 8, empties: 2, minPar: 22, name, murky };
    case 1:
      return { id, colors: 7, empties: 2, minPar: 17, name, murky: true };
    case 2:
      return { id, colors: 6, empties: 1, cauldron: true, minPar: 15, name, murky };
    case 3:
      return { id, colors: 6, empties: 1, minPar: 15, name, murky };
    default:
      return { id, colors: 7, empties: 3, minPar: 14, name, murky: true };
  }
}

// ------------------------------------------------------------------ streak
export interface DailyStreak {
  /** Consecutive days cleared, ending on `lastDay`. */
  readonly streak: number;
  /** Day number of the most recent clear, or -1 for none. */
  readonly lastDay: number;
}

/** State after clearing `day` for the first time. Same day twice changes nothing. */
export function advanceStreak(s: DailyStreak, day: number): DailyStreak {
  if (s.lastDay === day) return s;
  if (s.lastDay === day - 1) return { streak: s.streak + 1, lastDay: day };
  return { streak: 1, lastDay: day };
}

/**
 * The streak as it should be shown today: alive if the last clear was today
 * or yesterday (yesterday's streak can still be extended), otherwise lapsed.
 */
export function currentStreak(s: DailyStreak, today: number): number {
  return s.lastDay === today || s.lastDay === today - 1 ? s.streak : 0;
}
