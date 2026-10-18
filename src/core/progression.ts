/** Economy and scoring rules. Pure functions so they are trivially tunable. */

export type PowerupId = 'undo' | 'hint' | 'bottle';

export interface EconomyConfig {
  readonly startingCoins: number;
  /** Free uses granted at the start of every level attempt (see freeUsesFor). */
  readonly freeUses: Readonly<Record<PowerupId, number>>;
  /**
   * The free hint is a teaching aid: it is granted only on campaign levels up
   * to this id (the first chapter). Past it, every hint is earned or bought.
   */
  readonly freeHintLevels: number;
  /**
   * Coins a clear's star tier is worth: index 0 = one star, 2 = three. The
   * gaps are deliberate - a perfect clear pays 7x a sloppy one's star value,
   * so efficiency (the actual skill) is what the economy rewards.
   */
  readonly starCoins: readonly [number, number, number];
  readonly baseReward: number;
  readonly firstClearBonus: number;
  /** The bronze chapter chest: paid once, when a chapter's last level is first cleared. */
  readonly chapterBonus: number;
  /** The silver chapter chest: paid once, at three quarters of a chapter's stars. */
  readonly chestSilverCoins: number;
  /** The gold chapter chest: paid once, when every level in a chapter is three-starred. */
  readonly chestGoldCoins: number;
  /** Weekly event: paid once a week for clearing all of its boards... */
  readonly weeklyPrizeCoins: number;
  readonly weeklyPrizeHints: number;
  /** ...and once more for three-starring every one of them. */
  readonly weeklyPerfectCoins: number;
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
  /**
   * The most a first clear can earn for speed (before difficulty scaling).
   * Paid in full only at the very start of the window and shrinking in steps
   * of 5 as the clock runs down - see timeBonusFor.
   */
  readonly timeBonusCoins: number;
  /** Win-streak bonus: from `streakAfter` wins in a row (no lost boards),
   *  level rewards pay `streakMultiplier`x. Careful play compounds. */
  readonly streakAfter: number;
  readonly streakMultiplier: number;
  /** Coins to skip the current level (unlocks the next; the skipped one earns nothing). */
  readonly skipPrice: number;
  /**
   * Coins for one use bought on the spot from the "out of X" dialog. Dearer
   * per use than any shop pack: convenience costs, planning ahead saves.
   */
  readonly singlePrice: Readonly<Record<PowerupId, number>>;
  /** Timed levels: seconds one extension adds, and what it costs in coins. */
  readonly timeExtendSeconds: number;
  readonly timeExtendPrice: number;
}

/**
 * Rebalanced 2026-10-18 after player feedback: "level 37 and 5865 coins - why
 * would I ever buy anything?". The old payouts (~190 coins a level against a
 * 200-coin hint pack) meant nothing in the shop was ever scarce. Now:
 *
 *  - A full-scale first clear pays 25/30/40 coins for 1/2/3 stars (was
 *    120/140/180 with the time bonus), so a hint pack (600) is roughly fifteen
 *    levels of careful play. Boosters are a decision again, not a reflex.
 *  - One free undo per attempt covers a mis-tap; one free hint per attempt
 *    through the first chapter teaches the booster. Bottles are never free.
 *  - Out of stock, the player watches an ad for one use, buys one on the spot
 *    at a premium (singlePrice), or goes to the shop.
 *  - Stars are now also docked for an extra bottle and for missing the clock
 *    (see starsForAttempt), so the clock and the bottle both carry a price
 *    beyond coins.
 *  - 300 starting coins buy one undo pack, or one hint on the spot: enough to
 *    learn what the shop is for, not enough to never need it.
 *
 * All of this is meant to be retuned live through RemoteConfig once real
 * funnel data exists.
 */
