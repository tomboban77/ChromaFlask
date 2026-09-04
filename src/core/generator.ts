import { TUBE_CAPACITY, cloneBoard, isSolved, isUniform } from './board';
import { mulberry32, shuffle } from './rng';
import { solve } from './solver';
import type { Board, ColorId, GeneratedLevel, LevelSpec } from './types';

/** Deal all colour units into the filled tubes, leaving `empties` spare. */
function deal(spec: LevelSpec, attempt: number): Board {
  const rng = mulberry32(spec.id * 7919 + attempt * 104_729 + 1);

  const units: ColorId[] = [];
  for (let c = 0; c < spec.colors; c++) {
    for (let i = 0; i < TUBE_CAPACITY; i++) units.push(c);
  }
  shuffle(units, rng);

  const board: Board = [];
  for (let t = 0; t < spec.colors; t++) {
    board.push(units.slice(t * TUBE_CAPACITY, (t + 1) * TUBE_CAPACITY));
  }
  for (let e = 0; e < spec.empties; e++) board.push([]);
  return board;
}

/** Reject boards that hand the player free progress before they start. */
function isTooEasy(board: Board, spec: LevelSpec): boolean {
  if (isSolved(board)) return true;
  if (spec.colors < 3) return false;
  // Any tube already sorted makes the opening feel unearned.
  return board.some((tube) => tube.length > 0 && isUniform(tube));
}

/**
 * Build the puzzle for a level. Deterministic: the same `spec.id` always
 * produces the same board for every player on every device.
 *
 * Every returned board is proven solvable by actually solving it, and `par` is
 * the optimal move count wherever A* completes inside its budget.
 */
export function generateLevel(spec: LevelSpec): GeneratedLevel {
  const MAX_ATTEMPTS = 400;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const board = deal(spec, attempt);
    if (isTooEasy(board, spec)) continue;

    // Cheap solvability gate first - most rejections die here.
    const quick = solve(board, { weight: 3, maxNodes: 40_000 });
    if (!quick) continue;

    // Then spend real budget finding the true optimum for a fair star target.
    const exact = solve(board, { weight: 1, maxNodes: 250_000 });
    const best = exact ?? quick;
    if (best.solution.length < spec.minPar) continue;

    return {
      spec,
      board: cloneBoard(board),
      par: best.solution.length,
      solution: best.solution,
    };
  }

  throw new Error(`Failed to generate level ${spec.id} within ${MAX_ATTEMPTS} attempts`);
}
