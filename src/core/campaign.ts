/**
 * The precomputed campaign (see precompute.ts) with the live generator as a
 * fallback. Call sites ask for a level by id and never pay for a solve.
 */
import campaignJson from './campaign.json';
import { applyPour, cloneBoard, isSolved, rulesFor } from './board';
import { generateLevel } from './generator';
import { getLevelSpec } from './levels';
import type { Board, GeneratedLevel, Move } from './types';

interface StoredLevel {
  readonly id: number;
  readonly board: Board;
  readonly par: number;
  /** Winning line as [from, to] pairs; count and colour are recovered by replay. */
  readonly moves: readonly (readonly [number, number])[];
  /** False when the offline exact search ran out of budget; par is then best-found. */
  readonly optimal: boolean;
}

interface CampaignFile {
  readonly version: number;
  readonly levels: readonly StoredLevel[];
}

const stored = new Map<number, StoredLevel>();
for (const level of (campaignJson as unknown as CampaignFile).levels) stored.set(level.id, level);

export function storedLevelCount(): number {
  return stored.size;
}

/** null when the level is not in the file. */
export function isStoredOptimal(id: number): boolean | null {
  return stored.get(id)?.optimal ?? null;
}

/**
 * Whether the stored entry for `id` is self-consistent under the *current*
 * rules (its line replays to a win in exactly `par` moves). The test suite
 * asserts this so a rules change can never silently demote a level to the
 * on-device generator fallback.
 */
export function isStoredValid(id: number): boolean {
  const entry = stored.get(id);
  if (!entry) return false;
  const rules = rulesFor(getLevelSpec(id));
  const work = cloneBoard(entry.board);
  let n = 0;
  for (const [from, to] of entry.moves) {
    if (!applyPour(work, from, to, rules)) return false;
    n += 1;
  }
  return n === entry.par && isSolved(work, rules);
}

/**
 * The level as the player will see it. Uses the precomputed board and line
 * when present and self-consistent (the line must replay to a win in exactly
 * `par` moves); otherwise generates on the spot, which is identical by
 * construction, just slower.
 */
export function getCampaignLevel(id: number): GeneratedLevel {
  const spec = getLevelSpec(id);
  const entry = stored.get(id);
  if (entry) {
    const rules = rulesFor(spec);
    const board = cloneBoard(entry.board);
    const work = cloneBoard(board);
    const solution: Move[] = [];
    let valid = true;
    for (const [from, to] of entry.moves) {
      const move = applyPour(work, from, to, rules);
      if (!move) {
        valid = false;
        break;
      }
      solution.push(move);
    }
    if (valid && isSolved(work, rules) && solution.length === entry.par) {
      return { spec, board, par: entry.par, solution };
    }
    console.warn(`[campaign] stored level ${id} failed validation; regenerating`);
  }
  return generateLevel(spec);
}
