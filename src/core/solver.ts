import { applyPour, canonicalKey, cloneBoard, countRuns, isSolved, usefulMoves } from './board';
import type { Board, Move } from './types';

/** Binary min-heap keyed on a numeric priority. */
class MinHeap {
  private readonly pri: number[] = [];
  private readonly val: number[] = [];

  get size(): number {
    return this.pri.length;
  }

  push(priority: number, value: number): void {
    this.pri.push(priority);
    this.val.push(value);
    let i = this.pri.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.pri[parent] as number) <= (this.pri[i] as number)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    const n = this.pri.length;
    if (n === 0) return undefined;
    const top = this.val[0] as number;
    const lastPri = this.pri.pop() as number;
    const lastVal = this.val.pop() as number;
    if (n > 1) {
      this.pri[0] = lastPri;
      this.val[0] = lastVal;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < this.pri.length && (this.pri[l] as number) < (this.pri[best] as number)) best = l;
        if (r < this.pri.length && (this.pri[r] as number) < (this.pri[best] as number)) best = r;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const p = this.pri[a] as number;
    this.pri[a] = this.pri[b] as number;
    this.pri[b] = p;
    const v = this.val[a] as number;
    this.val[a] = this.val[b] as number;
    this.val[b] = v;
  }
}

export interface SolveOptions {
  /**
   * Heuristic weight. 1 = admissible A*, giving a provably optimal solution
   * length (what we want for a fair 3-star par). Values > 1 trade optimality
   * for speed and are used as the fallback on very large boards.
   */
  weight?: number;
  maxNodes?: number;
}

export interface SolveResult {
  readonly solution: Move[];
  readonly nodesExpanded: number;
  /** True when the search ran admissibly and therefore found a shortest line. */
  readonly optimal: boolean;
}

/** Distinct colours present on the board. */
function colorCount(board: Board): number {
  const seen = new Set<number>();
  for (const tube of board) for (const c of tube) seen.add(c);
  return seen.size;
}

/**
 * Admissible heuristic: total colour runs minus the number of colours.
 *
 * A solved board has exactly one run per colour. A single pour merges at most
 * one pair of runs, so it can reduce this count by at most 1 - meaning the
 * estimate never overshoots the true remaining move count. It is also
 * consistent, so a closed-set A* is safe.
 */
function heuristic(board: Board, colors: number): number {
  return countRuns(board) - colors;
}

/**
 * A* over interchangeable-tube-canonicalised states.
 * Returns null if the board is unsolvable or the node budget was exhausted.
 */
export function solve(board: Board, opts: SolveOptions = {}): SolveResult | null {
  const weight = opts.weight ?? 1;
  const maxNodes = opts.maxNodes ?? 200_000;
  const colors = colorCount(board);

  if (isSolved(board)) return { solution: [], nodesExpanded: 0, optimal: true };

  const boards: Board[] = [cloneBoard(board)];
  const parent: number[] = [-1];
  const viaMove: (Move | null)[] = [null];
  const gScore: number[] = [0];

  const open = new MinHeap();
  open.push(weight * heuristic(board, colors), 0);

  const bestG = new Map<string, number>();
  bestG.set(canonicalKey(board), 0);

  let expanded = 0;

  while (open.size > 0) {
    const id = open.pop() as number;
    const current = boards[id] as Board;
    const g = gScore[id] as number;

    const key = canonicalKey(current);
    // A stale queue entry for a state we have since reached more cheaply.
    if ((bestG.get(key) as number) < g) continue;

    if (isSolved(current)) {
      const solution: Move[] = [];
      for (let n = id; n !== 0 && n !== -1; n = parent[n] as number) {
        solution.push(viaMove[n] as Move);
      }
      solution.reverse();
      return { solution, nodesExpanded: expanded, optimal: weight === 1 };
    }

    expanded++;
    if (expanded > maxNodes) return null;

    for (const move of usefulMoves(current)) {
      const next = cloneBoard(current);
      applyPour(next, move.from, move.to);
      const nextKey = canonicalKey(next);
      const nextG = g + 1;

      const known = bestG.get(nextKey);
      if (known !== undefined && known <= nextG) continue;
      bestG.set(nextKey, nextG);

      const nid = boards.length;
      boards.push(next);
      parent.push(id);
      viaMove.push(move);
      gScore.push(nextG);
      open.push(nextG + weight * heuristic(next, colors), nid);
    }
  }

  return null;
}

/**
 * Best next move from an arbitrary position, for the Hint powerup.
 * Falls back to a fast weighted search if the optimal one is too expensive.
 */
export function findHint(board: Board): Move | null {
  const fast = solve(board, { weight: 2, maxNodes: 60_000 });
  if (fast && fast.solution.length > 0) return fast.solution[0] as Move;
  const exact = solve(board, { weight: 1, maxNodes: 150_000 });
  if (exact && exact.solution.length > 0) return exact.solution[0] as Move;
  return null;
}

/** Whether a winning line exists from here (used to warn before a dead end). */
export function isSolvable(board: Board): boolean {
  return solve(board, { weight: 2, maxNodes: 80_000 }) !== null;
}
