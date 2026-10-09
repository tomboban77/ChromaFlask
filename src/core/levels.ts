import { DAILY_BASE, dailySpec, isDaily } from './daily';
import { pickColors } from './rng';
import { isWeekly, weeklySpec } from './weekly';
import type { LevelSpec } from './types';

/**
 * The 300-level campaign.
 *
 * Every level is a thinking problem, and different levels test different kinds
 * of thinking (rebuilt after player feedback, 2026-10-09: "too easy, even
 * 1-50"; "test critical thinking in different ways"):
 *
 *  - standard:    lookahead - eight colours, two empties, deals selected so
 *                 that greedy, obvious pours walk into dead ends
 *  - squeeze:     resource scarcity - one empty tube
 *  - cauldron:    borrowing - the any-colour pot is the only working space,
 *                 and it has to be paid back empty
 *  - recipe:      sequencing - colours must be sealed in a set order
 *  - labelled:    constraints - a spare flask that takes only one colour
 *  - lock:        prioritising - a padlocked bottle opens after other seals
 *  - one-way:     commitment - a flask you can never pour back out of
 *  - precision:   efficiency - a pour budget a few over the proven minimum
 *  - murky:       planning under uncertainty - colours hidden until surfaced
 *
 * Each twist is taught once on a small, forgiving board and then tested for
 * real. From level 50 the last level of every ten combines two twists.
 *
 * Difficulty is set by forgiveness (see difficulty.ts): the share of casual,
 * no-lookahead playouts that win. Par only says how long a board is; raising
 * it made boards longer, not harder (a casual player won ~35% of boards at
 * level 60 and at level 300 alike). Every shape gets a band that tightens
 * through the campaign, with breathers as the deliberate dip in the sawtooth.
 *
 * Every spec is deterministic (id seeds the generator) and machine-verified by
 * `npm run test:core`. Retune here, re-run `npm run levels:build`, check the
 * curve with `npm run levels:difficulty`, run the tests, ship.
 */

const ADJ = [
  'Amber', 'Misty', 'Twisted', 'Royal', 'Silent', 'Blazing', 'Frozen', 'Gilded',
  'Stormy', 'Velvet', 'Lucky', 'Crystal', 'Ancient', 'Bubbly', 'Cosmic', 'Molten',
  'Radiant', 'Emerald', 'Curious', 'Golden',
] as const;

const NOUN = [
  'Brew', 'Elixir', 'Cascade', 'Vials', 'Tonic', 'Draught', 'Potion', 'Essence',
  'Nectar', 'Serum', 'Infusion', 'Tincture', 'Mixture', 'Charm', 'Remedy',
  'Arcanum', 'Swirl', 'Ripple', 'Alembic', 'Decoction',
] as const;

function nameFor(id: number): string {
  return `${ADJ[(id * 7) % ADJ.length]} ${NOUN[(id * 13) % NOUN.length]}`;
}

type Band = { readonly min: number; readonly max: number };

/** A twist's first appearance: small enough to learn on, not free. */
const TEACH: Band = { min: 0.1, max: 0.45 };

/**
 * The short tutorial: the rules in five quick boards, the full eight-colour
 * game from level 7, and the recipe and labelled flasks taught on six-colour
 * boards before the campaign tests them on eight.
 */
