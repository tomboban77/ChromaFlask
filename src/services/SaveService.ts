/**
 * Persistence behind a swappable driver.
 *
 * Call sites only ever see SaveService, so moving to a real backend later means
 * writing one new driver - not touching game code.
 */

import { advanceStreak, currentStreak, type DailyStreak } from '@/core/daily';
import { LIVES_MAX, LIVES_REGEN_MS, type PowerupId } from '@/core/progression';
import type { Board, Move } from '@/core/types';

export interface SaveProfile {
  name: string;
  avatar: string;
  createdAt: number;
}

export interface LevelRecord {
  stars: number;
  bestMoves: number;
  clearedAt: number;
}

export interface GameSettings {
  sfx: boolean;
  music: boolean;
  haptics: boolean;
  colorblind: boolean;
  reducedMotion: boolean;
  /** Consent to send anonymous usage events (level funnel, errors) off-device. */
  analytics: boolean;
}

/** Owned powerup uses bought in the shop, spent after the per-level free uses. */
export type Inventory = Record<'undo' | 'hint' | 'bottle', number>;

export interface LivesState {
  count: number;
  /** Epoch ms the next heart arrives, or 0 while at full hearts. */
  nextRegenAt: number;
  /** Epoch ms until which hearts are unlimited, or 0. */
  infiniteUntil: number;
}

/** Lifetime play counters, shown on the profile card. */
export interface LifetimeStats {
  plays: number;
  wins: number;
  perfects: number;
  pours: number;
  hintsUsed: number;
  /** Consecutive wins without abandoning or failing a level. */
  streak: number;
  bestStreak: number;
}

/**
 * A level attempt saved mid-way, so backgrounding or killing the app never
 * costs the player their moves. Written after every move and powerup use;
 * cleared by a win, a restart, or a confirmed quit.
 */
export interface InProgressState {
  levelId: number;
  board: Board;
  history: Move[];
  /** Concealed units per tube (murky levels), else zeros. */
  hidden: number[];
  extraTubes: number;
  uses: Record<PowerupId, number>;
  /** Play time so far, so the win screen's timer excludes the break. */
  elapsedMs: number;
}

export interface SaveData {
  version: number;
  profile: SaveProfile | null;
  coins: number;
  levels: Record<string, LevelRecord>;
  settings: GameSettings;
  tutorialDone: boolean;
  inventory: Inventory;
  lives: LivesState;
  stats: LifetimeStats;
  /** Whether the murky-potion mechanic has been introduced with a toast. */
  murkySeen: boolean;
  /** Whether the cauldron mechanic has been introduced with a toast. */
  cauldronSeen: boolean;
  /** Stable anonymous ID shown in Settings, quoted in support emails. */
  supportId: string;
  /** Normalized support codes already applied, so a code redeems once. */
  redeemedCodes: string[];
  /**
   * Store purchase tokens whose goods have been granted. Lets a purchase that
   * was paid for but interrupted before the grant be restored exactly once.
   */
  grantedPurchaseTokens: string[];
  /** The attempt the player was in the middle of, if any. */
  inProgress: InProgressState | null;
  /** Whether endless mode has been introduced with a toast. */
  endlessSeen: boolean;
  /** Daily challenge records (keyed by day number) and streak. */
  daily: DailyState;
  /** Whether the locked-bottle mechanic has been introduced with a toast. */
  lockSeen: boolean;
}

/** Mutable save-side shape of the core's read-only DailyStreak, plus history. */
export interface DailyState {
  records: Record<string, LevelRecord>;
  streak: number;
  lastDay: number;
  bestStreak: number;
}

// Compile-time guard: the save shape must satisfy the core streak type.
const _dailyStateIsStreak: (s: DailyState) => DailyStreak = (s) => s;
void _dailyStateIsStreak;

export const SAVE_VERSION = 10;

/** Same confusable-free alphabet as support codes (no I, L, O, U). */
const SUPPORT_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

