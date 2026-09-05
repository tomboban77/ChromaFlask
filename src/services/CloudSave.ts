/**
 * Cloud save: back the whole local save up to the player's platform account
 * and restore it on a new device. No server of ours - the storage is the
 * platform's (Play Games saved games on Android, iCloud on iOS), reached
 * through a native bridge; on the plain web there is no cloud and the
 * feature simply reports itself unavailable.
 *
 * The save is small (a few KB of JSON), so the unit of sync is the entire
 * SaveData blob plus a timestamp and a device label. Conflicts are resolved
 * by *progress*, never by clock: the save with more levels cleared (then
 * more stars, then more play) is the one worth keeping, and when the cloud
 * copy is ahead of a device that already has real progress, the player
 * decides. A device with essentially no progress restores silently.
 */
import type { SaveData, SaveService } from './SaveService';

export interface CloudSnapshot {
  /** Serialized SaveData. */
  data: string;
  /** Epoch ms when the device wrote it. */
  updatedAt: number;
  /** Human label of the device that wrote it ("Pixel 8", "iPhone"). */
  device: string;
}

export interface CloudSaveDriver {
  readonly id: 'none' | 'simulated' | 'native';
  /** Whether this platform can cloud-save at all. */
  isAvailable(): Promise<boolean>;
  /** Account already signed in from an earlier session, if any. */
  currentAccount(): Promise<string | null>;
  /** Interactive sign-in. Resolves the account label, or null if the player backed out. */
  signIn(): Promise<string | null>;
  load(): Promise<CloudSnapshot | null>;
  store(snapshot: CloudSnapshot): Promise<void>;
  signOut(): Promise<void>;
}

// ------------------------------------------------------------------ drivers
/** Plain web: nothing to sync to. */
export class NoCloudDriver implements CloudSaveDriver {
  readonly id = 'none';
  async isAvailable(): Promise<boolean> { return false; }
  async currentAccount(): Promise<string | null> { return null; }
  async signIn(): Promise<string | null> { return null; }
  async load(): Promise<CloudSnapshot | null> { return null; }
  async store(): Promise<void> { /* nowhere to store */ }
  async signOut(): Promise<void> { /* nothing signed in */ }
}

/**
 * Development stand-in: "the cloud" is a second localStorage slot on the same
 * browser, which is exactly enough to exercise every sync path (sign-in,
 * upload, conflict, restore) in the smoke test without any platform account.
 * Selected in dev builds or with `?cloud=sim`; never in a release.
 */
export class SimulatedCloudDriver implements CloudSaveDriver {
  readonly id = 'simulated';
  private static readonly ACCOUNT = 'chromaflask.cloud.sim.account';
  private static readonly SNAPSHOT = 'chromaflask.cloud.sim.snapshot';

  async isAvailable(): Promise<boolean> { return true; }
  async currentAccount(): Promise<string | null> {
    return window.localStorage.getItem(SimulatedCloudDriver.ACCOUNT);
  }
  async signIn(): Promise<string | null> {
    const account = 'tester@cloud.sim';
    window.localStorage.setItem(SimulatedCloudDriver.ACCOUNT, account);
    return account;
  }
  async load(): Promise<CloudSnapshot | null> {
    const raw = window.localStorage.getItem(SimulatedCloudDriver.SNAPSHOT);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CloudSnapshot;
    } catch {
      return null;
    }
  }
  async store(snapshot: CloudSnapshot): Promise<void> {
    window.localStorage.setItem(SimulatedCloudDriver.SNAPSHOT, JSON.stringify(snapshot));
  }
  async signOut(): Promise<void> {
    window.localStorage.removeItem(SimulatedCloudDriver.ACCOUNT);
  }
}

/**
 * The native wrapper's Capacitor plugin. Method contract (see
 * docs/CLOUD-SAVE.md and native/capacitor-cloudsave):
 *   isAvailable()           -> { available: boolean }
 *   currentAccount()        -> { account: string | null }
 *   signIn()                -> { account: string | null }
 *   load()                  -> { data: string | null, updatedAt: number, device: string }
 *   store({ data, updatedAt, device }) -> void
 *   signOut()               -> void
 * Any thrown error is treated as "not available right now" by the service.
 */
