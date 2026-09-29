/**
 * The weekly event: five hard boards per local calendar week (Monday to
 * Sunday), the same for everyone, with a prize for clearing all five and a
 * second one for a perfect week (every board three-starred). No server: the
 * week number is the seed, exactly like the daily challenge.
 *
 * Ids sit in their own range above the daily's, so the rest of the game can
 * treat a board as a level while records live in their own save section.
 * The shapes are the ones endless mode already proves fast to deal on a
 * phone, at floors a step above the daily - this is the hard mode.
 */
import { WEEKLY_BASE } from './daily';
import type { LevelSpec } from './types';

export const WEEKLY_BOARDS = 5;
/**
 * Highest unlocked campaign level needed before the event opens. Past the
 * campaign's introductions of the locked bottle (45) and the one-way flask
 * (67), both of which the event's hardest boards use.
 */
export const WEEKLY_UNLOCK_LEVEL = 70;

export function isWeekly(id: number): boolean {
  return id >= WEEKLY_BASE;
}

/**
 * Week number for a local day number (days since 1970-01-01). That day was a
 * Thursday, so shifting by three makes every week start on a Monday.
 */
export function weekOfDay(day: number): number {
  return Math.floor((day + 3) / 7);
}

/** The day number of the Monday that opens `week`. */
export function weekStartDay(week: number): number {
  return week * 7 - 3;
}

export function weeklyId(week: number, board: number): number {
  return WEEKLY_BASE + week * WEEKLY_BOARDS + board;
}

export function weekFromWeeklyId(id: number): number {
  return Math.floor((id - WEEKLY_BASE) / WEEKLY_BOARDS);
}

/** 0-based board index within its week. */
export function boardFromWeeklyId(id: number): number {
  return (id - WEEKLY_BASE) % WEEKLY_BOARDS;
}

/**
 * The five boards, in rising order of menace: a deep eight-colour board, a
 * seven-colour murky one, a murky squeeze, a locked eight-colour board, and
 * the one-way flask to finish. Murk alternates week to week on the boards
 * that do not always carry it.
 */
export function weeklySpec(id: number): LevelSpec {
  const week = weekFromWeeklyId(id);
  const murky = week % 2 === 1;
  const name = 'Weekly event';
  switch (boardFromWeeklyId(id)) {
    case 0:
      return { id, colors: 8, empties: 2, minPar: 24, name, murky };
    case 1:
      return { id, colors: 7, empties: 2, minPar: 19, name, murky: true };
    case 2:
      return { id, colors: 6, empties: 1, minPar: 17, name, murky: true };
    case 3:
      return { id, colors: 8, empties: 2, minPar: 24, lock: { seals: 1 }, name, murky };
    default:
      return { id, colors: 8, empties: 1, minPar: 22, oneWay: true, name, murky: !murky };
  }
}