const OPENING: readonly LevelSpec[] = [
  { id: 1, colors: 2, empties: 2, minPar: 2, name: 'First Pour' },
  { id: 2, colors: 4, empties: 2, minPar: 7, name: 'Four Corners' },
  { id: 3, colors: 5, empties: 2, minPar: 10, forgiveness: { min: 0.2, max: 0.7 }, name: 'Spectrum' },
  { id: 4, colors: 6, empties: 2, minPar: 14, forgiveness: TEACH, name: 'Alchemist' },
  { id: 5, colors: 7, empties: 2, minPar: 17, forgiveness: { min: 0.08, max: 0.35 }, name: 'High Tide' },
  { id: 6, colors: 6, empties: 1, minPar: 14, forgiveness: { min: 0.08, max: 0.4 }, name: 'Tight Fit' },
  { id: 7, colors: 8, empties: 2, minPar: 20, forgiveness: { min: 0.05, max: 0.3 }, name: 'Full Spectrum' },
  {
    id: 8, colors: 6, empties: 2, minPar: 14, forgiveness: TEACH,
    recipe: pickColors(8, 6, 2), name: 'First Recipe',
  },
  { id: 9, colors: 8, empties: 2, minPar: 21, forgiveness: { min: 0.04, max: 0.25 }, name: 'Steady Hand' },
  {
    id: 10, colors: 6, empties: 2, minPar: 14, forgiveness: TEACH,
    labels: pickColors(10, 6, 1), name: 'Labelled Flask',
  },
];

/**
 * Late-campaign tier, 0 for levels 1-200, then 1-5 for each twenty levels
 * from 201.
 */
function tierFor(id: number): number {
  return id <= 200 ? 0 : Math.floor((id - 201) / 20) + 1;
}

/** The forgiveness ceiling for a full eight-colour board at this depth. */
function standardBand(id: number): Band {
  if (id <= 20) return { min: 0.04, max: 0.25 };
  if (id <= 40) return { min: 0.03, max: 0.2 };
  if (id <= 70) return { min: 0, max: 0.15 };
  if (id <= 100) return { min: 0, max: 0.12 };
  if (id <= 150) return { min: 0, max: 0.09 };
  if (id <= 200) return { min: 0, max: 0.07 };
  return { min: 0, max: [0.06, 0.05, 0.05, 0.04, 0.04][tierFor(id) - 1] as number };
}

/** Breathers stay a clear step gentler than their neighbours - but never free. */
function breatherBand(id: number): Band {
  if (id <= 100) return { min: 0.15, max: 0.45 };
  if (id <= 200) return { min: 0.1, max: 0.35 };
  return { min: 0.06, max: 0.25 };
}

function cauldronBand(id: number): Band {
  if (id === 12) return { min: 0.15, max: 0.5 };
  if (id <= 40) return { min: 0.08, max: 0.35 };
  if (id <= 100) return { min: 0.03, max: 0.2 };
  if (id <= 200) return { min: 0, max: 0.1 };
  return { min: 0, max: 0.05 };
}

/**
 * Recipe and labelled boards are far less forgiving by nature (a casual
 * player ignores the order and walks into a seal it may not make), so their
 * early floor keeps a sliver of casual wins - which also rejects unsolvable
 * deals without a solve.
 */
function twistBand(id: number): Band {
  if (id <= 20) return { min: 0.03, max: 0.3 };
  if (id <= 60) return { min: 0.03, max: 0.2 };
  return { min: 0, max: Math.min(0.1, standardBand(id).max) };
}

/** Eight-colour par floor: a guard against short boards, not the difficulty dial. */
function fullParFloor(id: number): number {
  if (id <= 60) return 21;
  if (id <= 100) return 22;
  if (id <= 150) return 23;
  if (id <= 200) return 24;
  return Math.min(26, 23 + tierFor(id));
}