export function generateSupportId(): string {
  const bytes = new Uint8Array(8);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let id = '';
  for (const b of bytes) id += SUPPORT_ID_ALPHABET[b & 31];
  return id;
}

export function defaultSave(startingCoins: number): SaveData {
  return {
    version: SAVE_VERSION,
    profile: null,
    coins: startingCoins,
    levels: {},
    settings: {
      sfx: true,
      music: true,
      haptics: true,
      colorblind: false,
      reducedMotion: false,
      analytics: true,
    },
    tutorialDone: false,
    inventory: { undo: 0, hint: 0, bottle: 0 },
    lives: { count: LIVES_MAX, nextRegenAt: 0, infiniteUntil: 0 },
    stats: { plays: 0, wins: 0, perfects: 0, pours: 0, hintsUsed: 0, streak: 0, bestStreak: 0 },
    murkySeen: false,
    cauldronSeen: false,
    supportId: generateSupportId(),
    redeemedCodes: [],
    grantedPurchaseTokens: [],
    inProgress: null,
    endlessSeen: false,
    daily: { records: {}, streak: 0, lastDay: -1, bestStreak: 0 },
    lockSeen: false,
  };
}

export interface StorageDriver {
  readonly name: string;
  read(key: string): string | null;
  write(key: string, value: string): void;
}

/** Primary driver. */
class LocalStorageDriver implements StorageDriver {
  readonly name = 'localStorage';
  read(key: string): string | null {
    return window.localStorage.getItem(key);
  }
  write(key: string, value: string): void {
    window.localStorage.setItem(key, value);
  }
}

/**
 * Fallback for Safari private mode / disabled site data, where touching
 * localStorage throws. The game stays fully playable, it just forgets.
 */
