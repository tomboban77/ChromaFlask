/**
 * Core self-test. Run with `npm run test:core`.
 * Validates the rules engine, solver optimality and generator determinism
 * without needing a browser or any rendering.
 */
import {
  TUBE_CAPACITY, applyPour, canPour, canonicalKey, cloneBoard, isDeadlocked,
  isSolved, legalMoves, pourAmount, topRun, undoPour,
} from './board';
import { generateLevel } from './generator';
import { LEVELS } from './levels';
import { solve } from './solver';
import type { Board, Move } from './types';

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return; }
  failures.push(`${name}${detail ? ` -- ${detail}` : ''}`);
}

/** Independent brute-force shortest solution, to audit the A* par. */
function bfsOptimal(board: Board, cap = 400_000): number | null {
  const start = canonicalKey(board);
  if (isSolved(board)) return 0;
  const seen = new Set<string>([start]);
  let frontier: Board[] = [cloneBoard(board)];
  let depth = 0;
  let visited = 0;
  while (frontier.length) {
    depth++;
    const next: Board[] = [];
    for (const b of frontier) {
      for (const mv of legalMoves(b)) {
        const nb = cloneBoard(b);
        applyPour(nb, mv.from, mv.to);
        if (isSolved(nb)) return depth;
        const k = canonicalKey(nb);
        if (seen.has(k)) continue;
        seen.add(k);
        if (++visited > cap) return null;
        next.push(nb);
      }
    }
    frontier = next;
  }
  return null;
}

function replay(board: Board, moves: readonly Move[]): Board {
  const b = cloneBoard(board);
  for (const mv of moves) {
    const applied = applyPour(b, mv.from, mv.to);
    if (!applied) throw new Error(`illegal move in solution: ${mv.from}->${mv.to}`);
  }
  return b;
}

// ---------------------------------------------------------------- rules
{
  check('topRun empty', topRun([]) === null);
  const t = [0, 1, 1, 1];
  check('topRun counts run', topRun(t)?.count === 3 && topRun(t)?.color === 1);

  const b: Board = [[0, 1, 1], [1], []];
  check('pour onto matching colour', canPour(b, 0, 1));
  check('pour into empty', canPour(b, 0, 2));
  check('no self-pour', !canPour(b, 0, 0));
  check('no pour from empty', !canPour(b, 2, 0));

  const full: Board = [[0], [1, 1, 1, 1]];
  check('no pour into full tube', !canPour(full, 0, 1));

  const mismatch: Board = [[0], [1]];
  check('no pour onto wrong colour', !canPour(mismatch, 0, 1));

  const partial: Board = [[1, 1, 1], [1, 1]];
  check('pour clamps to remaining space', pourAmount(partial, 0, 1) === 2);

  // apply / undo must round-trip exactly
  const before: Board = [[0, 1, 1], [1], []];
  const work = cloneBoard(before);
  const mv = applyPour(work, 0, 1) as Move;
  check('applyPour returns move', mv !== null && mv.count === 2 && mv.color === 1);
  undoPour(work, mv);
  check('undo restores board', JSON.stringify(work) === JSON.stringify(before));

  check('isSolved: full uniform tubes', isSolved([[0, 0, 0, 0], [], [1, 1, 1, 1]]));
  check('isSolved: rejects partial uniform', !isSolved([[0, 0], [0, 0]]));
  check('deadlock detection', isDeadlocked([[0, 1, 0, 1], [1, 0, 1, 0]]));

  check(
    'canonicalKey ignores tube order',
    canonicalKey([[0, 1], [2], []]) === canonicalKey([[2], [], [0, 1]]),
  );
  check(
    'canonicalKey distinguishes contents',
    canonicalKey([[0, 1]]) !== canonicalKey([[1, 0]]),
  );
}

// --------------------------------------------------------------- solver
{
  const trivial: Board = [[0, 0, 0], [0], []];
  const r = solve(trivial);
  check('solves trivial board', r !== null && isSolved(replay(trivial, r.solution)));

  const unsolvable: Board = [[0, 1, 0, 1], [1, 0, 1, 0]];
  check('reports unsolvable board', solve(unsolvable, { maxNodes: 50_000 }) === null);

  // Audit A* optimality against independent BFS on small boards.
  let audited = 0;
  for (let seed = 0; seed < 6; seed++) {
    const spec = { id: 100 + seed, colors: 3, empties: 1, minPar: 1, name: 'audit' };
    const gen = generateLevel(spec);
    const bfs = bfsOptimal(gen.board);
    if (bfs === null) continue;
    audited++;
    check(
      `A* par is optimal (audit seed ${seed})`,
      gen.par === bfs,
      `A*=${gen.par} bfs=${bfs}`,
    );
  }
  check('optimality audit actually ran', audited >= 4, `audited=${audited}`);
}

// ------------------------------------------------------------ generator
{
  console.log('\n  level  colors  empties  tubes  par   gen(ms)');
  console.log('  ' + '-'.repeat(46));

  for (const spec of LEVELS) {
    const t0 = performance.now();
    const gen = generateLevel(spec);
    const ms = performance.now() - t0;

    const tubes = spec.colors + spec.empties;
    console.log(
      `  ${String(spec.id).padStart(5)}  ${String(spec.colors).padStart(6)}` +
      `  ${String(spec.empties).padStart(7)}  ${String(tubes).padStart(5)}` +
      `  ${String(gen.par).padStart(3)}  ${ms.toFixed(1).padStart(8)}`,
    );

    check(`L${spec.id} tube count`, gen.board.length === tubes);
    check(`L${spec.id} not pre-solved`, !isSolved(gen.board));
    check(`L${spec.id} meets minPar`, gen.par >= spec.minPar, `par=${gen.par} min=${spec.minPar}`);
    check(`L${spec.id} solution wins`, isSolved(replay(gen.board, gen.solution)));
    check(`L${spec.id} solution length == par`, gen.solution.length === gen.par);
    check(`L${spec.id} generates under 2s`, ms < 2000, `${ms.toFixed(0)}ms`);

    // conservation: exactly TUBE_CAPACITY units of each colour
    const counts = new Map<number, number>();
    for (const tube of gen.board) {
      check(`L${spec.id} tube within capacity`, tube.length <= TUBE_CAPACITY);
      for (const c of tube) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    check(`L${spec.id} colour count`, counts.size === spec.colors);
    check(
      `L${spec.id} conserves units`,
      [...counts.values()].every((n) => n === TUBE_CAPACITY),
    );

    // determinism: regenerating must be byte-identical
    const again = generateLevel(spec);
    check(
      `L${spec.id} deterministic`,
      JSON.stringify(again.board) === JSON.stringify(gen.board),
    );
  }
}

console.log(`\n  ${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n  FAILURES:');
  for (const f of failures) console.log(`   x ${f}`);
  process.exit(1);
}
console.log('  core OK\n');
