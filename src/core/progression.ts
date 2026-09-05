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
  /** Paid once, on the first clear of a chapter's last level. */
  readonly chapterBonus: number;
  /** Paid once per calendar day, on the first clear of that day's challenge. */
  readonly dailyBonus: number;
  /** Extra empty tubes the Add Bottle powerup may add per attempt. */
  readonly maxExtraTubes: number;
}

/**
 * Tuned for a free-to-play audience, not a demo:
 *
 *  - Undo stays generous: it removes mis-tap frustration and sells nothing.
 *  - One free hint per attempt is a taste; the second comes from the shop.
 *  - Bottles are never free. A free extra tube turns every "squeeze" level
 *    into a breather and erases the difficulty curve.
 *  - A 3-star first clear pays 95 coins, so a hint 3-pack (200) is about two
 *    levels of play and a bottle 3-pack (320) about three and a half. Replays
 *    pay only for newly earned stars (see coinsFor).
 *  - 200 starting coins buy exactly one hint pack: enough to learn what the
 *    shop is for, not enough to never need it.
 *
 * All of this is meant to be retuned live through RemoteConfig once real
 * funnel data exists.
 */
export const DEFAULT_ECONOMY: EconomyConfig = {
  startingCoins: 200,
  freeUses: { undo: 3, hint: 1, bottle: 0 },
  prices: { undo: 30, hint: 80, bottle: 120 },
  rewardPerStar: 15,
  baseReward: 50,
  firstClearBonus: 0,
  // Roughly one level's worth of coins every twenty levels: a moment, not a
  // second income stream.
  chapterBonus: 100,
  // Half a level's worth on top of the normal reward: a reason to come back
  // daily, not a reason to skip the campaign.
  dailyBonus: 50,
  maxExtraTubes: 2,
};

// ------------------------------------------------------------ login reward
/**
 * Seven-day welcome-back cycle. Day n of a run of consecutive days pays
 * LOGIN_REWARDS[n-1]; day seven also refills hearts. A missed day restarts
 * the cycle; after day seven it repeats.
 */
export const LOGIN_REWARDS: readonly number[] = [20, 30, 40, 50, 60, 80, 150];
export const LOGIN_CYCLE = LOGIN_REWARDS.length;

/** 1-based day within the cycle for a login streak of `streak` days. */
export function loginCycleDay(streak: number): number {
  return ((Math.max(1, streak) - 1) % LOGIN_CYCLE) + 1;
}

export function loginRewardFor(streak: number): { coins: number; refillLives: boolean } {
  const day = loginCycleDay(streak);
  return { coins: LOGIN_REWARDS[day - 1] as number, refillLives: day === LOGIN_CYCLE };
}

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
export interface StarThresholds {
  /** Most moves that still earn three stars. */
  readonly three: number;
  /** Most moves that still earn two stars. */
  readonly two: number;
}

export function starThresholds(par: number): StarThresholds {
  return {
    three: par + Math.max(2, Math.round(par * 0.15)),
    two: par + Math.max(5, Math.round(par * 0.5)),
  };
}

export function starsFor(moves: number, par: number): 1 | 2 | 3 {
  const t = starThresholds(par);
  if (moves <= t.three) return 3;
  if (moves <= t.two) return 2;
  return 1;
}

/**
 * Coins for a win. `prevStars` is the level's best star count before this
 * win, or null on the first clear.
 *
 * A first clear pays base + stars + bonus. A replay pays only for stars the
 * player did not have yet - so improving 1 -> 3 stars earns two stars' worth,
 * and repeating an already-perfect level earns nothing. Anything else is an
 * infinite coin farm: replaying level 1 (par 4, ~10 s) would otherwise pay
 * 125 coins a time, i.e. the biggest coin pack in about a quarter of an hour.
 */
export function coinsFor(
  stars: number,
  prevStars: number | null,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  if (prevStars === null) {
    return cfg.baseReward + stars * cfg.rewardPerStar + cfg.firstClearBonus;
  }
  return Math.max(0, stars - prevStars) * cfg.rewardPerStar;
}