class MemoryDriver implements StorageDriver {
  readonly name = 'memory';
  private readonly store = new Map<string, string>();
  read(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  write(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function pickDriver(): StorageDriver {
  try {
    const probe = '__cf_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return new LocalStorageDriver();
  } catch {
    console.warn('[save] localStorage unavailable, falling back to in-memory save');
    return new MemoryDriver();
  }
}

const KEY = 'chromaflask.save.v1';

export class SaveService {
  private readonly driver: StorageDriver;
  private readonly startingCoins: number;
  private data: SaveData;
  private flushHandle: number | null = null;

  constructor(startingCoins: number, driver: StorageDriver = pickDriver()) {
    this.driver = driver;
    this.startingCoins = startingCoins;
    this.data = this.load(startingCoins);
  }

  get persistent(): boolean {
    return this.driver.name !== 'memory';
  }

  private load(startingCoins: number): SaveData {
    const fallback = defaultSave(startingCoins);
    try {
      const raw = this.driver.read(KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      return this.migrate(parsed, fallback);
    } catch (err) {
      console.warn('[save] corrupt save discarded', err);
      return fallback;
    }
  }

  /** Forward-compatible merge so a shipped save is never lost on update. */
  private migrate(parsed: Partial<SaveData>, fallback: SaveData): SaveData {
    return {
      version: SAVE_VERSION,
      profile: parsed.profile ?? fallback.profile,
      coins: typeof parsed.coins === 'number' ? parsed.coins : fallback.coins,
      levels: parsed.levels ?? {},
      settings: { ...fallback.settings, ...(parsed.settings ?? {}) },
      tutorialDone: parsed.tutorialDone ?? false,
      // v1 saves predate the shop and lives; start them full, not empty.
      inventory: { ...fallback.inventory, ...(parsed.inventory ?? {}) },
      lives: { ...fallback.lives, ...(parsed.lives ?? {}) },
      // v2 saves predate lifetime stats; start the counters at zero.
      stats: { ...fallback.stats, ...(parsed.stats ?? {}) },
      murkySeen: parsed.murkySeen ?? false,
      cauldronSeen: parsed.cauldronSeen ?? false,
      // v4 saves predate support codes; mint the ID on first migrated load.
      supportId: parsed.supportId ?? fallback.supportId,
      redeemedCodes: parsed.redeemedCodes ?? [],
      // v5 saves predate purchase restore.
      grantedPurchaseTokens: parsed.grantedPurchaseTokens ?? [],
      // v6 saves predate mid-level resume.
      inProgress: parsed.inProgress ?? null,
      // v7 saves predate endless mode.
      endlessSeen: parsed.endlessSeen ?? false,
      // v8 saves predate the daily challenge.
      daily: { ...fallback.daily, ...(parsed.daily ?? {}), records: parsed.daily?.records ?? {} },
      // v9 saves predate the locked bottle.
      lockSeen: parsed.lockSeen ?? false,
    };
  }

  // ------------------------------------------------------------------ daily
  dailyRecord(day: number): LevelRecord | undefined {
    return this.data.daily.records[String(day)];
  }

  /** The streak as shown today (lapses if yesterday was missed). */
  dailyStreak(today: number): number {
    return currentStreak(this.data.daily, today);
  }

  get bestDailyStreak(): number {
    return this.data.daily.bestStreak;
  }

  /** Record a daily clear; the streak only moves on the first clear of a day. */
  recordDailyClear(
    day: number, stars: number, moves: number,
  ): { isFirstClear: boolean; prevStars: number | null; streak: number } {
    const key = String(day);
    const prev = this.data.daily.records[key];
    const isFirstClear = !prev;
    this.update((d) => {
      d.daily.records[key] = {
        stars: Math.max(stars, prev?.stars ?? 0),
        bestMoves: prev ? Math.min(prev.bestMoves, moves) : moves,
        clearedAt: Date.now(),
      };
      if (isFirstClear) {
        const next = advanceStreak(d.daily, day);
        d.daily.streak = next.streak;
        d.daily.lastDay = next.lastDay;
        d.daily.bestStreak = Math.max(d.daily.bestStreak, next.streak);
      }
      // Keep the last ~4 months; older days are only history.
      const keys = Object.keys(d.daily.records).map(Number).sort((a, b) => a - b);
      for (const old of keys.slice(0, Math.max(0, keys.length - 120))) {
        delete d.daily.records[String(old)];
      }
    });
    return { isFirstClear, prevStars: prev ? prev.stars : null, streak: this.data.daily.streak };
  }

  // ----------------------------------------------------------- in progress
  get inProgress(): Readonly<InProgressState> | null {
    return this.data.inProgress;
  }

  setInProgress(state: InProgressState | null): void {
    this.update((d) => {
      d.inProgress = state;
    });
  }

  get snapshot(): Readonly<SaveData> {
    return this.data;
  }

  update(mutate: (data: SaveData) => void): void {
    mutate(this.data);
    this.scheduleFlush();
  }

  /** Coalesce rapid writes into one, so pouring never touches disk mid-animation. */
  private scheduleFlush(): void {
    if (this.flushHandle !== null) return;
    this.flushHandle = window.setTimeout(() => {
      this.flushHandle = null;
      this.flush();
    }, 250);
  }

  flush(): void {
    try {
      this.driver.write(KEY, JSON.stringify(this.data));
    } catch (err) {
      console.warn('[save] write failed', err);
    }
  }

  // ------------------------------------------------------------ accessors
  get supportId(): string {
    return this.data.supportId;
  }

  /**
   * Wipe progress back to a fresh install. Identity survives on purpose:
   * settings are preferences (not progress), the support ID must stay stable
   * across a support conversation, and forgetting redeemed codes would let a
   * single-use code apply twice.
   */
  resetProgress(): void {
    const keepSettings = this.data.settings;
    const keepSupportId = this.data.supportId;
    const keepRedeemed = this.data.redeemedCodes;
    // Granted tokens survive too: a reset must not turn an old, already
    // consumed purchase into a second free grant on the next restore.
    const keepGranted = this.data.grantedPurchaseTokens;
    this.data = defaultSave(this.startingCoins);
    this.data.settings = keepSettings;
    this.data.supportId = keepSupportId;
    this.data.redeemedCodes = keepRedeemed;
    this.data.grantedPurchaseTokens = keepGranted;
    this.flush();
  }

  // ------------------------------------------------------------- purchases
  hasGrantedPurchase(token: string): boolean {
    return this.data.grantedPurchaseTokens.includes(token);
  }

  markPurchaseGranted(token: string): void {
    this.update((d) => {
      if (d.grantedPurchaseTokens.includes(token)) return;
      d.grantedPurchaseTokens.push(token);
      // Tokens are only needed until the store confirms consumption; keep a
      // generous tail rather than an unbounded list.
      if (d.grantedPurchaseTokens.length > 64) {
        d.grantedPurchaseTokens.splice(0, d.grantedPurchaseTokens.length - 64);
      }
    });
    // Written immediately: this is the record that prevents a double grant.
    this.flush();
  }

  markSupportCodeUsed(normalized: string): void {
    this.update((d) => {
      d.redeemedCodes.push(normalized);
      // A player will realistically redeem a handful; cap defensively.
      if (d.redeemedCodes.length > 64) d.redeemedCodes.splice(0, d.redeemedCodes.length - 64);
    });
  }

  /**
   * Support elevation: mark every level below `target` cleared (1 star) so the
   * map opens up to it. Real records are kept; bestMoves gets a huge sentinel
   * so the first genuine clear's Math.min replaces it.
   */
  unlockThroughLevel(target: number): void {
    this.update((d) => {
      for (let id = 1; id < target; id++) {
        const key = String(id);
        if (!d.levels[key]) {
          d.levels[key] = { stars: 1, bestMoves: Number.MAX_SAFE_INTEGER, clearedAt: Date.now() };
        }
      }
    });
  }

  get coins(): number {
    return this.data.coins;
  }

  addCoins(delta: number): void {
    this.update((d) => {
      d.coins = Math.max(0, d.coins + delta);
    });
  }

  trySpend(amount: number): boolean {
    if (this.data.coins < amount) return false;
    this.addCoins(-amount);
    return true;
  }

  /** Returns the record as it stood before this clear; `prevStars` is null on a first clear. */
  recordClear(
    levelId: number, stars: number, moves: number,
  ): { isFirstClear: boolean; prevStars: number | null } {
    const key = String(levelId);
    const prev = this.data.levels[key];
    const isFirstClear = !prev;
    this.update((d) => {
      d.levels[key] = {
        stars: Math.max(stars, prev?.stars ?? 0),
        bestMoves: prev ? Math.min(prev.bestMoves, moves) : moves,
        clearedAt: Date.now(),
      };
    });
    return { isFirstClear, prevStars: prev ? prev.stars : null };
  }

  levelRecord(levelId: number): LevelRecord | undefined {
    return this.data.levels[String(levelId)];
  }

  /** Highest campaign level the player may enter: one past their furthest clear. */
  highestUnlocked(levelCount: number): number {
    let cleared = 0;
    for (const key of Object.keys(this.data.levels)) {
      const id = Number(key);
      if (Number.isFinite(id) && id <= levelCount && id > cleared) cleared = id;
    }
    return Math.min(levelCount, cleared + 1);
  }

  /** Campaign levels cleared (ids within the campaign only). */
  campaignCleared(levelCount: number): number {
    let n = 0;
    for (const key of Object.keys(this.data.levels)) {
      const id = Number(key);
      if (Number.isFinite(id) && id >= 1 && id <= levelCount) n += 1;
    }
    return n;
  }

  /** Stars earned on campaign levels only (endless stars are shown separately). */
  campaignStars(levelCount: number): number {
    let sum = 0;
    for (const [key, r] of Object.entries(this.data.levels)) {
      const id = Number(key);
      if (Number.isFinite(id) && id >= 1 && id <= levelCount) sum += r.stars;
    }
    return sum;
  }

  /** Endless levels cleared (ids past the campaign). */
  endlessCleared(levelCount: number): number {
    let n = 0;
    for (const key of Object.keys(this.data.levels)) {
      const id = Number(key);
      if (Number.isFinite(id) && id > levelCount) n += 1;
    }
    return n;
  }

  /** The next endless level to play: one past the furthest endless clear. */
  nextEndlessId(levelCount: number): number {
    let furthest = levelCount;
    for (const key of Object.keys(this.data.levels)) {
      const id = Number(key);
      if (Number.isFinite(id) && id > furthest) furthest = id;
    }
    return furthest + 1;
  }

  get totalStars(): number {
    return Object.values(this.data.levels).reduce((sum, r) => sum + r.stars, 0);
  }

  // ------------------------------------------------------------------ stats
  bumpStat(key: keyof LifetimeStats, delta = 1): void {
    this.update((d) => {
      d.stats[key] += delta;
    });
  }

  recordWinForStreak(): void {
    this.update((d) => {
      d.stats.streak += 1;
      d.stats.bestStreak = Math.max(d.stats.bestStreak, d.stats.streak);
    });
  }

  breakStreak(): void {
    this.update((d) => {
      d.stats.streak = 0;
    });
  }

  // ------------------------------------------------------------- inventory
  inventoryCount(id: keyof Inventory): number {
    return this.data.inventory[id] ?? 0;
  }

  addInventory(id: keyof Inventory, count: number): void {
    this.update((d) => {
      d.inventory[id] = Math.max(0, (d.inventory[id] ?? 0) + count);
    });
  }

  /** Returns false (and changes nothing) if none are owned. */
  tryUseInventory(id: keyof Inventory): boolean {
    if (this.inventoryCount(id) <= 0) return false;
    this.addInventory(id, -1);
    return true;
  }

  // ------------------------------------------------------------------ lives
  /**
   * Regeneration is computed lazily against the wall clock, so hearts refill
   * while the app is closed without any background work.
   */
  private settleLives(): void {
    const l = this.data.lives;
    const now = Date.now();
    if (l.infiniteUntil && l.infiniteUntil <= now) {
      this.update((d) => {
        d.lives.infiniteUntil = 0;
      });
    }
    if (l.count >= LIVES_MAX || l.nextRegenAt === 0) return;
    let gained = 0;
    let next = l.nextRegenAt;
    while (next <= now && l.count + gained < LIVES_MAX) {
      gained += 1;
      next += LIVES_REGEN_MS;
    }
    if (gained === 0) return;
    this.update((d) => {
      d.lives.count = Math.min(LIVES_MAX, d.lives.count + gained);
      d.lives.nextRegenAt = d.lives.count >= LIVES_MAX ? 0 : next;
    });
  }

  get lives(): Readonly<LivesState> {
    this.settleLives();
    return this.data.lives;
  }

  get hasInfiniteLives(): boolean {
    return this.lives.infiniteUntil > Date.now();
  }

  get canPlay(): boolean {
    return this.hasInfiniteLives || this.lives.count > 0;
  }

  /** No-op while an unlimited-hearts boost is active. */
  loseLife(): void {
    if (this.hasInfiniteLives) return;
    this.settleLives();
    this.update((d) => {
      if (d.lives.count <= 0) return;
      d.lives.count -= 1;
      if (d.lives.nextRegenAt === 0) d.lives.nextRegenAt = Date.now() + LIVES_REGEN_MS;
    });
  }

  refillLives(): void {
    this.update((d) => {
      d.lives.count = LIVES_MAX;
      d.lives.nextRegenAt = 0;
    });
  }

  addInfiniteLives(hours: number): void {
    this.update((d) => {
      const base = Math.max(Date.now(), d.lives.infiniteUntil);
      d.lives.infiniteUntil = base + hours * 3_600_000;
      // Hearts should read "full" underneath the boost, not tick down to zero.
      d.lives.count = LIVES_MAX;
      d.lives.nextRegenAt = 0;
    });
  }
}
