/**
 * Core self-test. Run with `npm run test:core`.
 * Validates the rules engine, solver optimality and generator determinism
 * without needing a browser or any rendering.
 */
import {
  DEFAULT_RULES, TUBE_CAPACITY, applyPour, canPour, canonicalKey, cloneBoard,
  isDeadlocked, isSolved, legalMoves, lockActive, oneWayIndex, pourAmount, rulesFor, sealsRemaining,
  topRun, undoPour, usefulMoves,
} from './board';
import { ACHIEVEMENTS, unlockedAchievements } from './achievements';
import { getCampaignLevel, isStoredOptimal, isStoredValid, storedLevelCount } from './campaign';
import { CHAPTERS, CHAPTER_SIZE, chapterFor, isChapterEnd } from './chapters';
import {
  DAILY_BASE, advanceStreak, currentStreak, dailyId, dailySpec, dateFromDay, dayFromDailyId,
  dayNumberFromDate, isDaily,
} from './daily';
import { generateLevel } from './generator';
import { ENDLESS_START, LEVELS, endlessSpec, getLevelSpec, isEndless } from './levels';
import {
  DEFAULT_ECONOMY, LOGIN_CYCLE, LOGIN_REWARDS, coinsFor, loginCycleDay, loginRewardFor, starsFor,
} from './progression';
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

  // Login reward: seven-day cycle that repeats, day 7 refills hearts.
  check('login: day 1 pays the first tile', loginRewardFor(1).coins === LOGIN_REWARDS[0] && !loginRewardFor(1).refillLives);
  check('login: day 7 refills hearts', loginRewardFor(7).refillLives && loginRewardFor(7).coins === LOGIN_REWARDS[LOGIN_CYCLE - 1]);
  check('login: day 8 wraps to day 1', loginCycleDay(8) === 1 && loginRewardFor(8).coins === LOGIN_REWARDS[0]);
  check('login: streak 0 is treated as day 1', loginCycleDay(0) === 1);

  // Achievements: unique ids, none for a fresh player, all for a maxed one.
  check('achievements: ids unique', new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length);
  const fresh = {
    wins: 0, perfects: 0, pours: 0, bestWinStreak: 0, bestDailyStreak: 0, campaignCleared: 0,
    campaignStars: 0, chaptersDone: 0, endlessCleared: 0, campaignSize: 500,
  };
  check('achievements: fresh player has none', unlockedAchievements(fresh).length === 0);
  const maxed = {
    wins: 9999, perfects: 999, pours: 99999, bestWinStreak: 99, bestDailyStreak: 99, campaignCleared: 500,
    campaignStars: 1500, chaptersDone: 25, endlessCleared: 99, campaignSize: 500,
  };
  check('achievements: maxed player has all', unlockedAchievements(maxed).length === ACHIEVEMENTS.length);
  check('achievements: first win earns exactly First Pour',
    JSON.stringify(unlockedAchievements({ ...fresh, wins: 1 })) === JSON.stringify(['first_pour']));
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