export const DEFAULT_ECONOMY: EconomyConfig = {
  startingCoins: 300,
  freeUses: { undo: 1, hint: 1, bottle: 0 },
  freeHintLevels: 20,
  starCoins: [5, 10, 20],
  baseReward: 20,
  firstClearBonus: 0,
  // A couple of levels' worth at the end of each twenty-level chapter.
  chapterBonus: 60,
  // Silver and gold chests: the reason to go back for stars. Gold demands
  // three stars - inside the clock, without a bottle - on twenty boards.
  chestSilverCoins: 120,
  chestGoldCoins: 300,
  // The weekly event pays each board like a level (full difficulty scale),
  // plus these once-a-week prizes.
  weeklyPrizeCoins: 120,
  weeklyPrizeHints: 1,
  weeklyPerfectCoins: 150,
  // A reason to come back daily, not a reason to skip the campaign.
  dailyBonus: 25,
  // One extra bottle at most: the late campaign is built on one or two empty
  // tubes, and a second extra tube halved it again.
  maxUses: { undo: 3, hint: 2, bottle: 1 },
  // A little sweetener on top of the third star the clock already decides.
  timeBonusCoins: 10,
  // From the third straight fresh win, rewards pay a quarter again.
  streakAfter: 3,
  streakMultiplier: 1.25,
  // A skip is a last resort, not a shortcut: about twenty-five levels of income,
  // dearer than a hint pack so trying a hint first is always cheaper.
  skipPrice: 900,
  singlePrice: { undo: 100, hint: 250, bottle: 350 },
  // Timed levels: thirty more seconds for about six levels of income (or an ad).
  timeExtendSeconds: 30,
  timeExtendPrice: 250,
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
/** Opening levels on the relaxed clock while the rules are being learned. */
export const RELAXED_CLOCK_LEVELS = 3;

/**
 * The star clock for a level, in seconds. Every level shows it counting down,
 * and finishing after it has run out costs a star (see starsForAttempt), so
 * a perfect clear means efficient *and* decisive. A first clear inside it also
 * pays the small time bonus. Until 2026-10-18 the clock only paid a bonus and
 * players ignored it ("we have a timer but no use").
 *
 * The flat 15 covers reading the board; then six seconds a move on the first
 * three levels and five from level 4 on - a pour animates in about one, so
 * five leaves four for thought. Daily, weekly and endless ids sit far above
 * the opening, so they run on the standard clock.
 */
export function timeBonusSeconds(par: number, levelId: number): number {
  return 15 + par * (levelId <= RELAXED_CLOCK_LEVELS ? 6 : 5);
}

/**
 * Timed levels ("Against the clock"): the hard limit, in seconds. Half again
 * the star clock, in whole fives. Running out fails the attempt unless the
 * player buys (or watches an ad for) an extension.
 */
export function timeLimitSeconds(par: number, levelId: number): number {
  return Math.round((timeBonusSeconds(par, levelId) * 1.5) / 5) * 5;
}

/**
 * The time bonus a first clear earns after `elapsedSec` whole seconds: the
 * difficulty-scaled maximum while the window is fresh, then one 5-coin step
 * less for each equal slice of the window that has run out, and nothing once
 * it has. Faster is always worth more, and the HUD shows exactly this value,
 * so the tag the player sees is the amount the win pays.
 */
export function timeBonusFor(
  elapsedSec: number,
  par: number,
  levelId: number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  const window = timeBonusSeconds(par, levelId);
  const remaining = window - Math.max(0, elapsedSec);
  if (remaining <= 0) return 0;
  const steps = scaledReward(cfg.timeBonusCoins, par) / 5;
  return 5 * Math.min(steps, Math.ceil((steps * remaining) / window));
}

/**
 * Free uses of each powerup at the start of an attempt on `levelId`. The
 * free hint stops after the first chapter; endless and daily ids sit far
 * above it, so they never get one.
 */
export function freeUsesFor(
  levelId: number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): Readonly<Record<PowerupId, number>> {
  return levelId <= cfg.freeHintLevels ? cfg.freeUses : { ...cfg.freeUses, hint: 0 };
}

// ------------------------------------------------------------ login reward
/**
 * Seven-day welcome-back cycle. Day n of a run of consecutive days pays
 * LOGIN_REWARDS[n-1]; day seven also refills hearts. A missed day restarts
 * the cycle; after day seven it repeats.
 */
export const LOGIN_REWARDS: readonly number[] = [10, 15, 20, 25, 30, 40, 100];
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
    | { kind: 'bundle'; powerups: Readonly<Partial<Record<PowerupId, number>>> }
    | { kind: 'refillLives' }
    | { kind: 'addLives'; count: number }
    | { kind: 'infiniteLives'; hours: number }
    | { kind: 'streakFreeze'; count: number };
}

