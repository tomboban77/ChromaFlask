/**
 * Core self-test. Run with `npm run test:core`.
 * Validates the rules engine, solver optimality and generator determinism
 * without needing a browser or any rendering.
 */
import {
  DEFAULT_RULES, TUBE_CAPACITY, applyPour, canPour, canonicalKey, cloneBoard,
  isDeadlocked, isSolved, legalMoves, pourAmount, rulesFor, topRun, undoPour,
  usefulMoves,
} from './board';
import { generateLevel } from './generator';
import { LEVELS } from './levels';
import { DEFAULT_ECONOMY, coinsFor, starsFor } from './progression';
import { solvability, solve } from './solver';
import type { Board, BoardRules, Move } from './types';

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return; }
  failures.push(`${name}${detail ? ` -- ${detail}` : ''}`);
}

/** Independent brute-force shortest solution, to audit the A* par. */
function bfsOptimal(board: Board, rules: BoardRules = DEFAULT_RULES, cap = 400_000): number | null {
  const start = canonicalKey(board, rules);
  if (isSolved(board, rules)) return 0;
  const seen = new Set<string>([start]);
  let frontier: Board[] = [cloneBoard(board)];
  let depth = 0;
  let visited = 0;
  while (frontier.length) {
    depth++;
    const next: Board[] = [];
    for (const b of frontier) {
      for (const mv of legalMoves(b, rules)) {
        const nb = cloneBoard(b);
        applyPour(nb, mv.from, mv.to, rules);
        if (isSolved(nb, rules)) return depth;
        const k = canonicalKey(nb, rules);
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

function replay(board: Board, moves: readonly Move[], rules: BoardRules = DEFAULT_RULES): Board {
  const b = cloneBoard(board);
  for (const mv of moves) {
    const applied = applyPour(b, mv.from, mv.to, rules);
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

// -------------------------------------------------------------- economy
{
  const e = DEFAULT_ECONOMY;
  const firstPerfect = e.baseReward + 3 * e.rewardPerStar + e.firstClearBonus;
  check('coins: first clear pays base + stars + bonus', coinsFor(3, null, e) === firstPerfect);
  check('coins: first 1-star clear', coinsFor(1, null, e) === e.baseReward + e.rewardPerStar + e.firstClearBonus);
  // The replay farm: repeating a level must never pay for stars already owned.
  check('coins: replay at same stars pays nothing', coinsFor(3, 3, e) === 0);
  check('coins: replay at fewer stars pays nothing', coinsFor(1, 3, e) === 0);
  check('coins: replay improving 1 -> 3 pays two stars', coinsFor(3, 1, e) === 2 * e.rewardPerStar);
  check('coins: replay improving 2 -> 3 pays one star', coinsFor(3, 2, e) === e.rewardPerStar);

  check('stars: par is 3 stars', starsFor(10, 10) === 3);
  check('stars: within tolerance is 3 stars', starsFor(12, 10) === 3);
  check('stars: well past par is 1 star', starsFor(40, 10) === 1);
}

// -------------------------------------------------------- cauldron rules
{
  const R: BoardRules = { cauldron: true }; // tube 0 is the cauldron

  const mixed: Board = [[2], [0, 1], [], []];
  check('cauldron accepts a mismatched colour', canPour(mixed, 1, 0, R));
  check('classic rules still refuse that pour', !canPour(mixed, 1, 0));
  check('cauldron pours out onto a match', canPour([[1, 0], [0, 0], []], 0, 1, R));
  check('cauldron pour-out respects colour', !canPour([[1, 0], [1, 1], []], 0, 1, R));
  check('full cauldron accepts nothing', !canPour([[0, 1, 0, 1], [2]], 1, 0, R));

  const almost: Board = [[0, 0, 0, 0], [1, 1, 1, 1], []];
  check('cauldron must end empty to win', !isSolved(almost, R));
  check('same board is solved under classic rules', isSolved(almost));
  check('solved once cauldron is empty', isSolved([[], [1, 1, 1, 1], [0, 0, 0, 0]], R));

  const um = usefulMoves([[0, 0], [1, 1, 1, 1], []], R);
  check('uniform cauldron may empty into empty tube', um.some((m) => m.from === 0 && m.to === 2));
  const um2 = usefulMoves([[0, 0, 0, 0], [1, 1], []], R);
  check('full uniform cauldron never locks in', um2.some((m) => m.from === 0));

  check(
    'cauldron key is position-sensitive',
    canonicalKey([[0], [1], []], R) !== canonicalKey([[1], [0], []], R),
  );
  check(
    'ordinary tubes stay interchangeable under cauldron rules',
    canonicalKey([[2], [0, 1], []], R) === canonicalKey([[2], [], [0, 1]], R),
  );

  const cb: Board = [[], [0, 1, 0, 1], [1, 0, 1, 0], [], []];
  const res = solve(cb, { rules: R });
  check(
    'solves a cauldron board end to end',
    res !== null && isSolved(replay(cb, res.solution, R), R),
  );
}

// --------------------------------------------------------------- solver
{
  const trivial: Board = [[0, 0, 0], [0], []];
  const r = solve(trivial);
  check('solves trivial board', r !== null && isSolved(replay(trivial, r.solution)));

  const unsolvable: Board = [[0, 1, 0, 1], [1, 0, 1, 0]];
  check('reports unsolvable board', solve(unsolvable, { maxNodes: 50_000 }) === null);

  // Three-way solvability: 'unsolvable' must be a proof, never a budget guess.
  check('solvability: solvable', solvability([[0, 0, 0], [0], []]) === 'solvable');
  check('solvability: proven unsolvable', solvability(unsolvable) === 'unsolvable');
  const big = generateLevel({ id: 400, colors: 6, empties: 2, minPar: 10, name: 'x' });
  check(
    'solvability: tiny budget stays unknown, not false-negative',
    solvability(big.board, undefined, 10) === 'unknown',
  );

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

  // Same audit under cauldron rules - the pruning in usefulMoves must never
  // cost the solver a shorter line that full BFS can find.
  let cauldronAudited = 0;
  for (let seed = 0; seed < 6; seed++) {
    const spec = {
      id: 300 + seed, colors: 3, empties: 1, minPar: 1, name: 'audit', cauldron: true,
    };
    const gen = generateLevel(spec);
    const bfs = bfsOptimal(gen.board, rulesFor(spec));
    if (bfs === null) continue;
    cauldronAudited++;
    check(
      `A* par optimal with cauldron (seed ${seed})`,
      gen.par === bfs,
      `A*=${gen.par} bfs=${bfs}`,
    );
  }
  check('cauldron optimality audit ran', cauldronAudited >= 4, `audited=${cauldronAudited}`);
}

// ------------------------------------------------------------ generator
{
  console.log('\n  level  colors  empties  tubes  par  flags   gen(ms)');
  console.log('  ' + '-'.repeat(52));

  let worstMs = 0;
  let worstId = 0;
  let totalMs = 0;
  let lastPrinted = 0;

  for (const spec of LEVELS) {
    const t0 = performance.now();
    const gen = generateLevel(spec);
    const ms = performance.now() - t0;
    totalMs += ms;
    if (ms > worstMs) {
      worstMs = ms;
      worstId = spec.id;
    }

    const rules = rulesFor(spec);
    const tubes = spec.colors + spec.empties + (spec.cauldron ? 1 : 0);
    const flags = `${spec.cauldron ? 'C' : '·'}${spec.murky ? 'M' : '·'}`;
    // 200 rows would drown the signal: print band edges and anything slow.
    if (spec.id - lastPrinted >= 10 || spec.id <= 10 || ms > 300) {
      lastPrinted = spec.id;
      console.log(
        `  ${String(spec.id).padStart(5)}  ${String(spec.colors).padStart(6)}` +
        `  ${String(spec.empties).padStart(7)}  ${String(tubes).padStart(5)}` +
        `  ${String(gen.par).padStart(3)}  ${flags.padStart(5)}` +
        `  ${ms.toFixed(1).padStart(8)}`,
      );
    }

    check(`L${spec.id} tube count`, gen.board.length === tubes);
    check(`L${spec.id} not pre-solved`, !isSolved(gen.board, rules));
    check(`L${spec.id} meets minPar`, gen.par >= spec.minPar, `par=${gen.par} min=${spec.minPar}`);
    check(`L${spec.id} solution wins`, isSolved(replay(gen.board, gen.solution, rules), rules));
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

  console.log(
    `\n  ${LEVELS.length} levels verified - total ${(totalMs / 1000).toFixed(1)}s, ` +
    `worst L${worstId} at ${worstMs.toFixed(0)}ms`,
  );
}

// -------------------------------------------------------- support codes --
// The email-support flow has two halves that must never drift apart: the
// generator (scripts/make-support-code.mjs, run by us) and the client verifier
// (src/services/Support.ts). Round-trip real codes through both.
{
  const { execSync } = await import('node:child_process');
  const { normalizeCode, verifySupportCode } = await import('../services/Support');

  const id = 'ABCD2345';
  const make = (args: string): string =>
    execSync(`node scripts/make-support-code.mjs ${id} ${args}`, { encoding: 'utf8' })
      .split('\n')[0]!
      .trim();

  const levelCode = make('level 87');
  const level = await verifySupportCode(levelCode, id, []);
  check(
    'support: level code round-trips',
    level.ok && level.code.action === 'level' && level.code.param === 87,
    JSON.stringify(level),
  );

  const reset = await verifySupportCode(make('reset'), id, []);
  check('support: reset code round-trips', reset.ok && reset.code.action === 'reset');

  const otherDevice = await verifySupportCode(levelCode, 'WXYZ7893', []);
  check('support: code bound to one device', !otherDevice.ok && otherDevice.reason === 'invalid');

  const replayed = await verifySupportCode(levelCode, id, [normalizeCode(levelCode)]);
  check('support: code is single-use', !replayed.ok && replayed.reason === 'used');

  // Flip the first data character (top bits of the version byte).
  const raw = normalizeCode(levelCode);
  const tampered = (raw[0] === 'A' ? 'B' : 'A') + raw.slice(1);
  const bad = await verifySupportCode(tampered, id, []);
  check('support: tampered code rejected', !bad.ok);

  check('support: confusables normalized', normalizeCode('oil-u') === '011V');
  check('support: garbage rejected', !(await verifySupportCode('hello!!', id, [])).ok);
}

console.log(`\n  ${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n  FAILURES:');
  for (const f of failures) console.log(`   x ${f}`);
  process.exit(1);
}
console.log('  core OK\n');
