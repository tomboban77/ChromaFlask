/**
 * Core self-test. Run with `npm run test:core`.
 * Validates the rules engine, solver optimality and generator determinism
 * without needing a browser or any rendering.
 */
import {
  DEFAULT_RULES, TUBE_CAPACITY, applyPour, canPour, canonicalKey, cloneBoard,
  blockedBy, isDeadlocked, isSolved, labelAt, legalMoves, lockActive, nextRecipeColor, oneWayIndex,
  pourAmount, recipeProgress, rulesFor, sealsRemaining, topRun, undoPour, usefulMoves,
} from './board';
import { ACHIEVEMENTS, unlockedAchievements } from './achievements';
import { getCampaignLevel, isStoredOptimal, isStoredValid, storedLevelCount } from './campaign';
import {
  CHAPTERS, CHAPTER_SIZE, chapterFor, chestTierFor, isChapterEnd, silverChestStars,
} from './chapters';
import {
  DAILY_BASE, MAX_STREAK_FREEZES, WEEKLY_BASE, advanceStreak, applyStreakFreezes, currentStreak,
  dailyId, dailySpec, dateFromDay, dayFromDailyId, dayNumberFromDate, isDaily,
} from './daily';
import {
  WEEKLY_BOARDS, boardFromWeeklyId, isWeekly, weekFromWeeklyId, weekOfDay, weekStartDay, weeklyId,
  weeklySpec,
} from './weekly';
import { generateLevel } from './generator';
import { ENDLESS_START, LEVELS, endlessSpec, getLevelSpec, isEndless } from './levels';
import {
  COIN_SHOP, DEFAULT_ECONOMY, LOGIN_CYCLE, LOGIN_REWARDS, coinsFor, freeUsesFor, loginCycleDay,
  loginRewardFor, rewardScale, scaledReward, starThresholds, starsFor, streakBonusFor,
  timeBonusFor, timeBonusSeconds,
} from './progression';
import { MISSIONS_PER_DAY, mergeMissions, missionsFor } from './missions';
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

/**
 * Brute force with no canonicalisation at all (raw board as the key), so a
 * bug in canonicalKey cannot hide in both the solver and its audit. Only for
 * tiny boards.
 */
