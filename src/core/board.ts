import type { Board, BoardRules, ColorId, LevelSpec, Move, TopRun, Tube } from './types';

/** Units a tube holds when full. Every colour contributes exactly this many. */
export const TUBE_CAPACITY = 4;

/** Classic rules: every vessel is an ordinary tube. */
export const DEFAULT_RULES: BoardRules = { cauldron: false };

/**
 * The rules a level spec plays under. The cauldron, when present, is tube 0;
 * the locked bottle is the first *filled* tube (index 1 with a cauldron, else
 * 0); the one-way flask is the last tube, after the ordinary empties.
 */
export function rulesFor(
  spec: Pick<LevelSpec, 'cauldron' | 'lock' | 'oneWay'> & Partial<Pick<LevelSpec, 'colors' | 'empties'>>,
): BoardRules {
  if (!spec.cauldron && !spec.lock && !spec.oneWay) return DEFAULT_RULES;
  const rules: { cauldron: boolean; lock?: BoardRules['lock']; oneWay?: BoardRules['oneWay'] } = {
    cauldron: !!spec.cauldron,
  };
  if (spec.lock) rules.lock = { index: spec.cauldron ? 1 : 0, seals: spec.lock.seals };
  if (spec.oneWay) {
    if (spec.colors === undefined || spec.empties === undefined) {
      throw new Error('one-way flask rules need colors and empties to place the flask');
    }
    rules.oneWay = { index: spec.colors + spec.empties + (spec.cauldron ? 1 : 0) };
  }
  return rules;
}

/** Index of the cauldron under these rules, or -1 when there is none. */
function cauldronIndex(rules: BoardRules): number {
  return rules.cauldron ? 0 : -1;
}

/** Index of the one-way flask under these rules, or -1 when there is none. */
export function oneWayIndex(rules: BoardRules): number {
  return rules.oneWay ? rules.oneWay.index : -1;
}

/** Index of the locked bottle under these rules, or -1 when there is none. */
export function lockIndex(rules: BoardRules): number {
  return rules.lock ? rules.lock.index : -1;
}

/**
 * Whether the padlock is currently engaged: fewer than `seals` ordinary
 * bottles (not the cauldron, not the locked bottle itself) are complete.
 * A pure function of the board, so undo re-locks and the solver needs no
 * extra state.
 */
export function lockActive(board: Board, rules: BoardRules): boolean {
  if (!rules.lock) return false;
  const ci = cauldronIndex(rules);
  const li = rules.lock.index;
  let sealed = 0;
  for (let i = 0; i < board.length; i++) {
    if (i === li || i === ci) continue;
    if (isComplete(board[i] as Tube)) {
      sealed += 1;
      if (sealed >= rules.lock.seals) return false;
    }
  }
  return true;
}

/** Bottles still to seal before the lock opens (0 when open or absent). */
export function sealsRemaining(board: Board, rules: BoardRules): number {
  if (!rules.lock) return 0;
  const ci = cauldronIndex(rules);
  let sealed = 0;
  for (let i = 0; i < board.length; i++) {
    if (i === rules.lock.index || i === ci) continue;
    if (isComplete(board[i] as Tube)) sealed += 1;
  }
  return Math.max(0, rules.lock.seals - sealed);
}

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
 * and the target is either empty, colour-matched - or the Cauldron, which
 * accepts anything.
 *
 * Deliberately permissive - it mirrors what a player is allowed to tap, which
 * includes some pointless-but-legal moves. The solver filters those separately
 * via `usefulMoves`.
 */
export function canPour(
  board: Board, from: number, to: number, rules: BoardRules = DEFAULT_RULES,
): boolean {
  if (from === to) return false;
  const src = board[from];
  const dst = board[to];
  if (!src || !dst) return false;
  if (src.length === 0) return false;
  if (dst.length >= TUBE_CAPACITY) return false;
  // Nothing ever leaves the one-way flask.
  if (rules.oneWay && from === rules.oneWay.index) return false;
  // A padlocked bottle takes part in nothing until the lock opens.
  if (rules.lock && (from === rules.lock.index || to === rules.lock.index) && lockActive(board, rules)) {
    return false;
  }
  if (dst.length === 0) return true;
  if (to === cauldronIndex(rules)) return true;
  return src[src.length - 1] === dst[dst.length - 1];
}

/** How many units would actually transfer. 0 when the pour is illegal. */
export function pourAmount(
  board: Board, from: number, to: number, rules: BoardRules = DEFAULT_RULES,
): number {
  if (!canPour(board, from, to, rules)) return 0;
  const src = board[from] as Tube;
  const dst = board[to] as Tube;
  const run = topRun(src) as TopRun;
  return Math.min(run.count, TUBE_CAPACITY - dst.length);
}

/**
 * Mutates `board`, moving the top run from `from` into `to`.
 * Returns the resulting Move, or null if the pour was not legal.
 */
