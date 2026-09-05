import { TUBE_CAPACITY, cloneBoard, isSolved, isUniform, rulesFor } from './board';
import { mulberry32, shuffle } from './rng';
import { solve } from './solver';
import type { Board, ColorId, GeneratedLevel, LevelSpec } from './types';

/**
 * Deal all colour units into the filled tubes, leaving `empties` spare.
 * On cauldron levels the cauldron sits at index 0 and starts empty.
 */
function deal(spec: LevelSpec, attempt: number): Board {
  const rng = mulberry32(spec.id * 7919 + attempt * 104_729 + 1);

  const units: ColorId[] = [];
  for (let c = 0; c < spec.colors; c++) {
    for (let i = 0; i < TUBE_CAPACITY; i++) units.push(c);
  }
  shuffle(units, rng);

  const board: Board = [];
  if (spec.cauldron) board.push([]);
  for (let t = 0; t < spec.colors; t++) {
    board.push(units.slice(t * TUBE_CAPACITY, (t + 1) * TUBE_CAPACITY));
  }
  for (let e = 0; e < spec.empties; e++) board.push([]);
  // The one-way flask is an extra empty vessel, always last.
  if (spec.oneWay) board.push([]);
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
  const rules = rulesFor(spec);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const board = deal(spec, attempt);
    if (isTooEasy(board, spec)) continue;

    // Cheap solvability gate first - most rejections die here.
    const quick = solve(board, { weight: 3, maxNodes: 40_000, rules });
    if (!quick) continue;

    // The weighted line is never shorter than the optimum, so a quick line
    // already under minPar proves the board is too easy - skip the exact
    // solve. Same boards accepted, at a fraction of the retry cost.
    if (quick.solution.length < spec.minPar) continue;

    // Then spend real budget finding the true optimum for a fair star target.
    // Cauldron boards branch much harder, so their exact pass gets a tighter
    // node budget with a near-optimal (within 25%, node-budgeted, still
    // deterministic) fallback for the rare pathological deal.
    const exactBudget = spec.cauldron ? 60_000 : 250_000;
    const exact =
      solve(board, { weight: 1, maxNodes: exactBudget, rules }) ??
      (spec.cauldron ? solve(board, { weight: 1.25, maxNodes: 60_000, rules }) : null);
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