function rawBfsOptimal(board: Board, rules: BoardRules, cap = 600_000): number | null {
  if (isSolved(board, rules)) return 0;
  const seen = new Set<string>([JSON.stringify(board)]);
  let frontier: Board[] = [cloneBoard(board)];
  let depth = 0;
  while (frontier.length) {
    depth++;
    const next: Board[] = [];
    for (const b of frontier) {
      for (const mv of legalMoves(b, rules)) {
        const nb = cloneBoard(b);
        applyPour(nb, mv.from, mv.to, rules);
        if (isSolved(nb, rules)) return depth;
        const k = JSON.stringify(nb);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > cap) return null;
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
  // Par 22 is full scale (the standard floor from level 151), so the headline
  // numbers hold there exactly.
  const firstPerfect = e.baseReward + e.starCoins[2] + e.firstClearBonus;
  check('coins: full-scale first clear pays base + star tier + bonus', coinsFor(3, null, 22, e) === firstPerfect);
  check('coins: full-scale first 1-star clear', coinsFor(1, null, 22, e) === e.baseReward + e.starCoins[0] + e.firstClearBonus);
  // The star gaps exist to reward skill: a perfect must pay well over a sloppy clear.
  check('coins: star tiers have real gaps', e.starCoins[0] < e.starCoins[1] && e.starCoins[1] < e.starCoins[2]);
  // Difficulty scaling: an opener pays pocket change, the cap is the cap.
  check('coins: reward scale floors at 0.3', rewardScale(2) === 0.3);
  check('coins: reward scale caps at 1', rewardScale(27) === 1);
  check('coins: an opener pays well under half of full scale', coinsFor(3, null, 2, e) * 2 < firstPerfect);
  check('coins: scaling is monotonic in par', coinsFor(3, null, 7, e) < coinsFor(3, null, 17, e)
    && coinsFor(3, null, 17, e) <= coinsFor(3, null, 22, e));
  check('coins: past the cap nothing changes', coinsFor(3, null, 27, e) === coinsFor(3, null, 22, e));
  // The replay farm: repeating a level must never pay for stars already owned.
  check('coins: replay at same stars pays nothing', coinsFor(3, 3, 22, e) === 0);
  check('coins: replay at fewer stars pays nothing', coinsFor(1, 3, 2, e) === 0);
  check('coins: replay improving 1 -> 3 pays the difference', coinsFor(3, 1, 22, e) === e.starCoins[2] - e.starCoins[0]);
  check('coins: replay improving 2 -> 3 pays the difference', coinsFor(3, 2, 22, e) === e.starCoins[2] - e.starCoins[1]);
  check('coins: scaled replay improvement stays small on an opener',
    coinsFor(3, 1, 2, e) < e.starCoins[2] - e.starCoins[0]);
  // The time bonus scales with par and can always be beaten by a human pace.
  check('time bonus: window grows with par', timeBonusSeconds(20, 50) > timeBonusSeconds(4, 50));
  check('time bonus: level 1 window still fits a new player', timeBonusSeconds(4, 1) >= 25);
  check('time bonus: relaxed clock to level 3 (4 s a move)', timeBonusSeconds(16, 3) === 74);
  check('time bonus: tight clock from level 4 (3 s a move)',
    timeBonusSeconds(16, 4) === 58 && timeBonusSeconds(25, 300) === 85);
  check('time bonus: daily and endless run on the tight clock',
    timeBonusSeconds(22, dailyId(20_000)) === 76 && timeBonusSeconds(22, ENDLESS_START) === 76);
  // The bonus drains with the clock: full at the start, 5 in the last slice,
  // nothing once the window is spent, and never more for a slower finish.
  for (const [par, lvl] of [[4, 1], [12, 3], [12, 40], [22, 150], [27, 300]] as const) {
    const w = timeBonusSeconds(par, lvl);
    const max = scaledReward(e.timeBonusCoins, par);
    check(`time bonus p${par}: full at the start`, timeBonusFor(0, par, lvl, e) === max);
    check(`time bonus p${par}: 5 in the last second`, timeBonusFor(w - 1, par, lvl, e) === 5);
    check(`time bonus p${par}: nothing once spent`,
      timeBonusFor(w, par, lvl, e) === 0 && timeBonusFor(w + 60, par, lvl, e) === 0);
    let prev = Infinity;
    let monotonic = true;
    let steps = true;
    for (let t = 0; t <= w + 2; t++) {
      const b = timeBonusFor(t, par, lvl, e);
      if (b > prev) monotonic = false;
      if (b % 5 !== 0 || b > max || b < 0) steps = false;
      prev = b;
    }
    check(`time bonus p${par}: faster never pays less`, monotonic);
    check(`time bonus p${par}: friendly 5-coin steps within the max`, steps);
  }
  check('time bonus: an average finish earns part of it',
    timeBonusFor(Math.floor(timeBonusSeconds(22, 150) * 0.6), 22, 150, e) < scaledReward(e.timeBonusCoins, 22));

  // Free boosters: one undo everywhere, the free hint only in the first chapter.
  check('free uses: one undo per attempt', freeUsesFor(1, e).undo === 1 && freeUsesFor(150, e).undo === 1);
  check('free uses: hint through the first chapter', freeUsesFor(1, e).hint === 1 && freeUsesFor(e.freeHintLevels, e).hint === 1);
  check('free uses: no free hint after it', freeUsesFor(e.freeHintLevels + 1, e).hint === 0);
  check('free uses: endless and daily get no free hint',
    freeUsesFor(ENDLESS_START, e).hint === 0 && freeUsesFor(DAILY_BASE + 20_000, e).hint === 0);
  check('free uses: bottles are never free', freeUsesFor(1, e).bottle === 0);
  check('free uses: never above the per-attempt caps',
    (['undo', 'hint', 'bottle'] as const).every((k) => e.freeUses[k] <= e.maxUses[k]));

  // Coin shop: unique ids, sane prices, and bigger packs are better value.
  const shopIds = COIN_SHOP.map((i) => i.id);
  check('shop: unique item ids', new Set(shopIds).size === shopIds.length);
  check('shop: every price is a positive whole number', COIN_SHOP.every((i) => Number.isInteger(i.price) && i.price > 0));
  const perUse = (id: string): number => {
    const item = COIN_SHOP.find((i) => i.id === id);
    return item && item.grant.kind === 'powerup' ? item.price / item.grant.count : NaN;
  };
  for (const p of ['undo', 'hint', 'bottle']) {
    check(`shop: ${p} x10 beats x3 per use`, perUse(`${p}.x10`) < perUse(`${p}.x3`));
  }
  const bundle = COIN_SHOP.find((i) => i.id === 'bundle.boost');
  const bundleWorth = bundle && bundle.grant.kind === 'bundle'
    ? Object.entries(bundle.grant.powerups).reduce((sum, [p, n]) => sum + perUse(`${p}.x3`) * (n ?? 0), 0)
    : NaN;
  check('shop: booster bundle is cheaper than its parts', !!bundle && bundle.price < bundleWorth);
  const refill = COIN_SHOP.find((i) => i.grant.kind === 'refillLives');
  const oneHeart = COIN_SHOP.find((i) => i.grant.kind === 'addLives');
  check('shop: a full refill beats five single hearts', !!refill && !!oneHeart && refill.price < oneHeart.price * 5);

  // Streak bonus: pays only from the threshold, never turns 0 into coins.
  check('streak: below threshold pays nothing', streakBonusFor(100, e.streakAfter - 1, e) === 0);
  check('streak: at threshold pays the multiplier', streakBonusFor(100, e.streakAfter, e) === 50);
  check('streak: a zero reward stays zero', streakBonusFor(0, 99, e) === 0);

  // Missions: deterministic per day, distinct kinds, every def from the pool.
  const dayA = missionsFor(20_355);
  const dayB = missionsFor(20_355);
  const dayC = missionsFor(20_356);
  check('missions: three per day', dayA.length === MISSIONS_PER_DAY);
  check('missions: deterministic per day',
    JSON.stringify(dayA) === JSON.stringify(dayB));
  check('missions: kinds are distinct', new Set(dayA.map((m) => m.kind)).size === dayA.length);
  check('missions: days rotate', Array.from({ length: 14 }, (_, i) =>
    JSON.stringify(missionsFor(20_355 + i))).some((s) => s !== JSON.stringify(dayC)));
  check('missions: sane defs', dayA.every((m) => m.target >= 1 && m.coins > 0));

  // Cloud-restore merge: a restore must never re-open a paid mission.
  const paidHere = { day: 9, progress: [3, 0, 1], paid: [true, false, true], allPaid: false };
  const paidThere = { day: 9, progress: [1, 2, 0], paid: [false, true, false], allPaid: false };
  const merged = mergeMissions(paidHere, paidThere);
  check('missions merge: same day unions payouts',
    JSON.stringify(merged?.paid) === JSON.stringify([true, true, true]));
  check('missions merge: same day keeps max progress',
    JSON.stringify(merged?.progress) === JSON.stringify([3, 2, 1]));
  check('missions merge: later day wins',
    mergeMissions(paidHere, { ...paidThere, day: 10 })?.day === 10
    && mergeMissions({ ...paidHere, day: 10 }, paidThere)?.day === 10);
  check('missions merge: null side yields the other',
    mergeMissions(null, paidThere) === paidThere && mergeMissions(paidHere, null) === paidHere);

  check('stars: par is 3 stars', starsFor(10, 10) === 3);
  check('stars: within tolerance is 3 stars', starsFor(12, 10) === 3);
  check('stars: well past par is 1 star', starsFor(40, 10) === 1);
  // Tightened thresholds: three stars within ~10% of the ideal, two within ~30%.
  check('stars: par 25 needs 28 for three, 33 for two',
    starThresholds(25).three === 28 && starThresholds(25).two === 33);
  check('stars: thresholds always leave room and stay ordered',
    Array.from({ length: 40 }, (_, i) => i + 2).every((par) => {
      const t = starThresholds(par);
      return t.three >= par + 2 && t.two > t.three;
    }));

  // Login reward: seven-day cycle that repeats, day 7 refills hearts.
  check('login: day 1 pays the first tile', loginRewardFor(1).coins === LOGIN_REWARDS[0] && !loginRewardFor(1).refillLives);
  check('login: day 7 refills hearts', loginRewardFor(7).refillLives && loginRewardFor(7).coins === LOGIN_REWARDS[LOGIN_CYCLE - 1]);
  check('login: day 8 wraps to day 1', loginCycleDay(8) === 1 && loginRewardFor(8).coins === LOGIN_REWARDS[0]);
  check('login: streak 0 is treated as day 1', loginCycleDay(0) === 1);

  // Achievements: unique ids, none for a fresh player, all for a maxed one.
  check('achievements: ids unique', new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length);
  const fresh = {
    wins: 0, perfects: 0, pours: 0, bestWinStreak: 0, bestDailyStreak: 0, campaignCleared: 0,
    campaignStars: 0, chaptersDone: 0, endlessCleared: 0, campaignSize: 300,
  };
  check('achievements: fresh player has none', unlockedAchievements(fresh).length === 0);
  const maxed = {
    wins: 9999, perfects: 999, pours: 99999, bestWinStreak: 99, bestDailyStreak: 99, campaignCleared: 300,
    campaignStars: 900, chaptersDone: 15, endlessCleared: 99, campaignSize: 300,
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

// --------------------------------------------------------------- recipe
{
  const R = rulesFor({ colors: 3, empties: 1, recipe: [2, 0] });
  check('recipe: first colour is next', nextRecipeColor([[0, 1], [1, 2], [2, 0], []], R) === 2);
  // Sealing colour 0 first is out of order; sealing 2 first is fine.
  const wrong: Board = [[0, 0, 0], [2, 2, 2], [1, 1, 1, 1], [2, 0]];
  check('recipe: out-of-order seal refused', !canPour(wrong, 3, 0, R));
  check('recipe: blockedBy names the recipe', blockedBy(wrong, 3, 0, R) === 'recipe');
  const b: Board = [[0, 0, 0], [2, 2, 2], [1, 1, 1, 1], [0, 2]];
  check('recipe: in-order seal allowed', canPour(b, 3, 1, R));
  check('recipe: moving a sealed bottle is no new seal',
    canPour([[2, 2, 2, 2], [0, 1], [1, 0], []], 0, 3, rulesFor({ colors: 3, empties: 1, recipe: [2, 0] })) &&
    blockedBy([[2, 2, 2, 2], [0, 1], [1, 0], []], 0, 3, rulesFor({ colors: 3, empties: 1, recipe: [2, 0] })) === null);
  check('recipe: non-sealing pour unaffected', canPour([[0, 0], [2, 2, 2], [1, 1, 1, 1], [0]], 3, 0, R));
  const after = cloneBoard(b);
  applyPour(after, 3, 1, R);
  check('recipe: progress advances', recipeProgress(after, R) === 1 && nextRecipeColor(after, R) === 0);
  check('recipe: second colour now allowed', canPour(after, 3, 0, R));
  applyPour(after, 3, 0, R);
  check('recipe: done once every colour sealed', nextRecipeColor(after, R) === null && recipeProgress(after, R) === 2);
  check('recipe: undo re-opens it', (() => {
    const u = cloneBoard(after);
    undoPour(u, { from: 3, to: 0, count: 1, color: 0 });
    return nextRecipeColor(u, R) === 0;
  })());
  // Recipe colours sealed in order on every winning line the solver finds.
  let audited = 0;
  for (let seed = 0; seed < 8; seed++) {
    const spec = { id: 800 + seed, colors: 3, empties: 1, minPar: 1, name: 'audit', recipe: [2, 1] };
    const rules = rulesFor(spec);
    const gen = generateLevel(spec);
    const work = cloneBoard(gen.board);
    const order: number[] = [];
    for (const m of gen.solution) {
      applyPour(work, m.from, m.to, rules);
      const done = recipeProgress(work, rules);
      if (done > order.length) order.push(done);
    }
    check(`recipe audit ${seed}: solution wins`, isSolved(work, rules));
    check(`recipe audit ${seed}: sealed in order`, order.join() === '1,2', order.join());
    const bfs = rawBfsOptimal(gen.board, rules);
    if (bfs === null) continue;
    audited++;
    check(`recipe audit ${seed}: A* par is optimal`, gen.par === bfs, `A*=${gen.par} bfs=${bfs}`);
  }
  check('recipe optimality audit ran', audited >= 5, `audited=${audited}`);
}

// ------------------------------------------------------- labelled flasks
{
  // Two colours, two empties; the last empty (index 3) is labelled colour 1.
  const R = rulesFor({ colors: 2, empties: 2, labels: [1] });
  check('labels: flask is the last empty', labelAt(R, 3) === 1 && labelAt(R, 2) === -1);
  const b: Board = [[0, 1], [1, 0], [], []];
  check('labels: own colour accepted', canPour(b, 0, 3, R));
  check('labels: other colour refused', !canPour(b, 1, 3, R));
  check('labels: blockedBy names the label', blockedBy(b, 1, 3, R) === 'label');
  check('labels: plain empty unaffected', canPour(b, 1, 2, R));
  check('labels: flask is not the interchangeable empty',
    usefulMoves(b, R).some((m) => m.to === 3) && usefulMoves(b, R).some((m) => m.to === 2));
  check('labels: flask is position-sensitive in the key',
    canonicalKey([[0, 1], [1, 0], [], [1]], R) !== canonicalKey([[0, 1], [1, 0], [1], []], R));
  check('labels: solved with the flask full', isSolved([[0, 0, 0, 0], [], [], [1, 1, 1, 1]], R));
  check('labels: solved with the flask empty', isSolved([[0, 0, 0, 0], [1, 1, 1, 1], [], []], R));
  const C = rulesFor({ colors: 2, empties: 2, labels: [1], cauldron: true });
  check('labels: placed after the cauldron offset', labelAt(C, 4) === 1);
  const W = rulesFor({ colors: 2, empties: 2, labels: [0], oneWay: true });
  check('labels: one-way flask still last', oneWayIndex(W) === 4 && labelAt(W, 3) === 0);

  let audited = 0;
  for (let seed = 0; seed < 8; seed++) {
    const spec = { id: 900 + seed, colors: 3, empties: 2, minPar: 1, name: 'audit', labels: [seed % 3] };
    const rules = rulesFor(spec);
    const gen = generateLevel(spec);
    check(`labels audit ${seed}: solution wins`, isSolved(replay(gen.board, gen.solution, rules), rules));
    const bfs = rawBfsOptimal(gen.board, rules);
    if (bfs === null) continue;
    audited++;
    check(`labels audit ${seed}: A* par is optimal`, gen.par === bfs, `A*=${gen.par} bfs=${bfs}`);
  }
  check('labels optimality audit ran', audited >= 5, `audited=${audited}`);

  // Both at once, on the combo shape the campaign uses.
  let combo = 0;
  for (let seed = 0; seed < 6; seed++) {
    const spec = {
      id: 950 + seed, colors: 3, empties: 2, minPar: 1, name: 'audit', labels: [0], recipe: [1, 2],
    };
    const rules = rulesFor(spec);
    const gen = generateLevel(spec);
    const bfs = rawBfsOptimal(gen.board, rules);
    if (bfs === null) continue;
    combo++;
    check(`recipe+labels audit ${seed}: A* par is optimal`, gen.par === bfs, `A*=${gen.par} bfs=${bfs}`);
  }
  check('recipe+labels optimality audit ran', combo >= 4, `audited=${combo}`);
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


// ------------------------------------------------------- chapter chests --
{
  const size = CHAPTER_SIZE;
  check('chests: silver at three quarters of the stars', silverChestStars(size) === 45);
  check('chests: nothing before the last level is cleared', chestTierFor(false, 60, size) === 0);
  check('chests: bronze for finishing', chestTierFor(true, 20, size) === 1 && chestTierFor(true, 44, size) === 1);
  check('chests: silver from 45 stars', chestTierFor(true, 45, size) === 2 && chestTierFor(true, 59, size) === 2);
  check('chests: gold only for every star', chestTierFor(true, 60, size) === 3);
  const e = DEFAULT_ECONOMY;
  check('chests: each tier pays more than the last',
    e.chapterBonus > 0 && e.chestSilverCoins > e.chapterBonus && e.chestGoldCoins > e.chestSilverCoins);
}

// -------------------------------------------------------- streak freeze --
{
  const alive = { streak: 5, lastDay: 100 };
  check('freeze: nothing missed, nothing spent',
    applyStreakFreezes(alive, 101, 2).used === 0 && applyStreakFreezes(alive, 100, 2).used === 0);
  const one = applyStreakFreezes(alive, 102, 1);
  check('freeze: one missed day costs one freeze', one.used === 1 && one.streak.lastDay === 101 && one.streak.streak === 5);
  check('freeze: the saved streak is alive today', currentStreak(one.streak, 102) === 5);
  check('freeze: the next clear extends it by one', advanceStreak(one.streak, 102).streak === 6);
  const two = applyStreakFreezes(alive, 103, 2);
  check('freeze: two missed days cost two', two.used === 2 && two.streak.lastDay === 102);
  check('freeze: too few freezes spend none', applyStreakFreezes(alive, 104, 2).used === 0);
  check('freeze: idempotent once applied', applyStreakFreezes(one.streak, 102, 1).used === 0);
  check('freeze: no streak, nothing to save',
    applyStreakFreezes({ streak: 0, lastDay: 100 }, 102, 2).used === 0 &&
    applyStreakFreezes({ streak: 3, lastDay: -1 }, 102, 2).used === 0);
  check('freeze: a clock set backwards spends nothing', applyStreakFreezes(alive, 90, 2).used === 0);
  check('freeze: cap is small', MAX_STREAK_FREEZES === 2);
}

// --------------------------------------------------------- weekly event --
{
  const monday = dayNumberFromDate(new Date(2026, 8, 28));
  const sunday = dayNumberFromDate(new Date(2026, 8, 27));
  check('weekly: a week starts on Monday', weekStartDay(weekOfDay(monday)) === monday);
  check('weekly: Sunday closes the previous week', weekOfDay(sunday) === weekOfDay(monday) - 1);
  check('weekly: seven days per week', Array.from({ length: 7 }, (_, i) => weekOfDay(monday + i))
    .every((w) => w === weekOfDay(monday)) && weekOfDay(monday + 7) === weekOfDay(monday) + 1);
  const week = weekOfDay(monday);
  const ids = Array.from({ length: WEEKLY_BOARDS }, (_, i) => weeklyId(week, i));
  check('weekly: ids round-trip', ids.every((id, i) => weekFromWeeklyId(id) === week && boardFromWeeklyId(id) === i));
  check('weekly: ids are their own range', ids.every((id) =>
    isWeekly(id) && !isDaily(id) && !isEndless(id) && id >= WEEKLY_BASE));
  check('weekly: dailies are not weekly', !isWeekly(dailyId(monday)) && isDaily(dailyId(monday)));
  check('weekly: ranges stay disjoint for millennia', dailyId(dayNumberFromDate(new Date(3000, 0, 1))) < WEEKLY_BASE);
  check('weekly: consecutive weeks never share ids', weeklyId(week, WEEKLY_BOARDS - 1) < weeklyId(week + 1, 0));
  check('weekly: getLevelSpec resolves weekly ids', getLevelSpec(ids[2] as number).id === ids[2]);
  // Generated live in the solver worker, like endless: two weeks (both murk
  // phases) must deal reliably and fast.
  let worst = 0;
  for (const id of [...ids, ...Array.from({ length: WEEKLY_BOARDS }, (_, i) => weeklyId(week + 1, i))]) {
    const spec = weeklySpec(id);
    const t0 = performance.now();
    const gen = generateLevel(spec);
    const ms = performance.now() - t0;
    worst = Math.max(worst, ms);
    const rules = rulesFor(spec);
    check(`W${id} solution wins`, isSolved(replay(gen.board, gen.solution, rules), rules));
    check(`W${id} meets minPar`, gen.par >= spec.minPar, `par=${gen.par} min=${spec.minPar}`);
    check(`W${id} generates under 3s`, ms < 3000, `${ms.toFixed(0)}ms`);
    check(`W${id} deterministic`, JSON.stringify(generateLevel(spec).board) === JSON.stringify(gen.board));
  }
  console.log(`  weekly sample of ${WEEKLY_BOARDS * 2} generated, worst ${worst.toFixed(0)}ms`);
}

// ----------------------------------------------------------- save layer --
// The payout ledgers (chests, weekly prizes) and freezes, through the real
// SaveService on an in-memory driver: migration, cloud merge and the
// never-pay-twice guards.
{
  const g = globalThis as unknown as { window?: unknown };
  g.window ??= globalThis;
  const { SaveService } = await import('../services/SaveService');
  const memory = (initial: string | null) => {
    let value = initial;
    return { name: 'test', read: () => value, write: (_k: string, v: string) => { value = v; } };
  };
  const rec = { stars: 2, bestMoves: 30, clearedAt: 1 };
  const levels = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), rec]));

  // A v17 save with chapter 1 finished: its old chapter bonus was the bronze chest.
  const v17 = new SaveService(200, memory(JSON.stringify({ version: 17, coins: 500, levels: levels(20) })));
  check('save: v17 finished chapter starts at bronze', v17.chestTier(1) === 1 && v17.chestTier(2) === 0);
  check('save: v17 gets no freezes and an empty week', v17.streakFreezes === 0 && v17.snapshot.weekly.week === -1);
  const v17b = new SaveService(200, memory(JSON.stringify({ version: 17, levels: levels(19) })));
  check('save: v17 unfinished chapter has no chest', v17b.chestTier(1) === 0);
  v17.setChestTier(1, 3);
  v17.setChestTier(1, 2);
  check('save: chest tiers never go down', v17.chestTier(1) === 3);

  // Weekly: a newer week resets, an older one never touches the save.
  const wk = new SaveService(200, memory(null));
  wk.weeklyState(50);
  wk.recordWeeklyClear(50, 0, 3, 20);
  check('save: weekly board recorded', wk.weeklyRecord(50, 0)?.stars === 3);
  const past = wk.weeklyState(49);
  check('save: a past week reads closed', past.prizePaid && past.perfectPaid && Object.keys(past.records).length === 0);
  check('save: reading a past week keeps this one', wk.snapshot.weekly.week === 50 && !!wk.weeklyRecord(50, 0));
  check('save: a past week records nothing', !wk.recordWeeklyClear(49, 1, 3, 20).isFirstClear && !wk.weeklyRecord(50, 1));
  check('save: a past week claims nothing', !wk.claimWeeklyPrize(49, 'prize'));
  check('save: a prize pays once', wk.claimWeeklyPrize(50, 'prize') && !wk.claimWeeklyPrize(50, 'prize'));
  check('save: replays keep the best record', (() => {
    wk.recordWeeklyClear(50, 0, 1, 40);
    const r = wk.weeklyRecord(50, 0);
    return r?.stars === 3 && r.bestMoves === 20;
  })());
  wk.weeklyState(51);
  check('save: a new week starts fresh', wk.snapshot.weekly.week === 51 && !wk.snapshot.weekly.prizePaid &&
    Object.keys(wk.snapshot.weekly.records).length === 0);

  // Cloud restore: payout ledgers are unioned, never re-opened.
  const local = new SaveService(200, memory(null));
  local.setChestTier(1, 3);
  local.weeklyState(60);
  local.recordWeeklyClear(60, 0, 3, 20);
  local.claimWeeklyPrize(60, 'perfect');
  local.replaceFromCloud({
    version: 18, levels: levels(20), chests: { 1: 1, 2: 2 },
    weekly: { week: 60, records: { 1: rec }, prizePaid: true, perfectPaid: false },
  });
  check('save: restore keeps the higher chest', local.chestTier(1) === 3 && local.chestTier(2) === 2);
  check('save: restore unions weekly records',
    !!local.weeklyRecord(60, 0) && !!local.weeklyRecord(60, 1));
  check('save: restore unions weekly prizes', local.snapshot.weekly.prizePaid && local.snapshot.weekly.perfectPaid);
  local.replaceFromCloud({ version: 17, levels: levels(20) });
  check('save: restoring an old save keeps paid chests', local.chestTier(1) === 3 && local.chestTier(2) === 2);

  // Freezes: capped, and spent on missed days.
  const fz = new SaveService(200, memory(JSON.stringify({
    version: 17, daily: { records: {}, streak: 4, lastDay: 200, bestStreak: 4 },
  })));
  check('save: freezes cap at the max', fz.addStreakFreezes(5) === MAX_STREAK_FREEZES && fz.addStreakFreezes(1) === 0);
  check('save: a freeze saves a missed day', fz.settleStreakFreezes(202) === 1 && fz.streakFreezes === 1 &&
    fz.dailyStreak(202) === 4);
  check('save: settling again spends nothing', fz.settleStreakFreezes(202) === 0 && fz.streakFreezes === 1);
  check('save: too many missed days spend nothing', fz.settleStreakFreezes(210) === 0 && fz.streakFreezes === 1 &&
    fz.dailyStreak(210) === 0);
  // A daily from inside the gap, still in progress: no freeze is spent on it,
  // and finishing it extends the streak as it always did.
  const pendingDay = 301;
  const pend = new SaveService(200, memory(JSON.stringify({
    version: 18, daily: { records: {}, streak: 10, lastDay: 300, bestStreak: 10, freezes: 1 },
    inProgress: { levelId: dailyId(pendingDay), board: [], history: [], hidden: [], extraTubes: 0,
      uses: { undo: 0, hint: 0, bottle: 0 }, elapsedMs: 0 },
  })));
  check('save: no freeze spent over a daily still in progress',
    pend.settleStreakFreezes(302) === 0 && pend.streakFreezes === 1);
  pend.setInProgress(null);
  check('save: finishing it extends the streak', pend.recordDailyClear(pendingDay, 3, 20).streak === 11 &&
    pend.dailyStreak(302) === 11 && pend.streakFreezes === 1);
  // The same gap, but yesterday's board is abandoned for today's: the win
  // settles freezes against today, so the freeze saves the streak.
  const aband = new SaveService(200, memory(JSON.stringify({
    version: 18, daily: { records: {}, streak: 10, lastDay: 300, bestStreak: 10, freezes: 1 },
    inProgress: { levelId: dailyId(301), board: [], history: [], hidden: [], extraTubes: 0,
      uses: { undo: 0, hint: 0, bottle: 0 }, elapsedMs: 0 },
  })));
  check('save: pending daily blocks the home settle', aband.settleStreakFreezes(302) === 0);
  aband.setInProgress(null);
  check('save: the win settles against its own day', aband.settleStreakFreezes(302) === 1 &&
    aband.recordDailyClear(302, 3, 20).streak === 11 && aband.streakFreezes === 0);
  // Finishing yesterday's board settles against yesterday: nothing is spent.
  const resumed = new SaveService(200, memory(JSON.stringify({
    version: 18, daily: { records: {}, streak: 10, lastDay: 300, bestStreak: 10, freezes: 1 },
  })));
  check('save: finishing the missed day itself spends no freeze', resumed.settleStreakFreezes(301) === 0 &&
    resumed.recordDailyClear(301, 3, 20).streak === 11 && resumed.streakFreezes === 1);
  // A clear for a day older than the streak's last day records, never restarts it.
  const older = new SaveService(200, memory(JSON.stringify({
    version: 18, daily: { records: {}, streak: 10, lastDay: 305, bestStreak: 10, freezes: 0 },
  })));
  const oldClear = older.recordDailyClear(303, 2, 25);
  check('save: an older day never restarts the streak',
    oldClear.isFirstClear && oldClear.streak === 10 && older.snapshot.daily.lastDay === 305 && !!older.dailyRecord(303));
  // A later week already tracked: the current one reads closed.
  check('save: weeklyOpen only for the tracked week', wk.weeklyOpen(51) && !wk.weeklyOpen(50) && wk.weeklyOpen(52));
  const tampered = new SaveService(200, memory(JSON.stringify({ version: 18, daily: { freezes: 99 } })));
  check('save: a tampered freeze count is clamped', tampered.streakFreezes === MAX_STREAK_FREEZES);

  // Support unlocks never start paying chapter bonuses later.
  const sup = new SaveService(200, memory(null));
  sup.unlockThroughLevel(45);
  check('save: support unlock marks finished chapters bronze', sup.chestTier(1) === 1 && sup.chestTier(2) === 1 &&
    sup.chestTier(3) === 0);
}

console.log(`\n  ${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n  FAILURES:');
  for (const f of failures) console.log(`   x ${f}`);
  process.exit(1);
}
console.log('  core OK\n');
