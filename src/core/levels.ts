import type { LevelSpec } from './types';

/**
 * Difficulty curve for the launch set.
 *
 * Two dials drive difficulty: colour count (raw complexity) and empty-tube
 * count (working space). Alternating them keeps the ramp from feeling linear -
 * levels 5 and 7 are deliberate "squeeze" levels that drop to a single empty
 * tube rather than simply adding another colour.
 */
export const LEVELS: readonly LevelSpec[] = [
  { id: 1, colors: 2, empties: 2, minPar: 2, name: 'First Pour' },
  { id: 2, colors: 3, empties: 2, minPar: 4, name: 'Triple Trouble' },
  { id: 3, colors: 3, empties: 1, minPar: 6, name: 'Tight Fit' },
  { id: 4, colors: 4, empties: 2, minPar: 7, name: 'Four Corners' },
  { id: 5, colors: 4, empties: 1, minPar: 9, name: 'The Squeeze' },
  { id: 6, colors: 5, empties: 2, minPar: 10, name: 'Spectrum' },
  { id: 7, colors: 5, empties: 1, minPar: 12, name: 'Narrow Margin' },
  { id: 8, colors: 6, empties: 2, minPar: 13, name: 'Six Shades' },
  { id: 9, colors: 7, empties: 2, minPar: 15, name: 'Prism' },
  { id: 10, colors: 8, empties: 2, minPar: 17, name: 'Alchemist' },
] as const;

export const LEVEL_COUNT = LEVELS.length;

export function getLevelSpec(id: number): LevelSpec {
  const spec = LEVELS[id - 1];
  if (!spec) throw new Error(`No level ${id}`);
  return spec;
}
