import { DAILY_BASE, dailySpec, isDaily } from './daily';
import type { LevelSpec } from './types';

/**
 * The 500-level campaign.
 *
 * Difficulty comes from three dials, moved on a sawtooth rather than a line so
 * the ramp has rhythm instead of a grind:
 *
 *  - colour count: raw combinatorial complexity (2 -> 8 across the campaign)
 *  - empty tubes:  working space; 3 = breather, 2 = standard, 1 = squeeze
 *  - minPar:       the generator rejects boards whose optimal line is shorter,
 *                  so late levels are *provably* deep, not just "probably"
 *  - murky:        from level 36, colours below each tube's mouth start hidden
 *
 * Levels 1-200 are the original ramp. Levels 201-500 continue in five tiers
 * of sixty. Because the campaign is precomputed offline, the par floor can
 * climb through the whole distribution of deals (eight-colour boards reach
 * an ideal of 27 by the last tier, squeezes 19, cauldrons 18, breathers 17),
 * a second squeeze joins each block of ten from the third tier, and murk
 * rises to three levels in four. New mechanics are meant to land in these
 * tiers as well (see docs/AUDIT.md L4).
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
 * Late-campaign tier, 0 for levels 1-200, then 1-5 for each sixty levels
 * from 201. Each tier nudges the par floors up within proven caps.
 */
function tierFor(id: number): number {
  return id <= 200 ? 0 : Math.floor((id - 201) / 60) + 1;
}

/** Campaign curve for levels 11-500. */
function specFor(id: number): LevelSpec {
  // Base colour band. The palette holds 8 colours; past that point the heat
  // comes from minPar, squeezes, the cauldron and the murky mechanic instead.
  const colors = id <= 30 ? 6 : id <= 55 ? 7 : 8;
  const tier = tierFor(id);

  // Cauldron every 10 levels from 22: it replaces one empty tube with a
  // vessel that takes anything but must end empty. Introduced well clear of
  // the murky mechanic's debut (36) so players meet one new idea at a time.
  // Capped at 6 colours: the cauldron's any-colour branching makes bigger
  // exact solves take seconds on-device, and one empty tube plus a
  // must-empty cauldron carries plenty of heat on its own. The floor stays at
  // 15 in the late tiers: cauldron deals are the slowest to prove.
  if (id >= 22 && id % 10 === 2) {
    return {
      id, colors: 6, empties: 1, cauldron: true,
      // 13 -> 15 across the original ramp, then 16, 16, 17, 17, 18.
      minPar: id <= 60 ? 13 : id <= 200 ? 15 : Math.min(18, 15 + Math.ceil(tier / 2)),
      name: nameFor(id), murky: isMurky(id),
    };
  }

  // Par floor. Raw eight-colour deals have an ideal of 23-28 (median 25), so
  // a floor below that rejects nothing and the curve goes flat; this one
  // climbs through the whole distribution instead:
  //   56-100: 17, 18, 19   101-150: 20, 21   151-200: 22   tiers: 23 .. 27.
  // The precompute pays for the rejected deals offline; players never wait.
  let minPar: number;
  if (colors === 6) minPar = 13 + Math.min(2, Math.floor((id % 30) / 12));
  else if (colors === 7) minPar = 15 + Math.min(2, Math.floor((id % 30) / 12));
  else if (id <= 100) minPar = 17 + Math.floor((id - 56) / 15);
  else if (id <= 150) minPar = 20 + Math.floor((id - 101) / 25);
  else if (id <= 200) minPar = 22;
  else minPar = Math.min(27, 22 + tier);

  let empties = 2;

  // Breather every 10 levels: extra tube, fewer colours, gentler par.
  // Capped at 7 colours: an 11-tube 8-colour board makes the optimal solve
  // explode (seconds of generation on-device) without feeling any easier.
  // Breathers deepen too (13 -> 17), staying well under the standard floor.
  if (id % 10 === 4) {
    const c = Math.min(colors, 7);
    return {
      id, colors: c, empties: 3,
      minPar: c === 7 ? Math.min(17, 13 + tier) : 11,
      name: nameFor(id), murky: isMurky(id),
    };
  }

  // Squeeze every 10 levels: one empty tube. Colours are capped because
  // single-empty boards get vanishingly rare to deal beyond six colours.
  // From the third late tier a second squeeze joins each block of ten.
  if (id % 10 === 8 || (tier >= 3 && id % 10 === 6)) {
    empties = 1;
    const squeezed = id <= 30 ? 5 : 6;
    // 11 (five colours), then 14 -> 15 across the ramp, then 16 .. 19.
    minPar = squeezed === 5 ? 11 : id <= 100 ? 14 : id <= 200 ? 15 : Math.min(19, 15 + tier);
    return { id, colors: squeezed, empties, minPar, name: nameFor(id), murky: isMurky(id) };
  }

  return { id, colors, empties, minPar, name: nameFor(id), murky: isMurky(id) };
}

/** Murky cadence: introduced at 36, common by 70, dominant past 120, three in four from level 321. */
function isMurky(id: number): boolean {
  if (id < 36) return false;
  if (id <= 70) return id % 5 === 1;
  if (id <= 120) return id % 3 === 0;
  if (tierFor(id) >= 3) return id % 4 !== 1;
  return id % 3 !== 1;
}

export const LEVEL_COUNT = 500;

export const LEVELS: readonly LevelSpec[] = [
  ...OPENING,
  ...Array.from({ length: LEVEL_COUNT - OPENING.length }, (_, i) =>
    specFor(OPENING.length + 1 + i),
  ),
];

// ------------------------------------------------------------------ endless
/** Endless levels are numbered straight on from the campaign: 201, 202, ... */
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
  switch ((n - 1) % 5) {
    case 0:
      return { id, colors: 8, empties: 2, minPar: Math.min(28, 27 + tier), name, murky };
    case 1:
      return { id, colors: 7, empties: 2, minPar: Math.min(19, 18 + tier), name, murky: true };
    case 2:
      return {
        id, colors: 6, empties: 1, cauldron: true, minPar: 18, name, murky,
      };
    case 3:
      return { id, colors: 6, empties: 1, minPar: 19, name, murky };
    default:
      return { id, colors: 7, empties: 3, minPar: 17, name, murky: true };
  }
}

export function getLevelSpec(id: number): LevelSpec {
  if (!Number.isInteger(id) || id < 1) throw new Error(`No level ${id}`);
  if (isDaily(id)) return dailySpec(id);
  if (isEndless(id)) return endlessSpec(id);
  const spec = LEVELS[id - 1];
  if (!spec) throw new Error(`No level ${id}`);
  return spec;
}
