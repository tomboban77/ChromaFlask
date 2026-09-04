/** Economy and scoring rules. Pure functions so they are trivially tunable. */

export type PowerupId = 'undo' | 'hint' | 'bottle';

export interface EconomyConfig {
  readonly startingCoins: number;
  /** Free uses granted at the start of every level attempt. */
  readonly freeUses: Readonly<Record<PowerupId, number>>;
  /** Coin price once the free uses are spent. */
  readonly prices: Readonly<Record<PowerupId, number>>;
  readonly rewardPerStar: number;
  readonly baseReward: number;
  readonly firstClearBonus: number;
  /** Extra empty tubes the Add Bottle powerup may add per attempt. */
  readonly maxExtraTubes: number;
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  startingCoins: 1000,
  freeUses: { undo: 3, hint: 3, bottle: 3 },
  prices: { undo: 30, hint: 80, bottle: 120 },
  rewardPerStar: 25,
  baseReward: 50,
  firstClearBonus: 100,
  maxExtraTubes: 2,
};

/**
 * Stars from move efficiency. `par` is the proven optimal solution length, so
 * three stars means the player played at or near a mathematically perfect line.
 * The tolerance scales with par so long levels are not punishingly strict.
 */
export function starsFor(moves: number, par: number): 1 | 2 | 3 {
  const perfect = par + Math.max(2, Math.round(par * 0.15));
  const good = par + Math.max(5, Math.round(par * 0.5));
  if (moves <= perfect) return 3;
  if (moves <= good) return 2;
  return 1;
}

export function coinsFor(
  stars: number,
  isFirstClear: boolean,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  return cfg.baseReward + stars * cfg.rewardPerStar + (isFirstClear ? cfg.firstClearBonus : 0);
}