interface CloudSavePlugin {
  isAvailable(): Promise<{ available: boolean }>;
  currentAccount(): Promise<{ account: string | null }>;
  signIn(): Promise<{ account: string | null }>;
  load(): Promise<{ data: string | null; updatedAt: number; device: string }>;
  store(snapshot: CloudSnapshot): Promise<void>;
  signOut(): Promise<void>;
}

function nativePlugin(): CloudSavePlugin | null {
  const cap = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const plugin = cap?.Plugins?.CloudSave as CloudSavePlugin | undefined;
  return plugin && typeof plugin.isAvailable === 'function' ? plugin : null;
}

export class NativeCloudDriver implements CloudSaveDriver {
  readonly id = 'native';
  constructor(private readonly plugin: CloudSavePlugin) {}
  async isAvailable(): Promise<boolean> {
    try {
      return (await this.plugin.isAvailable()).available;
    } catch {
      return false;
    }
  }
  async currentAccount(): Promise<string | null> {
    return (await this.plugin.currentAccount()).account;
  }
  async signIn(): Promise<string | null> {
    return (await this.plugin.signIn()).account;
  }
  async load(): Promise<CloudSnapshot | null> {
    const r = await this.plugin.load();
    return r.data ? { data: r.data, updatedAt: r.updatedAt, device: r.device } : null;
  }
  store(snapshot: CloudSnapshot): Promise<void> {
    return this.plugin.store(snapshot);
  }
  signOut(): Promise<void> {
    return this.plugin.signOut();
  }
}

/** Native bridge when the wrapper provides one; the simulator in dev or on request; else none. */
export function pickCloudDriver(): CloudSaveDriver {
  const plugin = nativePlugin();
  if (plugin) return new NativeCloudDriver(plugin);
  const wantSim = new URLSearchParams(window.location.search).get('cloud') === 'sim';
  if (wantSim || import.meta.env.DEV) return new SimulatedCloudDriver();
  return new NoCloudDriver();
}

// ------------------------------------------------------------------ progress
export interface ProgressSummary {
  /** Highest campaign level reached (cleared + 1, capped). */
  level: number;
  cleared: number;
  stars: number;
  coins: number;
  pours: number;
  updatedAt: number;
  device: string;
}

/**
 * Total order over saves for conflict resolution: clears, then stars, then
 * pours (real play), then recency. Coins are deliberately not part of it -
 * spending is not regress.
 */
export function progressScore(s: ProgressSummary): number {
  return s.cleared * 1_000_000 + s.stars * 1_000 + Math.min(999, s.pours);
}

export function summarize(data: SaveData, updatedAt: number, device: string): ProgressSummary {
  let cleared = 0;
  let stars = 0;
  let highest = 0;
  for (const [key, rec] of Object.entries(data.levels)) {
    const id = Number(key);
    if (!Number.isFinite(id)) continue;
    cleared += 1;
    stars += rec.stars;
    if (id > highest && id < 1_000_000) highest = id;
  }
  // A skipped level unlocks the next one just like a clear does.
  for (const id of data.skipped ?? []) {
    if (id > highest && id < 1_000_000) highest = id;
  }
  return {
    level: highest + 1,
    cleared,
    stars,
    coins: data.coins,
    pours: data.stats.pours,
    updatedAt,
    device,
  };
}

/** A save with nothing worth keeping restores silently instead of asking. */
export function isFreshSave(s: ProgressSummary): boolean {
  return s.cleared === 0 && s.pours < 10;
}

// ------------------------------------------------------------------ service
export type SyncReason = 'boot' | 'signin' | 'manual' | 'auto';

export type SyncOutcome =
  | { action: 'unavailable' }
  | { action: 'signed-out' }
  | { action: 'uploaded' }
  | { action: 'restored'; cloud: ProgressSummary }
  | { action: 'conflict'; cloud: ProgressSummary; local: ProgressSummary }
  | { action: 'noop' }
  | { action: 'failed'; message: string };

export interface CloudState {
  available: boolean;
  account: string | null;
  lastSyncAt: number;
  lastError: string | null;
  busy: boolean;
}

const META_KEY = 'chromaflask.cloud.meta';

