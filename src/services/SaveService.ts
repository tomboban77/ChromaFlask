/**
 * Persistence behind a swappable driver.
 *
 * Call sites only ever see SaveService, so moving to a real backend later means
 * writing one new driver - not touching game code.
 */

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
}

export interface SaveData {
  version: number;
  profile: SaveProfile | null;
  coins: number;
  levels: Record<string, LevelRecord>;
  settings: GameSettings;
  tutorialDone: boolean;
}

export const SAVE_VERSION = 1;

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
    },
    tutorialDone: false,
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
  private data: SaveData;
  private flushHandle: number | null = null;

  constructor(startingCoins: number, driver: StorageDriver = pickDriver()) {
    this.driver = driver;
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
    };
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

  recordClear(levelId: number, stars: number, moves: number): { isFirstClear: boolean } {
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
    return { isFirstClear };
  }

  levelRecord(levelId: number): LevelRecord | undefined {
    return this.data.levels[String(levelId)];
  }

  /** Highest level the player may enter: one past their furthest clear. */
  highestUnlocked(levelCount: number): number {
    let cleared = 0;
    for (const key of Object.keys(this.data.levels)) {
      const id = Number(key);
      if (Number.isFinite(id) && id > cleared) cleared = id;
    }
    return Math.min(levelCount, cleared + 1);
  }

  get totalStars(): number {
    return Object.values(this.data.levels).reduce((sum, r) => sum + r.stars, 0);
  }
}