export function applyPour(
  board: Board, from: number, to: number, rules: BoardRules = DEFAULT_RULES,
): Move | null {
  const count = pourAmount(board, from, to, rules);
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

/**
 * Won when every non-empty tube is full and single-coloured - and, under
 * cauldron rules, the cauldron itself has been emptied out again.
 */
export function isSolved(board: Board, rules: BoardRules = DEFAULT_RULES): boolean {
  const ci = cauldronIndex(rules);
  if (ci >= 0 && (board[ci] as Tube).length > 0) return false;
  // The one-way flask must be filled, not merely left alone.
  if (rules.oneWay && (board[rules.oneWay.index] as Tube).length !== TUBE_CAPACITY) return false;
  for (const tube of board) {
    if (tube.length === 0) continue;
    if (!isComplete(tube)) return false;
  }
  return true;
}

/** Every pour the player could legally tap right now. */
export function legalMoves(board: Board, rules: BoardRules = DEFAULT_RULES): Move[] {
  const moves: Move[] = [];
  for (let from = 0; from < board.length; from++) {
    for (let to = 0; to < board.length; to++) {
      const count = pourAmount(board, from, to, rules);
      if (count > 0) {
        const src = board[from] as Tube;
        moves.push({ from, to, count, color: src[src.length - 1] as ColorId });
      }
    }
  }
  return moves;
}

/** True when the player is stuck: not solved and nothing legal remains. */
export function isDeadlocked(board: Board, rules: BoardRules = DEFAULT_RULES): boolean {
  return !isSolved(board, rules) && legalMoves(board, rules).length === 0;
}

/**
 * Search-space version of `legalMoves`, pruned of provably useless pours:
 *  - never disturb a finished tube (the cauldron is never "finished" - even
 *    full and uniform it still has to be emptied),
 *  - never move a whole uniform tube into empty space (pure relabelling; into
 *    the empty cauldron it is strictly worse, since it must come back out) -
 *    except *out of* the cauldron, where that exact move is required progress,
 *  - only ever use the first empty ordinary tube, since those are
 *    interchangeable (the empty cauldron is not: it plays by other rules).
 */
export function usefulMoves(board: Board, rules: BoardRules = DEFAULT_RULES): Move[] {
  const ci = cauldronIndex(rules);
  const ow = oneWayIndex(rules);
  // While the padlock holds, the locked bottle is simply not on the board.
  const li = rules.lock && lockActive(board, rules) ? rules.lock.index : -1;
  const moves: Move[] = [];
  let firstEmpty = -1;
  for (let i = 0; i < board.length; i++) {
    // Neither the cauldron nor the one-way flask is an interchangeable empty.
    if (i === ci || i === ow) continue;
    if ((board[i] as Tube).length === 0) {
      firstEmpty = i;
      break;
    }
  }

  for (let from = 0; from < board.length; from++) {
    if (from === li || from === ow) continue;
    const src = board[from] as Tube;
    if (src.length === 0) continue;
    if (from !== ci && isComplete(src)) continue;

    const run = topRun(src) as TopRun;
    const srcUniform = run.count === src.length;

    for (let to = 0; to < board.length; to++) {
      if (to === from || to === li) continue;
      const dst = board[to] as Tube;
      if (dst.length === 0) {
        // Moving a whole uniform tube into ordinary empty space is pure
        // relabelling - but into the empty one-way flask it is a real choice
        // (it commits that colour and frees an ordinary tube), so allow it.
        if (srcUniform && from !== ci && to !== ow) continue;
        if (to !== firstEmpty && to !== ci && to !== ow) continue;
      }
      const count = pourAmount(board, from, to, rules);
      if (count > 0) moves.push({ from, to, count, color: run.color });
    }
  }
  return moves;
}

/**
 * Order-independent board fingerprint. Ordinary tubes are interchangeable, so
 * sorting their encodings collapses huge numbers of equivalent states - this
 * is the single biggest win in the solver. The cauldron is *not*
 * interchangeable, so it is fingerprinted separately in front. So is the
 * locked bottle *while the lock holds*; once open it is an ordinary tube,
 * and along useful lines the lock never re-engages (complete tubes are never
 * disturbed), so folding it back in is safe.
 */
export function canonicalKey(board: Board, rules: BoardRules = DEFAULT_RULES): string {
  const ci = cauldronIndex(rules);
  const ow = oneWayIndex(rules);
  const li = rules.lock && lockActive(board, rules) ? rules.lock.index : -1;
  const parts: string[] = [];
  for (let i = 0; i < board.length; i++) {
    if (i === ci || i === li || i === ow) continue;
    parts.push((board[i] as Tube).join(','));
  }
  parts.sort();
  let key = parts.join('|');
  // The one-way flask is never interchangeable: its contents can never leave.
  if (ow >= 0) key = `W${(board[ow] as Tube).join(',')}#${key}`;
  if (li >= 0) key = `L${(board[li] as Tube).join(',')}#${key}`;
  if (ci >= 0) key = `${(board[ci] as Tube).join(',')}#${key}`;
  return key;
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