export class CloudSaveService {
  readonly state: CloudState = { available: false, account: null, lastSyncAt: 0, lastError: null, busy: false };
  /** UI hook: called whenever `state` changes. */
  onChange: (() => void) | null = null;
  /** Called when a sync finds the cloud ahead of real local progress. */
  onConflict: ((cloud: ProgressSummary, local: ProgressSummary) => void) | null = null;

  private uploadTimer: number | null = null;
  /** True while a restore is writing the local save, so its flush does not bounce back up. */
  private restoring = false;
  /**
   * Set by a deliberate "Reset progress" and cleared by the player's next
   * cloud decision. While set, nothing uploads on its own (a reset must never
   * silently erase the cloud copy) and the next sync asks which copy to keep
   * instead of silently restoring what the player just erased.
   */
  private resetPending = false;

  constructor(
    private readonly save: SaveService,
    readonly driver: CloudSaveDriver,
    private readonly device: string,
  ) {
    try {
      const meta = JSON.parse(window.localStorage.getItem(META_KEY) ?? '{}') as {
        lastSyncAt?: number; resetPending?: boolean;
      };
      if (typeof meta.lastSyncAt === 'number') this.state.lastSyncAt = meta.lastSyncAt;
      this.resetPending = meta.resetPending === true;
    } catch {
      /* no meta yet */
    }
    // Every local save that reaches disk is a candidate for the cloud.
    this.save.onFlush = () => {
      if (!this.restoring) this.scheduleUpload();
    };
  }

  get signedIn(): boolean {
    return this.state.available && this.state.account !== null;
  }

  /** Probe the platform and, if an account is already signed in, sync at once. */
  async init(): Promise<SyncOutcome> {
    this.state.available = await this.driver.isAvailable();
    if (!this.state.available) return this.emit({ action: 'unavailable' });
    try {
      this.state.account = await this.driver.currentAccount();
    } catch {
      this.state.account = null;
    }
    this.emit();
    if (!this.state.account) return { action: 'signed-out' };
    return this.sync('boot');
  }

  async signIn(): Promise<SyncOutcome> {
    if (!this.state.available) return { action: 'unavailable' };
    this.setBusy(true);
    try {
      this.state.account = await this.driver.signIn();
    } catch (err) {
      return this.fail(err);
    } finally {
      this.setBusy(false);
    }
    if (!this.state.account) return this.emit({ action: 'signed-out' });
    return this.sync('signin');
  }

  async signOut(): Promise<void> {
    try {
      await this.driver.signOut();
    } finally {
      this.state.account = null;
      this.emit();
    }
  }

  /**
   * Compare cloud and local, then act: upload when local is at least as far
   * along, restore silently when this device is fresh, otherwise report a
   * conflict for the player to settle.
   */
  async sync(reason: SyncReason): Promise<SyncOutcome> {
    if (!this.signedIn) return { action: this.state.available ? 'signed-out' : 'unavailable' };
    this.setBusy(true);
    try {
      const cloud = await this.driver.load();
      const localData = this.save.snapshot;
      const local = summarize(localData, Date.now(), this.device);
      if (!cloud) {
        await this.upload();
        return this.emit({ action: 'uploaded' });
      }
      const cloudData = this.parse(cloud.data);
      if (!cloudData) {
        // Unreadable cloud copy: ours is the only good one.
        await this.upload();
        return this.emit({ action: 'uploaded' });
      }
      const remote = summarize(cloudData, cloud.updatedAt, cloud.device);
      const remoteScore = progressScore(remote);
      const localScore = progressScore(local);
      if (remoteScore > localScore) {
        // A brand-new device restores silently; a device the player just
        // reset on purpose is asked, or the reset would be undone unseen.
        if (isFreshSave(local) && !this.resetPending) {
          this.applyRestore(cloudData);
          return this.emit({ action: 'restored', cloud: remote });
        }
        this.emit();
        this.onConflict?.(remote, local);
        return { action: 'conflict', cloud: remote, local };
      }
      if (this.resetPending) {
        // Local is fresh by choice and the cloud is no further along: nothing
        // to protect any more. Let the reset stand and resume normal syncing.
        this.setResetPending(false);
      }
      if (remoteScore < localScore || cloud.data !== this.save.exportJson()) {
        await this.upload();
        return this.emit({ action: 'uploaded' });
      }
      this.touch();
      return this.emit({ action: 'noop' });
    } catch (err) {
      return this.fail(err);
    } finally {
      void reason;
      this.setBusy(false);
    }
  }