/** Campaign curve for levels 11-300: a ten-level block, slot by slot. */
function specFor(id: number): LevelSpec {
  const tier = tierFor(id);
  const slot = id % 10;
  const name = nameFor(id);
  const murky = isMurky(id);
  const minPar = fullParFloor(id);
  const standard = standardBand(id);
  const full = { id, colors: 8, empties: 2, minPar, name, murky };

  // 0: from 50, the combo that closes each block of ten.
  if (slot === 0 && id >= 50) {
    const recipe = pickColors(id, 8, id <= 150 ? 3 : 4);
    return Math.floor(id / 10) % 2 === 0
      ? { ...full, recipe, labels: pickColors(id + 1, 8, 1, recipe), forgiveness: twistBand(id) }
      : { ...full, recipe, lock: { seals: 1 }, forgiveness: twistBand(id) };
  }

  // 1: precision pour, from 21. Efficiency is the test, so the trap band is
  // looser; the budget does the squeezing - par + 3 at its debut, + 2, then
  // + 1 in the last three tiers.
  if (slot === 1 && id >= 21) {
    return {
      ...full,
      precision: { slack: id === 21 ? 3 : tier >= 3 ? 1 : 2 },
      forgiveness: { min: 0, max: Math.min(0.3, standard.max * 1.5) },
    };
  }

  // 2: the cauldron, from 12, as the only working space: five colours to 60,
  // then six. Beside a spare empty it forgave ~75% of casual play; alone it
  // has to be borrowed and paid back with a plan.
  if (slot === 2) {
    const c = id <= 60 ? 5 : 6;
    return {
      id, colors: c, empties: 0, cauldron: true,
      minPar: c === 5 ? 12 : id <= 200 ? 16 : 18,
      forgiveness: cauldronBand(id), name, murky,
    };
  }

  // 3: the recipe, from 13: three colours to 40, four to 150, then five.
  if (slot === 3) {
    const length = id <= 40 ? 3 : id <= 150 ? 4 : 5;
    return { ...full, recipe: pickColors(id, 8, length), forgiveness: twistBand(id) };
  }

  // 4: the breather - seven colours, two empties, a gentler band.
  if (slot === 4) {
    return {
      id, colors: 7, empties: 2, minPar: Math.min(18, 16 + Math.floor(tier / 2)),
      forgiveness: breatherBand(id), name, murky,
    };
  }

  // 5: the locked bottle, from 15 - two seals to open from the third tier.
  if (slot === 5) {
    return {
      ...full, lock: { seals: tier >= 3 ? 2 : 1 },
      forgiveness: id === 15 ? { min: 0.05, max: 0.35 } : standard,
    };
  }

  // 7: the one-way flask, from 27: one ordinary empty plus the flask.
  if (slot === 7 && id >= 27) {
    return {
      id, colors: 8, empties: 1, oneWay: true, minPar: Math.min(25, 20 + tier),
      forgiveness: id === 27 ? { min: 0.05, max: 0.35 } : standard, name, murky,
    };
  }

  // 8 (and 6 from 101): the squeeze - six colours, one empty.
  if (slot === 8 || (slot === 6 && id > 100)) {
    return {
      id, colors: 6, empties: 1,
      minPar: id <= 100 ? 16 : id <= 200 ? 17 : Math.min(19, 16 + tier),
      forgiveness: standard, name, murky,
    };
  }

  // 9: the labelled flask, from 19 - one of the two empties takes a single
  // colour. From 151 a third tube joins and two of the three are labelled.
  if (slot === 9) {
    return id <= 150
      ? { ...full, labels: pickColors(id, 8, 1), forgiveness: twistBand(id) }
      : {
        ...full, empties: 3, labels: pickColors(id, 8, 2),
        forgiveness: twistBand(id),
      };
  }

  return { ...full, forgiveness: standard };
}

/**
 * Murky cadence: introduced at 27, one in three to 60, one in two to 120,
 * two in three to 240, three in four after.
 */
function isMurky(id: number): boolean {
  if (id < 25) return false;
  if (id <= 60) return id % 3 === 0;
  if (id <= 120) return id % 2 === 0;
  if (tierFor(id) >= 3) return id % 4 !== 1;
  return id % 3 !== 1;
}

export const LEVEL_COUNT = 300;

export const LEVELS: readonly LevelSpec[] = [
  ...OPENING,
  ...Array.from({ length: LEVEL_COUNT - OPENING.length }, (_, i) =>
    specFor(OPENING.length + 1 + i),
  ),
];

