/** Economy and scoring rules. Pure functions so they are trivially tunable. */

export type PowerupId = 'undo' | 'hint' | 'bottle';

export interface EconomyConfig {
  readonly startingCoins: number;
  /** Free uses granted at the start of every level attempt. */
  readonly freeUses: Readonly<Record<PowerupId, number>>;
  /**
   * Coins a clear's star tier is worth: index 0 = one star, 2 = three. The
   * gaps are deliberate - a perfect clear pays 7x a sloppy one's star value,
   * so efficiency (the actual skill) is what the economy rewards.
   */
  readonly starCoins: readonly [number, number, number];
  readonly baseReward: number;
  readonly firstClearBonus: number;
  /** Paid once, on the first clear of a chapter's last level. */
  readonly chapterBonus: number;
  /** Paid once per calendar day, on the first clear of that day's challenge. */
  readonly dailyBonus: number;
  /**
   * Hard per-attempt ceilings on each powerup, free and bought uses combined.
   * They keep a full wallet from flattening the difficulty curve: unlimited
   * undos/hints make every level solvable by brute patience, and each extra
   * bottle roughly halves a board's difficulty (the late game is built on
   * having only 1-2 empty tubes).
   */
  readonly maxUses: Readonly<Record<PowerupId, number>>;
  /** Paid on a first clear that beats the level's time-bonus window. */
  readonly timeBonusCoins: number;
  /** Win-streak bonus: from `streakAfter` wins in a row (no lost boards),
   *  level rewards pay `streakMultiplier`x. Careful play compounds. */
  readonly streakAfter: number;
  readonly streakMultiplier: number;
  /** Coins to skip the current level (unlocks the next; the skipped one earns nothing). */
  readonly skipPrice: number;
}

/**
 * Tuned for a free-to-play audience, not a demo:
 *
 *  - Undo stays generous: it removes mis-tap frustration and sells nothing.
 *  - One free hint per attempt is a taste; the second comes from the shop.
 *  - Bottles are never free. A free extra tube turns every "squeeze" level
 *    into a breather and erases the difficulty curve.
 *  - A first clear pays 60/80/120 coins for 1/2/3 stars at full difficulty:
 *    a perfect is worth double a sloppy clear, so playing well - not just
 *    finishing - is what fills the wallet. Every payout is then scaled by the
 *    level's par (see rewardScale), so a 20-second opener pays pocket change
 *    and the full amounts arrive with the levels that earn them. Replays pay
 *    only the star-value difference for newly earned stars (see coinsFor).
 *  - 200 starting coins buy exactly one hint pack: enough to learn what the
 *    shop is for, not enough to never need it.
 *
 * All of this is meant to be retuned live through RemoteConfig once real
 * funnel data exists.
 */
export const DEFAULT_ECONOMY: EconomyConfig = {
  startingCoins: 200,
  freeUses: { undo: 3, hint: 1, bottle: 0 },
  starCoins: [10, 30, 70],
  baseReward: 50,
  firstClearBonus: 0,
  // Roughly one level's worth of coins every twenty levels: a moment, not a
  // second income stream.
  chapterBonus: 100,
  // Half a level's worth on top of the normal reward: a reason to come back
  // daily, not a reason to skip the campaign.
  dailyBonus: 50,
  maxUses: { undo: 5, hint: 3, bottle: 2 },
  // A quarter of a base clear: worth chasing, not worth farming (it only
  // pays on a first clear - see the win flow).
  timeBonusCoins: 25,
  // From the third straight win, rewards pay half again: losing a board (the
  // only thing that breaks the streak) now also costs momentum, which makes
  // careful play the profitable style without punishing anyone.
  streakAfter: 3,
  streakMultiplier: 1.5,
  // A skip is a safety valve against churn, not a shortcut: a little over
  // one and a half perfect clears, dearer than a hint pack (200 buys three
  // hints) so trying a hint first is always the cheaper route.
  skipPrice: 150,
};

/**
 * The streak bonus on top of a win's level reward (never on the one-time
 * chapter/daily milestones). Zero-reward wins stay zero: an already-perfect
 * replay must not become a streak farm.
 */
export function streakBonusFor(
  reward: number,
  streak: number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  if (reward <= 0 || streak < cfg.streakAfter) return 0;
  return Math.round((reward * (cfg.streakMultiplier - 1)) / 5) * 5;
}

// -------------------------------------------------------------- time bonus
/**
 * The time-bonus window for a level, in seconds. Every level shows a clock;
 * beating it pays `timeBonusCoins` on the first clear, and missing it costs
 * nothing - time pressure in this genre must stay optional or it churns the
 * relaxed majority. Six seconds a move covers a think plus a pour at a brisk
 * but human pace; the flat 20 covers reading the board.
 */
export function timeBonusSeconds(par: number): number {
  return 20 + par * 6;
}

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

// ---------------------------------------------------------- reward scaling
/**
 * Rewards scale with the level's proven difficulty. Par is the one number
 * every level already carries (solver-proven, so it cannot be gamed): a
 * 20-second opener paying the same as a five-minute endgame board floods the
 * wallet exactly where a player learns what coins are worth. The scale runs
 * from a 0.3 floor to 1.0 at par 22 - the standard floor from level 151 on -
 * so the late campaign, endless and the daily all pay in full.
 */
export function rewardScale(par: number): number {
  return Math.min(1, Math.max(0.3, par / 22));
}

/** One reward component scaled by difficulty, rounded to friendly 5s. */
export function scaledReward(value: number, par: number): number {
  return Math.max(5, Math.round((value * rewardScale(par)) / 5) * 5);
}

/** The difficulty-scaled star value for a star count, tolerating 0 (no clear yet). */
export function starValue(
  stars: number,
  par: number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  return stars >= 1 ? scaledReward(cfg.starCoins[Math.min(3, stars) - 1] as number, par) : 0;
}

/**
 * Coins for a win. `prevStars` is the level's best star count before this
 * win, or null on the first clear.
 *
 * A first clear pays base + the star tier's value + bonus, all scaled by the
 * level's difficulty (see rewardScale). A replay pays only the difference to
 * the best tier already held - so improving 1 -> 3 stars earns the scaled
 * starCoins[2] - starCoins[0], and repeating an already-perfect level earns
 * nothing. Anything else is an infinite coin farm: replaying level 1 (par 2,
 * ~10 s) would otherwise pay a win's coins a time, i.e. the biggest coin
 * pack in well under an hour.
 */
export function coinsFor(
  stars: number,
  prevStars: number | null,
  par: number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  if (prevStars === null) {
    return scaledReward(cfg.baseReward, par) + starValue(stars, par, cfg) + cfg.firstClearBonus;
  }
  return Math.max(0, starValue(stars, par, cfg) - starValue(prevStars, par, cfg));
}
