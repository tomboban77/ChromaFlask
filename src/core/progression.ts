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

// ------------------------------------------------------------------- lives
export const LIVES_MAX = 5;
export const LIVES_REGEN_MS = 30 * 60 * 1000;

// ---------------------------------------------------------- coin shop items
/** Items bought with earned/purchased coins (soft currency), never real money. */
export interface CoinShopItem {
  readonly id: string;
  readonly title: string;
  readonly desc: string;
  readonly price: number;
  readonly grant:
    | { kind: 'powerup'; powerup: PowerupId; count: number }
    | { kind: 'refillLives' };
}

export const COIN_SHOP: readonly CoinShopItem[] = [
  {
    id: 'lives.refill',
    title: 'Refill hearts',
    desc: 'Back to full hearts instantly',
    price: 500,
    grant: { kind: 'refillLives' },
  },
  {
    id: 'undo.x3',
    title: 'Undo ×3',
    desc: 'Take back your last pours',
    price: 80,
    grant: { kind: 'powerup', powerup: 'undo', count: 3 },
  },
  {
    id: 'hint.x3',
    title: 'Hint ×3',
    desc: 'Reveals a winning move',
    price: 200,
    grant: { kind: 'powerup', powerup: 'hint', count: 3 },
  },
  {
    id: 'bottle.x3',
    title: 'Bottle ×3',
    desc: 'Extra room when you need it',
    price: 320,
    grant: { kind: 'powerup', powerup: 'bottle', count: 3 },
  },
];

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