/**
 * The coin shop. Prices are anchored on the three-packs (undo 240, hint 600,
 * bottle 900 - 80, 200 and 300 a use) and a full-hearts refill (1000). They
 * were tripled on 2026-10-18 while level income fell to about a quarter:
 * a hint pack is now about fifteen levels of income, not one.
 *
 *  - Ten-packs save about a sixth on the three-pack rate: a reason to save
 *    up, not so steep that buying three-packs feels like a mistake.
 *  - The booster bundle (three undos, three hints, one bottle) is worth 1140
 *    at three-pack rates and costs 950: the "one of everything" shelf.
 *  - A single heart costs a little under a quarter of a refill, so
 *    refilling stays the better deal when the hearts are all gone.
 *  - An hour of unlimited hearts costs under two refills: for a long
 *    session on hard boards, not a better refill.
 *  - A streak freeze costs twenty days of the daily bonus: cheap next to a
 *    long streak, dear enough not to be bought on reflex. At most
 *    MAX_STREAK_FREEZES (2) can be held.
 */
export const COIN_SHOP: readonly CoinShopItem[] = [
  {
    id: 'lives.refill',
    title: 'Refill hearts',
    desc: 'Back to full hearts instantly',
    price: 1000,
    grant: { kind: 'refillLives' },
  },
  {
    id: 'lives.one',
    title: '+1 heart',
    desc: 'One more try, right now',
    price: 240,
    grant: { kind: 'addLives', count: 1 },
  },
  {
    id: 'lives.hour',
    title: 'Unlimited hearts · 1h',
    desc: 'Play as much as you like for an hour',
    price: 1800,
    grant: { kind: 'infiniteLives', hours: 1 },
  },
  {
    id: 'streak.freeze',
    title: 'Streak freeze',
    desc: 'Saves your daily streak if you miss a day',
    price: 500,
    grant: { kind: 'streakFreeze', count: 1 },
  },
  {
    id: 'bundle.boost',
    title: 'Booster bundle',
    desc: '3 undos, 3 hints and 1 bottle',
    price: 950,
    grant: { kind: 'bundle', powerups: { undo: 3, hint: 3, bottle: 1 } },
  },
  {
    id: 'undo.x3',
    title: 'Undo ×3',
    desc: 'Take back your last pours',
    price: 240,
    grant: { kind: 'powerup', powerup: 'undo', count: 3 },
  },
  {
    id: 'undo.x10',
    title: 'Undo ×10',
    desc: 'A big stack of second chances',
    price: 700,
    grant: { kind: 'powerup', powerup: 'undo', count: 10 },
  },
  {
    id: 'hint.x3',
    title: 'Hint ×3',
    desc: 'Reveals a winning move',
    price: 600,
    grant: { kind: 'powerup', powerup: 'hint', count: 3 },
  },
  {
    id: 'hint.x10',
    title: 'Hint ×10',
    desc: 'Winning moves for the hardest boards',
    price: 1700,
    grant: { kind: 'powerup', powerup: 'hint', count: 10 },
  },
  {
    id: 'bottle.x3',
    title: 'Bottle ×3',
    desc: 'Extra room when you need it',
    price: 900,
    grant: { kind: 'powerup', powerup: 'bottle', count: 3 },
  },
  {
    id: 'bottle.x10',
    title: 'Bottle ×10',
    desc: 'Room to breathe on every squeeze',
    price: 2600,
    grant: { kind: 'powerup', powerup: 'bottle', count: 10 },
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
  // Tightened after player feedback (2026-09-29): three stars within 10% of
  // the proven optimum (was 15%), two within 30% (was 50%). A par-25 board
  // now needs 28 pours for three stars and 33 for two (was 29 and 38).
  return {
    three: par + Math.max(2, Math.round(par * 0.1)),
    two: par + Math.max(4, Math.round(par * 0.3)),
  };
}

export function starsFor(moves: number, par: number): 1 | 2 | 3 {
  const t = starThresholds(par);
  if (moves <= t.three) return 3;
  if (moves <= t.two) return 2;
  return 1;
}

/** What an attempt did beyond its pour count that costs stars. */
export interface StarPenalties {
  /** Extra bottles added this attempt: each one costs a star. */
  readonly bottles: number;
  /** Finished after the star clock ran out: costs a star. */
  readonly overtime: boolean;
}

export const NO_PENALTIES: StarPenalties = { bottles: 0, overtime: false };

/**
 * The stars an attempt earns: the pour-count tier, less one per extra bottle
 * and one for missing the clock, never below one (a clear is a clear). The
 * HUD pips and the win screen both grade with this, so the pill can never
 * promise a star the result then withholds.
 */
export function starsForAttempt(moves: number, par: number, pen: StarPenalties): 1 | 2 | 3 {
  const docked = starsFor(moves, par) - pen.bottles - (pen.overtime ? 1 : 0);
  return Math.max(1, Math.min(3, docked)) as 1 | 2 | 3;
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
