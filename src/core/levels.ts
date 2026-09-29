import { DAILY_BASE, dailySpec, isDaily } from './daily';
import { isWeekly, weeklySpec } from './weekly';
import type { LevelSpec } from './types';

/**
 * The 300-level campaign.
 *
 * Difficulty comes from three dials, moved on a sawtooth rather than a line so
 * the ramp has rhythm instead of a grind:
 *
 *  - colour count: raw combinatorial complexity (2 -> 8 across the campaign)
 *  - empty tubes:  working space; 3 = breather, 2 = standard, 1 = squeeze
 *  - minPar:       the generator rejects boards whose optimal line is shorter,
 *                  so late levels are *provably* deep, not just "probably"
 *  - murky:        from level 25, colours below each tube's mouth start hidden
 *
 * Levels 1-200 ramp from the tutorial to the full eight-colour game (the
 * curve here is deliberately steep after the opening: seven colours by 15,
 * eight by 25). Levels 201-300 are the endgame, five tiers of twenty - the
 * same five tiers that once stretched over 300 levels, compressed so the
 * campaign ends at its peak instead of coasting. Because the campaign is
 * precomputed offline, the par floor can climb through the whole distribution
 * of deals (eight-colour boards reach an ideal of 27 by the last tier,
 * squeezes 19, cauldrons 18, breathers 19), a second squeeze joins each block
 * of ten from level 101, and murk rises to three levels in four.
 *
 * Every spec is deterministic (id seeds the generator) and machine-verified by
 * `npm run test:core`: solvable, meets minPar, conserves units, and generates
 * fast enough for on-device use. Retune here, re-run `npm run levels:build`
 * and the test, ship.
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

/**
 * Hand-tuned opening: teaches the game and ramps to six colours by level 10.
 * Deliberately ALL two-empty boards: single-empty "squeeze" boards let a new
 * player pour into a dead end within a few moves, which reads as "this level
 * is impossible without buying a bottle". Tight boards start at level 18,
 * once the player has the skills (and the no-win warning to guide them).
 */
const OPENING: readonly LevelSpec[] = [
  { id: 1, colors: 2, empties: 2, minPar: 2, name: 'First Pour' },
  { id: 2, colors: 3, empties: 2, minPar: 4, name: 'Triple Trouble' },
  { id: 3, colors: 3, empties: 2, minPar: 6, name: 'Tight Fit' },
  { id: 4, colors: 4, empties: 2, minPar: 7, name: 'Four Corners' },
  { id: 5, colors: 4, empties: 2, minPar: 8, name: 'Steady Hand' },
  { id: 6, colors: 4, empties: 2, minPar: 9, name: 'Slow Brew' },
  { id: 7, colors: 5, empties: 2, minPar: 10, name: 'Spectrum' },
  { id: 8, colors: 5, empties: 2, minPar: 11, name: 'Five Shades' },
  { id: 9, colors: 5, empties: 2, minPar: 12, name: 'High Tide' },
  { id: 10, colors: 6, empties: 2, minPar: 13, name: 'Alchemist' },
] as const;

/**
 * Late-campaign tier, 0 for levels 1-200, then 1-5 for each twenty levels
 * from 201. Each tier nudges the par floors up within proven caps.
 */
function tierFor(id: number): number {
  return id <= 200 ? 0 : Math.floor((id - 201) / 20) + 1;
}

