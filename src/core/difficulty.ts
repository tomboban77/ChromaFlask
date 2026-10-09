import { TUBE_CAPACITY, applyPour, canonicalKey, cloneBoard, isSolved, usefulMoves } from './board';
import { mulberry32 } from './rng';
import type { Board, BoardRules, Move } from './types';

/**
 * How hard a board *feels*, as opposed to how long it is.
 *
 * Par alone turned out to be the wrong dial (player feedback, 2026-10-09:
 * "very easy"): raising the eight-colour floor from 21 to 27 moved a
 * no-lookahead player's win rate from 31% to... 24%. A long board that
 * forgives every greedy pour is still a board nobody has to think about.
 *
 * Forgiveness measures that directly: the share of casual playouts that win.
 * The casual player stacks onto matching colours whenever it can, prefers
 * pours that finish or clear a tube, never repeats a position, and otherwise
 * picks at random - the way people actually play this genre before they learn
 * to plan. A board where the obvious pours lead into dead ends scores near 0;
 * one that forgives anything scores near 1.
 */
const MAX_STEPS = 200;
const PLAYOUTS = 32;

function casualPlayout(board0: Board, rules: BoardRules, seed: number): boolean {
  const rng = mulberry32(seed);
  const board = cloneBoard(board0);
  const seen = new Set<string>([canonicalKey(board, rules)]);

  for (let step = 0; step < MAX_STEPS; step++) {
    if (isSolved(board, rules)) return true;
    let best: Move | null = null;
    let bestScore = -1;
    let bestKey = '';
    for (const move of usefulMoves(board, rules)) {
      const next = cloneBoard(board);
      applyPour(next, move.from, move.to, rules);
      const key = canonicalKey(next, rules);
      if (seen.has(key)) continue;

      const src = board[move.from] as number[];
      const dst = board[move.to] as number[];
      let score = rng() * 0.5;
      if (dst.length > 0) score += 3; // stack onto a match
      if (src.length === move.count) score += 1; // clear the source
      if (dst.length + move.count === TUBE_CAPACITY) score += 1; // fill the target
      if (score > bestScore) {
        best = move;
        bestScore = score;
        bestKey = key;
      }
    }
    if (!best) return false;
    applyPour(board, best.from, best.to, rules);
    seen.add(bestKey);
  }
  return false;
}

/**
 * Share of `playouts` casual playouts that win, 0..1. Deterministic per seed,
 * so the generator stays byte-identical on every device. A few ms on a
 * desktop for a ten-tube board.
 */
export function forgiveness(board: Board, rules: BoardRules, seed: number, playouts = PLAYOUTS): number {
  let wins = 0;
  for (let k = 0; k < playouts; k++) {
    if (casualPlayout(board, rules, seed * 1009 + k)) wins++;
  }
  return wins / playouts;
}

/**
 * Whether `forgiveness(board, rules, seed)` falls inside [min, max] - the
 * same answer, but it stops as soon as the outcome is settled. Most deals are
 * rejected for forgiving too much, and those cross the ceiling within a few
 * playouts, so this is several times cheaper than the full measurement.
 */
export function forgivenessWithin(
  board: Board, rules: BoardRules, seed: number, band: { readonly min: number; readonly max: number },
): boolean {
  const maxWins = Math.floor(band.max * PLAYOUTS + 1e-9);
  const minWins = Math.ceil(band.min * PLAYOUTS - 1e-9);
  let wins = 0;
  for (let k = 0; k < PLAYOUTS; k++) {
    if (casualPlayout(board, rules, seed * 1009 + k)) wins++;
    if (wins > maxWins) return false;
    if (wins + (PLAYOUTS - 1 - k) < minWins) return false;
  }
  return true;
}