// ---------------------------------------------------------- locked bottle
{
  // Tube 0 is padlocked until one other bottle is complete.
  const R: BoardRules = { cauldron: false, lock: { index: 0, seals: 1 } };
  const b: Board = [[0, 1], [1, 1, 1], [1], [0, 0, 0], []];
  check('lock: engaged with nothing sealed', lockActive(b, R) && sealsRemaining(b, R) === 1);
  check('lock: cannot pour out of the locked bottle', !canPour(b, 0, 4, R));
  check('lock: cannot pour into the locked bottle', !canPour(b, 2, 0, R));
  check('lock: other pours unaffected', canPour(b, 2, 1, R));
  check('lock: solver never proposes touching it', usefulMoves(b, R).every((m) => m.from !== 0 && m.to !== 0));

  // Sealing bottle 1 opens the lock.
  const opened = cloneBoard(b);
  applyPour(opened, 2, 1, R);
  check('lock: opens once a bottle is sealed', !lockActive(opened, R) && sealsRemaining(opened, R) === 0);
  // Out into the empty tube, and in from a matching top (tube 1's colour matches tube 0's top).
  check('lock: pours in and out allowed after opening', canPour(opened, 0, 4, R) && canPour(opened, 1, 0, R));
  check('lock: rules for a spec place it on the first filled tube',
    rulesFor({ lock: { seals: 1 } }).lock?.index === 0 && rulesFor({ cauldron: true, lock: { seals: 2 } }).lock?.index === 1);

  // Keys: locked bottle is position-sensitive while locked, ordinary once open.
  check('lock: key distinguishes the locked bottle from an identical ordinary tube',
    canonicalKey([[0, 1], [2], [0, 1]], R) !== canonicalKey([[2], [0, 1], [0, 1]], R));
  const RO: BoardRules = { cauldron: false, lock: { index: 0, seals: 1 } };
  const openA: Board = [[0, 1], [2, 2, 2, 2], [3]];
  const openB: Board = [[3], [2, 2, 2, 2], [0, 1]];
  check('lock: once open, the bottle is interchangeable again', canonicalKey(openA, RO) === canonicalKey(openB, RO));
  check('lock: seals needed can be two', lockActive([[0], [1, 1, 1, 1], [2, 2]], { cauldron: false, lock: { index: 0, seals: 2 } }));

  // End-to-end: a generated locked level solves, and A* matches brute force.
  let audited = 0;
  for (let seed = 0; seed < 6; seed++) {
    const spec = { id: 500 + seed, colors: 3, empties: 1, minPar: 1, name: 'audit', lock: { seals: 1 } };
    const gen = generateLevel(spec);
    const rules = rulesFor(spec);
    check(`lock audit ${seed}: solution wins`, isSolved(replay(gen.board, gen.solution, rules), rules));
    check(`lock audit ${seed}: solution never touches the bottle while locked`, (() => {
      const w = cloneBoard(gen.board);
      for (const m of gen.solution) {
        if (lockActive(w, rules) && (m.from === 0 || m.to === 0)) return false;
        applyPour(w, m.from, m.to, rules);
      }
      return true;
    })());
    const bfs = bfsOptimal(gen.board, rules);
    if (bfs === null) continue;
    audited++;
    check(`lock audit ${seed}: A* par is optimal`, gen.par === bfs, `A*=${gen.par} bfs=${bfs}`);
  }
  check('lock optimality audit ran', audited >= 4, `audited=${audited}`);
}