/** Campaign curve for levels 11-300. */
function specFor(id: number): LevelSpec {
  // Base colour band. The palette holds 8 colours; past that point the heat
  // comes from minPar, squeezes, the cauldron and the murky mechanic instead.
  // Steepened again after player feedback (2026-09-29, "too easy"): seven
  // colours from 15 and the full eight from 25.
  const colors = id <= 14 ? 6 : id <= 24 ? 7 : 8;
  const tier = tierFor(id);

  // Cauldron every 10 levels from 22: it replaces one empty tube with a
  // vessel that takes anything but must end empty. Introduced a few levels
  // clear of the murky mechanic's debut (26) so players meet one new idea at
  // a time.
  // Capped at 6 colours: the cauldron's any-colour branching makes bigger
  // exact solves take seconds on-device, and one empty tube plus a
  // must-empty cauldron carries plenty of heat on its own. The floor stays at
  // 15 in the late tiers: cauldron deals are the slowest to prove.
  if (id >= 22 && id % 10 === 2) {
    return {
      id, colors: 6, empties: 1, cauldron: true,
      // 14 -> 15 across the original ramp, then 16, 16, 17, 17, 18.
      minPar: id <= 60 ? 14 : id <= 200 ? 15 : Math.min(18, 15 + Math.ceil(tier / 2)),
      name: nameFor(id), murky: isMurky(id),
    };
  }

  // Par floor. Raw eight-colour deals have an ideal of 22-28 (median 25), so
  // a floor below that rejects nothing and the curve goes flat; this one
  // sits inside the distribution from the first eight-colour board and
  // climbs through it:
  //   25-100: 21, 22   101-150: 23   151-200: 24   tiers: 24 .. 27.
  // The precompute pays for the rejected deals offline; players never wait.
  let minPar: number;
  if (colors === 6) minPar = 15 + Math.min(1, Math.floor((id - 11) / 2));
  else if (colors === 7) minPar = 18 + Math.min(2, Math.floor((id - 15) / 4));
  else if (id <= 100) minPar = id <= 60 ? 21 : 22;
  else if (id <= 150) minPar = 23;
  else if (id <= 200) minPar = 24;
  else minPar = Math.min(27, 23 + tier);

  let empties = 2;

  // Breather every 10 levels: extra tube, fewer colours, gentler par.
  // Capped at 7 colours: an 11-tube 8-colour board makes the optimal solve
  // explode (seconds of generation on-device) without feeling any easier.
  // Breathers deepen too (16 -> 19), staying well under the standard floor.
  if (id % 10 === 4) {
    const c = Math.min(colors, 7);
    return {
      id, colors: c, empties: 3,
      minPar: c === 7 ? Math.min(19, 16 + tier) : 13,
      name: nameFor(id), murky: isMurky(id),
    };
  }

  // The Locked Bottle, every 10 levels from 45: a full board whose first
  // bottle is padlocked until one other bottle is sealed - two from the third
  // late tier. Same par floor as a standard board; the lock itself adds the
  // depth (and a planning problem no earlier level poses). It used to wait
  // until level 205, leaving 150 levels with nothing new to learn.
  if (id >= 45 && id % 10 === 5) {
    return {
      id, colors, empties: 2, minPar,
      lock: { seals: tier >= 3 ? 2 : 1 },
      name: nameFor(id), murky: isMurky(id),
    };
  }

  // The One-Way Flask, every 10 levels from 67 (was 267): a full
  // eight-colour board with a single ordinary empty plus the flask, which
  // takes pours but never gives them back and must be full to win. The
  // player has to choose a colour to commit and deliver it in order.
  if (id >= 67 && id % 10 === 7) {
    return {
      id, colors: 8, empties: 1, oneWay: true,
      minPar: Math.min(25, 20 + tier),
      name: nameFor(id), murky: isMurky(id),
    };
  }

  // Squeeze every 10 levels: one empty tube. Colours are capped because
  // single-empty boards get vanishingly rare to deal beyond six colours.
  // From level 101 a second squeeze joins each block of ten.
  if (id % 10 === 8 || (id > 100 && id % 10 === 6)) {
    empties = 1;
    const squeezed = id <= 20 ? 5 : 6;
    // 12 (five colours), then 16 -> 17 across the ramp, then 17 .. 19.
    minPar = squeezed === 5 ? 12 : id <= 100 ? 16 : id <= 200 ? 17 : Math.min(19, 16 + tier);
    return { id, colors: squeezed, empties, minPar, name: nameFor(id), murky: isMurky(id) };
  }

  return { id, colors, empties, minPar, name: nameFor(id), murky: isMurky(id) };
}

/**
 * Murky cadence: introduced at 27 (clear of the cauldron's debut at 22), one
 * in three to 60, one in two to 120, two in three to 240, three in four after.
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
 * A five-level cycle of the shapes the campaign proved deal reliably: a full
 * eight-colour board, a seven-colour murky board, a cauldron squeeze, a plain
 * squeeze, and a breather. The par floor creeps up by one every twenty levels
 * and stops at the highest floor each shape reached in the campaign, so
 * generation stays fast and can never run out of attempts. Murk alternates on
 * top of that. Deterministic per id, like everything else.
 */
export function endlessSpec(id: number): LevelSpec {
  const n = endlessIndex(id);
  const tier = Math.floor((n - 1) / 20);
  const murky = n % 2 === 0;
  const name = nameFor(id);
  // Floors start where the campaign's final tier left them, so endless is
  // never a step down, and cap where the precompute proved deals stay fast.
  switch ((n - 1) % 7) {
    case 0:
      // Held at 27: deals with an ideal of 28 are ~2% of eight-colour deals,
      // and hunting for one took six seconds on a desktop (twenty on a phone).
      return { id, colors: 8, empties: 2, minPar: 27, name, murky };
    case 1:
      return { id, colors: 7, empties: 2, minPar: Math.min(19, 18 + tier), name, murky: true };
    case 2:
      // 17, not the campaign's 18: cauldron deals are the slowest to prove and
      // this one is dealt live on the player's phone.
      return {
        id, colors: 6, empties: 1, cauldron: true, minPar: 17, name, murky,
      };
    case 3:
      return { id, colors: 6, empties: 1, minPar: 19, name, murky };
    case 4:
      return { id, colors: 7, empties: 3, minPar: 17, name, murky: true };
    case 5:
      return { id, colors: 8, empties: 2, minPar: 27, lock: { seals: 2 }, name, murky };
    default:
      return { id, colors: 8, empties: 1, minPar: 25, oneWay: true, name, murky };
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
