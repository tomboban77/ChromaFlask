import type { LevelSpec } from './types';

/**
 * The 200-level campaign.
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
 * Every spec is deterministic (id seeds the generator) and machine-verified by
 * `npm run test:core`: solvable, meets minPar, conserves units, and generates
 * fast enough for on-device use. Retune here, re-run the test, ship.
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

/** Campaign curve for levels 11-200. */
function specFor(id: number): LevelSpec {
  // Base colour band. The palette holds 8 colours; past that point the heat
  // comes from minPar, squeezes, the cauldron and the murky mechanic instead.
  const colors = id <= 30 ? 6 : id <= 55 ? 7 : 8;

  // Cauldron every 10 levels from 22: it replaces one empty tube with a
  // vessel that takes anything but must end empty. Introduced well clear of
  // the murky mechanic's debut (36) so players meet one new idea at a time.
  // Capped at 6 colours: the cauldron's any-colour branching makes bigger
  // exact solves take seconds on-device, and one empty tube plus a
  // must-empty cauldron carries plenty of heat on its own.
  if (id >= 22 && id % 10 === 2) {
    return {
      id, colors: 6, empties: 1, cauldron: true,
      minPar: id <= 60 ? 13 : 15,
      name: nameFor(id), murky: isMurky(id),
    };
  }

  // Base par floor per band, rising slowly inside the final band so level 190
  // is measurably deeper than level 60.
  let minPar = colors === 6 ? 13 : colors === 7 ? 15 : 17;
  if (colors === 8) minPar += Math.min(4, Math.floor((id - 56) / 30));
  else minPar += Math.min(2, Math.floor((id % 30) / 12));

  let empties = 2;

  // Breather every 10 levels: extra tube, fewer colours, gentler par.
  // Capped at 7 colours: an 11-tube 8-colour board makes the optimal solve
  // explode (seconds of generation on-device) without feeling any easier.
  if (id % 10 === 4) {
    const c = Math.min(colors, 7);
    return {
      id, colors: c, empties: 3,
      minPar: c === 7 ? 13 : 11,
      name: nameFor(id), murky: isMurky(id),
    };
  }

  // Squeeze every 10 levels: one empty tube. Colours are capped because
  // single-empty boards get vanishingly rare to deal beyond six colours.
  if (id % 10 === 8) {
    empties = 1;
    const squeezed = id <= 30 ? 5 : 6;
    minPar = squeezed === 5 ? 11 : 14;
    return { id, colors: squeezed, empties, minPar, name: nameFor(id), murky: isMurky(id) };
  }

  return { id, colors, empties, minPar, name: nameFor(id), murky: isMurky(id) };
}

/** Murky cadence: introduced at 36, common by 70, dominant past 120. */
function isMurky(id: number): boolean {
  if (id < 36) return false;
  if (id <= 70) return id % 5 === 1;
  if (id <= 120) return id % 3 === 0;
  return id % 3 !== 1;
}

export const LEVEL_COUNT = 200;

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
  return id > LEVEL_COUNT;
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
  switch ((n - 1) % 5) {
    case 0:
      return { id, colors: 8, empties: 2, minPar: Math.min(21, 18 + tier), name, murky };
    case 1:
      return { id, colors: 7, empties: 2, minPar: Math.min(18, 15 + tier), name, murky: true };
    case 2:
      return {
        id, colors: 6, empties: 1, cauldron: true, minPar: Math.min(15, 13 + tier), name, murky,
      };
    case 3:
      return { id, colors: 6, empties: 1, minPar: Math.min(15, 13 + tier), name, murky };
    default:
      return { id, colors: 7, empties: 3, minPar: Math.min(14, 12 + tier), name, murky: true };
  }
}

export function getLevelSpec(id: number): LevelSpec {
  if (!Number.isInteger(id) || id < 1) throw new Error(`No level ${id}`);
  if (isEndless(id)) return endlessSpec(id);
  const spec = LEVELS[id - 1];
  if (!spec) throw new Error(`No level ${id}`);
  return spec;
}