// ------------------------------------------------------------------ endless
/** Endless levels are numbered straight on from the campaign: 301, 302, ... */
export const ENDLESS_START = LEVEL_COUNT + 1;

export function isEndless(id: number): boolean {
  return id > LEVEL_COUNT && id < DAILY_BASE;
}

/** 1-based position within endless mode ("Endless #7"). */
export function endlessIndex(id: number): number {
  return id - LEVEL_COUNT;
}

/**
 * Endless mode: levels beyond the campaign, generated on demand (in the
 * solver worker, so the phone never stalls).
 *
 * A ten-level cycle of every shape the campaign teaches: a full eight-colour
 * board, a seven-colour murky board, a cauldron-only board, a plain squeeze,
 * a breather, a double-sealed lock, a one-way flask, a recipe, a labelled
 * flask and a precision pour. Every shape carries the campaign's final
 * forgiveness ceiling, so endless is never a step down; par floors sit a
 * point or two under the campaign's where stacking both filters made live
 * generation too slow for a phone. Murk alternates on top. Deterministic per
 * id, like everything else.
 */
export function endlessSpec(id: number): LevelSpec {
  const n = endlessIndex(id);
  const murky = n % 2 === 0;
  const name = nameFor(id);
  const tight = { min: 0, max: 0.06 };
  switch ((n - 1) % 10) {
    case 0:
      // Par 25, not the campaign's 27: forgiveness carries the difficulty
      // now, and stacking both filters took up to four seconds a deal on a
      // desktop - far too long to make a phone wait.
      return { id, colors: 8, empties: 2, minPar: 25, forgiveness: tight, name, murky };
    case 1:
      return {
        id, colors: 7, empties: 2, minPar: 17,
        forgiveness: { min: 0, max: 0.12 }, name, murky: true,
      };
    case 2:
      // The cauldron is the only working space, as in the campaign.
      return {
        id, colors: 6, empties: 0, cauldron: true, minPar: 18,
        forgiveness: { min: 0, max: 0.08 }, name, murky,
      };
    case 3:
      return { id, colors: 6, empties: 1, minPar: 19, forgiveness: { min: 0, max: 0.08 }, name, murky };
    case 4:
      // The breather: seven colours, two empties, a gentler band.
      return {
        id, colors: 7, empties: 2, minPar: 17,
        forgiveness: { min: 0.08, max: 0.3 }, name, murky: true,
      };
    case 5:
      return {
        id, colors: 8, empties: 2, minPar: 27, lock: { seals: 2 }, forgiveness: tight, name, murky,
      };
    case 6:
      return { id, colors: 8, empties: 1, minPar: 23, oneWay: true, forgiveness: tight, name, murky };
    case 7:
      // Recipe and labelled boards: a floor of one casual win in 32 rejects
      // unsolvable deals before any solve, which keeps live generation fast.
      return {
        id, colors: 8, empties: 2, minPar: 24, recipe: pickColors(id, 8, 3),
        forgiveness: { min: 0.03, max: 0.15 }, name, murky,
      };
    case 8:
      return {
        id, colors: 8, empties: 2, minPar: 24, labels: pickColors(id, 8, 1),
        forgiveness: { min: 0.03, max: 0.08 }, name, murky,
      };
    default:
      return {
        id, colors: 8, empties: 2, minPar: 24, precision: { slack: 2 },
        forgiveness: { min: 0, max: 0.12 }, name, murky,
      };
  }
}

export function getLevelSpec(id: number): LevelSpec {
  if (!Number.isInteger(id) || id < 1) throw new Error(`No level ${id}`);
  if (isWeekly(id)) return weeklySpec(id);
  if (isDaily(id)) return dailySpec(id);
  if (isEndless(id)) return endlessSpec(id);
  const spec = LEVELS[id - 1];
  if (!spec) throw new Error(`No level ${id}`);
  return spec;
}
