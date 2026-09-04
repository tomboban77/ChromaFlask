import type { Board, ColorId, Move, TopRun, Tube } from './types';

/** Units a tube holds when full. Every colour contributes exactly this many. */
export const TUBE_CAPACITY = 4;

export function cloneBoard(board: Board): Board {
  return board.map((tube) => tube.slice());
}

/** The contiguous same-colour block at the mouth, or null for an empty tube. */
export function topRun(tube: Tube): TopRun | null {
  const n = tube.length;
  if (n === 0) return null;
  const color = tube[n - 1] as ColorId;
  let count = 1;
  for (let i = n - 2; i >= 0 && tube[i] === color; i--) count++;
  return { color, count };
}

/** True when every unit in the tube is the same colour (empty counts as true). */
export function isUniform(tube: Tube): boolean {
  if (tube.length <= 1) return true;
  const first = tube[0];
  for (let i = 1; i < tube.length; i++) if (tube[i] !== first) return false;
  return true;
}

/** A tube is "locked in" once it is full and single-coloured. */
export function isComplete(tube: Tube): boolean {
  return tube.length === TUBE_CAPACITY && isUniform(tube);
}

/**
 * Game rule: a pour is legal when the source has liquid, the target has room,
 * and the target is either empty or its top colour matches.
 *
 * Deliberately permissive - it mirrors what a player is allowed to tap, which
 * includes some pointless-but-legal moves. The solver filters those separately
 * via `usefulMoves`.
 */
export function canPour(board: Board, from: number, to: number): boolean {
  if (from === to) return false;
  const src = board[from];
  const dst = board[to];
  if (!src || !dst) return false;
  if (src.length === 0) return false;
  if (dst.length >= TUBE_CAPACITY) return false;
  if (dst.length === 0) return true;
  return src[src.length - 1] === dst[dst.length - 1];
}

/** How many units would actually transfer. 0 when the pour is illegal. */
export function pourAmount(board: Board, from: number, to: number): number {
  if (!canPour(board, from, to)) return 0;
  const src = board[from] as Tube;
  const dst = board[to] as Tube;
  const run = topRun(src) as TopRun;
  return Math.min(run.count, TUBE_CAPACITY - dst.length);
}

/**
 * Mutates `board`, moving the top run from `from` into `to`.
 * Returns the resulting Move, or null if the pour was not legal.
 */
export function applyPour(board: Board, from: number, to: number): Move | null {
  const count = pourAmount(board, from, to);
  if (count === 0) return null;
  const src = board[from] as Tube;
  const dst = board[to] as Tube;
  const color = src[src.length - 1] as ColorId;
  for (let i = 0; i < count; i++) dst.push(src.pop() as ColorId);
  return { from, to, count, color };
}

/** Reverses a previously applied Move. Assumes the board is in the post-move state. */
export function undoPour(board: Board, move: Move): void {
  const src = board[move.from] as Tube;
  const dst = board[move.to] as Tube;
  for (let i = 0; i < move.count; i++) src.push(dst.pop() as ColorId);
}

/** Won when every non-empty tube is full and single-coloured. */
export function isSolved(board: Board): boolean {
  for (const tube of board) {
    if (tube.length === 0) continue;
    if (!isComplete(tube)) return false;
  }
  return true;
}

/** Every pour the player could legally tap right now. */
export function legalMoves(board: Board): Move[] {
  const moves: Move[] = [];
  for (let from = 0; from < board.length; from++) {
    for (let to = 0; to < board.length; to++) {
      const count = pourAmount(board, from, to);
      if (count > 0) {
        const src = board[from] as Tube;
        moves.push({ from, to, count, color: src[src.length - 1] as ColorId });
      }
    }
  }
  return moves;
}

/** True when the player is stuck: not solved and nothing legal remains. */
export function isDeadlocked(board: Board): boolean {
  return !isSolved(board) && legalMoves(board).length === 0;
}

/**
 * Search-space version of `legalMoves`, pruned of provably useless pours:
 *  - never disturb a finished tube,
 *  - never move a whole uniform tube into an empty one (pure relabelling),
 *  - only ever use the first empty tube, since empty tubes are interchangeable.
 */
export function usefulMoves(board: Board): Move[] {
  const moves: Move[] = [];
  let firstEmpty = -1;
  for (let i = 0; i < board.length; i++) {
    if ((board[i] as Tube).length === 0) {
      firstEmpty = i;
      break;
    }
  }

  for (let from = 0; from < board.length; from++) {
    const src = board[from] as Tube;
    if (src.length === 0) continue;
    if (isComplete(src)) continue;

    const run = topRun(src) as TopRun;
    // Emptying a uniform tube into empty space achieves nothing.
    const srcUniform = run.count === src.length;

    for (let to = 0; to < board.length; to++) {
      if (to === from) continue;
      const dst = board[to] as Tube;
      if (dst.length === 0) {
        if (srcUniform) continue;
        if (to !== firstEmpty) continue; // empties are interchangeable
      }
      const count = pourAmount(board, from, to);
      if (count > 0) moves.push({ from, to, count, color: run.color });
    }
  }
  return moves;
}

/**
 * Order-independent board fingerprint. Tubes are interchangeable, so sorting
 * their encodings collapses huge numbers of equivalent states - this is the
 * single biggest win in the solver.
 */
export function canonicalKey(board: Board): string {
  const parts = new Array<string>(board.length);
  for (let i = 0; i < board.length; i++) parts[i] = (board[i] as Tube).join(',');
  parts.sort();
  return parts.join('|');
}

/** Total contiguous colour runs on the board. Equals colour count when solved. */
export function countRuns(board: Board): number {
  let runs = 0;
  for (const tube of board) {
    for (let i = 0; i < tube.length; i++) {
      if (i === 0 || tube[i] !== tube[i - 1]) runs++;
    }
  }
  return runs;
}