// --------------------------------------------------------- one-way flask
{
  // Two colours, one ordinary empty, and the flask as the last tube (index 3).
  const R = rulesFor({ colors: 2, empties: 1, oneWay: true });
  check('oneway: flask is the last tube', oneWayIndex(R) === 3);
  const b: Board = [[0, 1], [1, 0], [], []];
  check('oneway: pouring in is allowed', canPour(b, 0, 3, R));
  const after = cloneBoard(b);
  applyPour(after, 0, 3, R);
  check('oneway: nothing ever pours out', !canPour(after, 3, 2, R) && !canPour(after, 3, 0, R));
  check('oneway: solver never pours out of it', usefulMoves(after, R).every((m) => m.from !== 3));
  check('oneway: matching colour may follow', canPour([[0], [1, 1], [], [1]], 2 - 1, 3, R));
  check('oneway: wrong colour may not follow', !canPour([[0], [1, 1], [], [1]], 0, 3, R));

  // Winning needs the flask full, not merely untouched.
  check('oneway: not solved while the flask is empty', !isSolved([[0, 0, 0, 0], [1, 1, 1, 1], [], []], R));
  check('oneway: not solved while the flask is partial', !isSolved([[0, 0, 0, 0], [1, 1], [], [1, 1]], R));
  check('oneway: solved once the flask is full', isSolved([[0, 0, 0, 0], [], [], [1, 1, 1, 1]], R));

  // A whole uniform tube may move into the empty flask (that is a real choice).
  const uni: Board = [[0, 0], [1, 1, 0, 0], [1, 1], []];
  check('oneway: uniform tube into the empty flask is a useful move',
    usefulMoves(uni, R).some((m) => m.from === 0 && m.to === 3));
  check('oneway: flask is position-sensitive in the key',
    canonicalKey([[0], [], [], [1]], R) !== canonicalKey([[1], [], [], [0]], R));

  // Generated flask levels solve, never pour out of the flask, and match brute force.
  let audited = 0;
  for (let seed = 0; seed < 6; seed++) {
    const spec = { id: 700 + seed, colors: 3, empties: 1, minPar: 1, name: 'audit', oneWay: true };
    const gen = generateLevel(spec);
    const rules = rulesFor(spec);
    check(`oneway audit ${seed}: solution wins`, isSolved(replay(gen.board, gen.solution, rules), rules));
    check(`oneway audit ${seed}: flask ends full`,
      replay(gen.board, gen.solution, rules)[oneWayIndex(rules)]?.length === TUBE_CAPACITY);
    check(`oneway audit ${seed}: nothing leaves the flask`,
      gen.solution.every((m) => m.from !== oneWayIndex(rules)));
    const bfs = bfsOptimal(gen.board, rules);
    if (bfs === null) continue;
    audited++;
    check(`oneway audit ${seed}: A* par is optimal`, gen.par === bfs, `A*=${gen.par} bfs=${bfs}`);
  }
  check('oneway optimality audit ran', audited >= 4, `audited=${audited}`);
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
    const tubes = spec.colors + spec.empties + (spec.cauldron ? 1 : 0) + (spec.oneWay ? 1 : 0);
    const flags =
      `${spec.cauldron ? 'C' : '·'}${spec.murky ? 'M' : '·'}${spec.lock ? 'L' : '·'}${spec.oneWay ? 'W' : '·'}`;
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
    // Players get the precomputed campaign; the generator is the fallback and
    // the endless-mode path (in a worker). The bound is a regression guard
    // against a solver change making generation explode, not a promise about
    // any one machine (it must survive a CI runner and a laptop running other
    // tests). Cauldron deals branch hardest - a few late seeds take ~4 s on a
    // desktop - so they get more headroom.
    const budgetMs = spec.cauldron ? 5000 : 3000;
    check(`L${spec.id} generates under ${budgetMs / 1000}s`, ms < budgetMs, `${ms.toFixed(0)}ms`);

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

    // The precomputed campaign (campaign.json) is what players actually get.
    // It must be the same board, and its line must be at least as short.
    const stored = getCampaignLevel(spec.id);
    check(
      `L${spec.id} campaign board matches generator`,
      JSON.stringify(stored.board) === JSON.stringify(gen.board),
    );
    check(`L${spec.id} campaign par never worse than generator`, stored.par <= gen.par,
      `stored=${stored.par} gen=${gen.par}`);
    check(`L${spec.id} campaign par meets minPar`, stored.par >= spec.minPar);
    check(
      `L${spec.id} campaign solution wins in par moves`,
      stored.solution.length === stored.par &&
        isSolved(replay(stored.board, stored.solution, rules), rules),
    );
    check(`L${spec.id} campaign par proven optimal`, isStoredOptimal(spec.id) === true);
    // The stored line must be the one players actually get - never a silent
    // fallback to on-device generation because the rules moved under it.
    check(`L${spec.id} campaign entry valid under current rules`, isStoredValid(spec.id));
  }

  check('campaign covers every level', storedLevelCount() === LEVELS.length,
    `${storedLevelCount()} of ${LEVELS.length}`);

  console.log(
    `\n  ${LEVELS.length} levels verified - total ${(totalMs / 1000).toFixed(1)}s, ` +
    `worst L${worstId} at ${worstMs.toFixed(0)}ms`,
  );
}

// ------------------------------------------------------------- chapters --
{
  check('chapters: cover the campaign exactly', CHAPTERS.length * CHAPTER_SIZE === LEVELS.length);
  let contiguous = true;
  for (let i = 0; i < CHAPTERS.length; i++) {
    const c = CHAPTERS[i]!;
    if (c.index !== i + 1 || c.first !== i * CHAPTER_SIZE + 1 || c.last !== c.first + CHAPTER_SIZE - 1) {
      contiguous = false;
    }
  }
  check('chapters: contiguous, 1-based, twenty levels each', contiguous);
  check('chapters: names are unique', new Set(CHAPTERS.map((c) => c.name)).size === CHAPTERS.length);
  check('chapters: every level maps to its chapter',
    LEVELS.every((s) => { const c = chapterFor(s.id); return c !== null && s.id >= c.first && s.id <= c.last; }));
  check('chapters: endless ids have no chapter', chapterFor(LEVELS.length + 1) === null);
  check('chapters: last level of each chapter is a chapter end',
    CHAPTERS.every((c) => isChapterEnd(c.last) && !isChapterEnd(c.first)));
}