  /** The player chose the cloud copy in a conflict. */
  async restoreFromCloud(): Promise<SyncOutcome> {
    if (!this.signedIn) return { action: 'signed-out' };
    this.setBusy(true);
    try {
      const cloud = await this.driver.load();
      const data = cloud ? this.parse(cloud.data) : null;
      if (!cloud || !data) return this.fail(new Error('cloud save missing'));
      this.applyRestore(data);
      return this.emit({ action: 'restored', cloud: summarize(data, cloud.updatedAt, cloud.device) });
    } catch (err) {
      return this.fail(err);
    } finally {
      this.setBusy(false);
    }
  }

  /** The player chose this device in a conflict: the local save overwrites the cloud. */
  async keepLocal(): Promise<SyncOutcome> {
    if (!this.signedIn) return { action: 'signed-out' };
    this.setBusy(true);
    try {
      await this.upload();
      return this.emit({ action: 'uploaded' });
    } catch (err) {
      return this.fail(err);
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * "Reset progress" is about to wipe the local save: hold all automatic
   * uploads until the player has decided what happens to the cloud copy.
   */
  markLocalReset(): void {
    if (this.uploadTimer !== null) {
      window.clearTimeout(this.uploadTimer);
      this.uploadTimer = null;
    }
    this.setResetPending(true);
  }

  /** Debounced upload after local changes; quiet on failure (the next change retries). */
  scheduleUpload(delayMs = 4000): void {
    if (!this.signedIn || this.resetPending) return;
    if (this.uploadTimer !== null) window.clearTimeout(this.uploadTimer);
    this.uploadTimer = window.setTimeout(() => {
      this.uploadTimer = null;
      this.upload()
        .then(() => this.emit())
        .catch((err) => this.fail(err));
    }, delayMs);
  }

  /** Flush any pending debounced upload now (page hide, sign out). */
  async flushUpload(): Promise<void> {
    if (this.uploadTimer === null || !this.signedIn || this.resetPending) return;
    window.clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    try {
      await this.upload();
      this.emit();
    } catch (err) {
      this.fail(err);
    }
  }

  // -------------------------------------------------------------- internals
  /** Explicit uploads (sync, keepLocal) are the player's decision and end a pending reset. */
  private async upload(): Promise<void> {
    await this.driver.store({ data: this.save.exportJson(), updatedAt: Date.now(), device: this.device });
    this.setResetPending(false);
    this.touch();
  }

  private applyRestore(data: SaveData): void {
    this.restoring = true;
    try {
      this.save.replaceFromCloud(data);
    } finally {
      this.restoring = false;
    }
    this.setResetPending(false);
    this.touch();
  }

  private setResetPending(value: boolean): void {
    this.resetPending = value;
    this.writeMeta();
  }

  private writeMeta(): void {
    try {
      window.localStorage.setItem(
        META_KEY,
        JSON.stringify({ lastSyncAt: this.state.lastSyncAt, resetPending: this.resetPending }),
      );
    } catch {
      /* private mode: the meta is cosmetic */
    }
  }

  private parse(raw: string): SaveData | null {
    try {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      return parsed && typeof parsed === 'object' && parsed.levels ? (parsed as SaveData) : null;
    } catch {
      return null;
    }
  }

  private touch(): void {
    this.state.lastSyncAt = Date.now();
    this.state.lastError = null;
    this.writeMeta();
  }

  private setBusy(busy: boolean): void {
    this.state.busy = busy;
    this.emit();
  }

  private fail(err: unknown): SyncOutcome {
    const message = err instanceof Error ? err.message : String(err);
    this.state.lastError = message;
    console.warn('[cloud] sync failed', err);
    return this.emit({ action: 'failed', message });
  }

  private emit<T extends SyncOutcome | undefined>(outcome?: T): T {
    this.onChange?.();
    return outcome as T;
  }
}

/** Short, non-identifying device label for the "which copy" dialog. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) {
    const m = /Android [^;]+; ([^)]+?)(?: Build|\))/.exec(ua);
    return m?.[1]?.trim() || 'Android';
  }
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Web';
}