// ---------------------------------------------------------------- daily --
{
  // Day arithmetic round-trips in the local calendar, including across DST.
  const d = new Date(2026, 2, 29, 23, 30); // 29 March 2026, late evening
  const day = dayNumberFromDate(d);
  const back = dateFromDay(day);
  check('daily: day number round-trips the local date',
    back.getFullYear() === 2026 && back.getMonth() === 2 && back.getDate() === 29);
  check('daily: consecutive dates are consecutive days',
    dayNumberFromDate(new Date(2026, 2, 30, 0, 5)) === day + 1);
  check('daily: id round-trips', dayFromDailyId(dailyId(day)) === day && isDaily(dailyId(day)));
  check('daily: campaign and endless ids are not daily', !isDaily(1) && !isDaily(LEVELS.length + 1));
  check('daily: getLevelSpec resolves daily ids', getLevelSpec(dailyId(day)).name === 'Daily challenge');
  check('daily: not endless', !isEndless(dailyId(day)));

  // Streak rules: same day twice is a no-op; a gap resets; yesterday extends.
  let s = advanceStreak({ streak: 0, lastDay: -1 }, 100);
  check('daily: first clear starts a streak of 1', s.streak === 1 && s.lastDay === 100);
  s = advanceStreak(s, 100);
  check('daily: same day again does not change the streak', s.streak === 1);
  s = advanceStreak(s, 101);
  check('daily: next day extends', s.streak === 2);
  check('daily: streak shows while alive', currentStreak(s, 101) === 2 && currentStreak(s, 102) === 2);
  check('daily: streak lapses after a missed day', currentStreak(s, 103) === 0);
  s = advanceStreak(s, 105);
  check('daily: a gap resets to 1', s.streak === 1 && s.lastDay === 105);

  // A week of dailies deals, solves and stays deterministic.
  const today = dayNumberFromDate(new Date());
  let worst = 0;
  for (let i = 0; i < 7; i++) {
    const spec = dailySpec(dailyId(today + i));
    const t0 = performance.now();
    const gen = generateLevel(spec);
    worst = Math.max(worst, performance.now() - t0);
    const rules = rulesFor(spec);
    check(`daily ${i}: solution wins`, isSolved(replay(gen.board, gen.solution, rules), rules));
    check(`daily ${i}: meets minPar`, gen.par >= spec.minPar);
    check(`daily ${i}: deterministic`,
      JSON.stringify(generateLevel(spec).board) === JSON.stringify(gen.board));
  }
  check('daily: a week generates under 3s each', worst < 3000, `${worst.toFixed(0)}ms`);
  check('daily: base is clear of endless ids', DAILY_BASE > LEVELS.length + 100_000);
}

// -------------------------------------------------------------- endless --
// Endless levels are generated on demand, so the recipe must deal reliably
// and quickly at both ends of its difficulty ramp: the first cycle and a tier
// where every par floor has reached its cap.
{
  check('endless: ids past the campaign', isEndless(ENDLESS_START) && !isEndless(LEVELS.length));
  check('endless: getLevelSpec resolves endless ids', getLevelSpec(ENDLESS_START).id === ENDLESS_START);
  // Seven per end: one full cycle of the seven endless shapes.
  const sample = [
    ...Array.from({ length: 7 }, (_, i) => ENDLESS_START + i),
    ...Array.from({ length: 7 }, (_, i) => ENDLESS_START + 120 + i),
  ];
  let worst = 0;
  for (const id of sample) {
    const spec = endlessSpec(id);
    const t0 = performance.now();
    const gen = generateLevel(spec);
    const ms = performance.now() - t0;
    worst = Math.max(worst, ms);
    const rules = rulesFor(spec);
    check(`E${id} solution wins`, isSolved(replay(gen.board, gen.solution, rules), rules));
    check(`E${id} meets minPar`, gen.par >= spec.minPar, `par=${gen.par} min=${spec.minPar}`);
    check(`E${id} generates under 3s`, ms < 3000, `${ms.toFixed(0)}ms`);
    check(`E${id} deterministic`, JSON.stringify(generateLevel(spec).board) === JSON.stringify(gen.board));
  }
  console.log(`  endless sample of ${sample.length} generated, worst ${worst.toFixed(0)}ms`);
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
