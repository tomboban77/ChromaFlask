/**
 * Advertising behind a swappable driver, like Payments and CloudSave.
 *
 * Two formats:
 *
 *  - Rewarded video: the player chooses to watch in exchange for something
 *    concrete - a heart when out of hearts, one more undo/hint/bottle when
 *    the stock is gone. Never shown unasked.
 *  - Interstitial: a full-screen break on leaving the win screen, gated by
 *    `shouldShowInterstitial` (not before a warm-up level, not too often,
 *    never on the daily or the tutorial, never for a player who has ever
 *    paid).
 *
 * Drivers:
 *  - NoAdsDriver        plain web / anything without an ad SDK
 *  - SimulatedAdsDriver `?ads=sim`: resolves after a short delay so every
 *                       flow can be exercised without an SDK or a device
 *  - AdMobDriver        the Capacitor wrapper (Google AdMob + UMP consent),
 *                       loaded on demand so the web bundle never carries it
 *
 * The service owns the policy and the bookkeeping (preloading, cooldowns,
 * the audio/render pause around a full-screen ad); drivers only load and show.
 */
import { isNativeApp, platform } from './Platform';

export type RewardPlacement = 'lives' | 'undo' | 'hint' | 'bottle';
export type RewardOutcome = 'rewarded' | 'dismissed' | 'unavailable' | 'failed';
export type InterstitialOutcome = 'shown' | 'skipped' | 'failed';

export interface AdsDriver {
  readonly name: 'none' | 'simulated' | 'admob';
  /**
   * One-time setup, including any consent flow the SDK requires. Resolves
   * whether ads can be requested at all on this device. Never rejects.
   */
  init(): Promise<boolean>;
  /** Fetch the next rewarded ad. Resolves whether one is now ready. */
  loadRewarded(): Promise<boolean>;
  /** Show the loaded rewarded ad; resolves once it is off the screen. */
  showRewarded(): Promise<RewardOutcome>;
  loadInterstitial(): Promise<boolean>;
  showInterstitial(): Promise<boolean>;
  /** EEA/UK: the law requires a way back to the consent choices. */
  privacyOptionsRequired(): boolean;
  showPrivacyOptions(): Promise<void>;
}

/** Live-tunable knobs (see RemoteConfig). */
export interface AdsConfig {
  /** First campaign level after which an interstitial may appear. */
  readonly firstInterstitialLevel: number;
  /** Show at most one interstitial per this many eligible wins. */
  readonly interstitialEvery: number;
  /** Quiet period after any full-screen ad, rewarded or not. */
  readonly minGapSeconds: number;
  /** Hearts granted by the rewarded "watch for a heart" placement. */
  readonly rewardedLives: number;
}

export const DEFAULT_ADS: AdsConfig = {
  // The first chapter is the hook; do not interrupt it.
  firstInterstitialLevel: 8,
  // One break per three wins is the casual-puzzle norm; more reads as spam.
  interstitialEvery: 3,
  // Two rewarded ads in a row must not be followed by an interstitial.
  minGapSeconds: 180,
  rewardedLives: 1,
};

// ------------------------------------------------------------------- policy
export interface InterstitialContext {
  /** Level just won. */
  level: number;
  /** Eligible wins since the last interstitial (this one included). */
  winsSinceAd: number;
  secondsSinceAnyAd: number;
  /** Anyone who has ever made a real-money purchase gets no interstitials. */
  payer: boolean;
  /** False for the daily, the tutorial, or any other exempt context. */
  eligible: boolean;
  cfg: AdsConfig;
}

/** Pure, so the rule is unit-testable and readable in one place. */
export function shouldShowInterstitial(c: InterstitialContext): boolean {
  if (!c.eligible || c.payer) return false;
  if (c.level < c.cfg.firstInterstitialLevel) return false;
  if (c.winsSinceAd < c.cfg.interstitialEvery) return false;
  return c.secondsSinceAnyAd >= c.cfg.minGapSeconds;
}

// ------------------------------------------------------------------ drivers
export class NoAdsDriver implements AdsDriver {
  readonly name = 'none';
  async init(): Promise<boolean> { return false; }
  async loadRewarded(): Promise<boolean> { return false; }
  async showRewarded(): Promise<RewardOutcome> { return 'unavailable'; }
  async loadInterstitial(): Promise<boolean> { return false; }
  async showInterstitial(): Promise<boolean> { return false; }
  privacyOptionsRequired(): boolean { return false; }
  async showPrivacyOptions(): Promise<void> { /* nothing to show */ }
}

/**
 * Stand-in for development and the smoke test (`?ads=sim`). "Watching" is a
 * short delay; every show succeeds. `?ads=sim-fail` makes loads fail, to
 * exercise the unavailable paths.
 */
export class SimulatedAdsDriver implements AdsDriver {
  readonly name = 'simulated';
  constructor(private readonly failLoads = false) {}
  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
  async init(): Promise<boolean> { return true; }
  async loadRewarded(): Promise<boolean> { await this.wait(150); return !this.failLoads; }
  async showRewarded(): Promise<RewardOutcome> { await this.wait(1200); return 'rewarded'; }
  async loadInterstitial(): Promise<boolean> { await this.wait(150); return !this.failLoads; }
  async showInterstitial(): Promise<boolean> { await this.wait(800); return true; }
  privacyOptionsRequired(): boolean { return true; }
  async showPrivacyOptions(): Promise<void> { await this.wait(300); }
}

/**
 * AdMob ad units. Google's public sample units are used until the real ones
 * exist; test mode switches itself off the moment they are replaced. Create
 * the app and units in the AdMob console and paste the unit ids here AND the
 * app ids into the native projects (see docs/NATIVE-BUILD.md):
 *   android/app/src/main/res/values/strings.xml  -> admob_app_id
 *   ios/App/App/Info.plist                        -> GADApplicationIdentifier
 */
export const AD_UNITS = {
  android: {
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
  },
  ios: {
    rewarded: 'ca-app-pub-3940256099942544/1712485313',
    interstitial: 'ca-app-pub-3940256099942544/4411468910',
  },
} as const;

const GOOGLE_SAMPLE_PUBLISHER = 'ca-app-pub-3940256099942544/';

/** Loaded on demand: the web bundle never carries the SDK wrapper. */
const loadAdMob = () => import('@capacitor-community/admob');
type AdMobModule = Awaited<ReturnType<typeof loadAdMob>>;

/**
 * Google AdMob through @capacitor-community/admob. Consent first (UMP shows
 * the GDPR form where the law requires it, then iOS's tracking prompt if the
 * form did not already trigger it), then the SDK, then one ad of each kind is
 * kept preloaded so a tap on "watch" is answered in seconds, not after a
 * network round trip.
 */
export class AdMobDriver implements AdsDriver {
  readonly name = 'admob';
  private mod: AdMobModule | null = null;
  private privacyRequired = false;
  private readonly units = platform() === 'ios' ? AD_UNITS.ios : AD_UNITS.android;
  private readonly testing =
    import.meta.env.DEV || this.units.rewarded.startsWith(GOOGLE_SAMPLE_PUBLISHER);

  async init(): Promise<boolean> {
    if (!isNativeApp()) return false;
    try {
      this.mod = await loadAdMob();
      const { AdMob, AdmobConsentStatus, MaxAdContentRating } = this.mod;

      let consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        consent = await AdMob.showConsentForm();
      }
      // The plugin does not re-export its PrivacyOptionsRequirementStatus
      // enum; its values are the plain strings NOT_REQUIRED | REQUIRED | UNKNOWN.
      this.privacyRequired = String(consent.privacyOptionsRequirementStatus) === 'REQUIRED';

      if (platform() === 'ios') {
        // If the UMP message carried the IDFA explainer this is already
        // decided and the call is a no-op; otherwise ask now, before any ad.
        const { status } = await AdMob.trackingAuthorizationStatus();
        if (status === 'notDetermined') await AdMob.requestTrackingAuthorization();
      }

      await AdMob.initialize({
        initializeForTesting: this.testing,
        // A puzzle for everyone: no mature creatives, whatever the geography.
        maxAdContentRating: MaxAdContentRating.General,
      });
      return consent.canRequestAds;
    } catch (err) {
      console.warn('[ads] AdMob unavailable', err);
      return false;
    }
  }

  async loadRewarded(): Promise<boolean> {
    if (!this.mod) return false;
    try {
      await this.mod.AdMob.prepareRewardVideoAd({ adId: this.units.rewarded, isTesting: this.testing });
      return true;
    } catch {
      return false;
    }
  }

  async showRewarded(): Promise<RewardOutcome> {
    const mod = this.mod;
    if (!mod) return 'unavailable';
    const { AdMob, RewardAdPluginEvents: Ev } = mod;
    // The reward event arrives before dismissal; the promise from show()
    // alone cannot tell "watched" from "closed early", so listen for both.
    return new Promise<RewardOutcome>((resolve) => {
      let rewarded = false;
      let settled = false;
      const handles: Promise<{ remove: () => Promise<void> }>[] = [];
      const finish = (outcome: RewardOutcome) => {
        if (settled) return;
        settled = true;
        for (const h of handles) void h.then((x) => x.remove()).catch(() => undefined);
        resolve(outcome);
      };
      handles.push(AdMob.addListener(Ev.Rewarded, () => { rewarded = true; }));
      handles.push(AdMob.addListener(Ev.Dismissed, () => finish(rewarded ? 'rewarded' : 'dismissed')));
      handles.push(AdMob.addListener(Ev.FailedToShow, () => finish('failed')));
      AdMob.showRewardVideoAd().catch(() => finish('failed'));
    });
  }

  async loadInterstitial(): Promise<boolean> {
    if (!this.mod) return false;
    try {
      await this.mod.AdMob.prepareInterstitial({ adId: this.units.interstitial, isTesting: this.testing });
      return true;
    } catch {
      return false;
    }
  }

  async showInterstitial(): Promise<boolean> {
    const mod = this.mod;
    if (!mod) return false;
    const { AdMob, InterstitialAdPluginEvents: Ev } = mod;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const handles: Promise<{ remove: () => Promise<void> }>[] = [];
      const finish = (shown: boolean) => {
        if (settled) return;
        settled = true;
        for (const h of handles) void h.then((x) => x.remove()).catch(() => undefined);
        resolve(shown);
      };
      handles.push(AdMob.addListener(Ev.Dismissed, () => finish(true)));
      handles.push(AdMob.addListener(Ev.FailedToShow, () => finish(false)));
      AdMob.showInterstitial().catch(() => finish(false));
    });
  }

  privacyOptionsRequired(): boolean {
    return this.privacyRequired;
  }

  async showPrivacyOptions(): Promise<void> {
    if (!this.mod) return;
    try {
      await this.mod.AdMob.showPrivacyOptionsForm();
    } catch (err) {
      console.warn('[ads] privacy options form failed', err);
    }
  }
}

export function pickAdsDriver(): AdsDriver {
  const sim = new URLSearchParams(window.location.search).get('ads');
  if (sim === 'sim' || sim === 'sim-fail') return new SimulatedAdsDriver(sim === 'sim-fail');
  if (isNativeApp()) return new AdMobDriver();
  return new NoAdsDriver();
}

// ------------------------------------------------------------------ service
/** How long a tap on "watch" waits for an ad that was not preloaded. */
const LOAD_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

export class Ads {
  private ready = false;
  private rewardedLoaded = false;
  private interstitialLoaded = false;
  private showing = false;
  private lastAdAt = 0;
  private winsSinceAd = 0;

  /** A full-screen ad is about to cover the game: silence audio, stop rendering. */
  onAdStart: (() => void) | null = null;
  /** The ad is gone. */
  onAdEnd: (() => void) | null = null;

  constructor(private readonly driver: AdsDriver = new NoAdsDriver()) {}

  /** Off the boot path; the game never waits for an ad SDK. */
  async init(): Promise<void> {
    try {
      this.ready = await this.driver.init();
    } catch {
      this.ready = false;
    }
    if (this.ready) {
      void this.preloadRewarded();
      void this.preloadInterstitial();
    }
  }

  /** Whether "watch an ad" buttons should exist at all. */
  get available(): boolean {
    return this.ready;
  }

  get driverName(): string {
    return this.driver.name;
  }

  get privacyOptionsRequired(): boolean {
    return this.ready && this.driver.privacyOptionsRequired();
  }

  showPrivacyOptions(): Promise<void> {
    return this.driver.showPrivacyOptions();
  }

  private async preloadRewarded(): Promise<void> {
    if (this.rewardedLoaded) return;
    this.rewardedLoaded = await this.driver.loadRewarded().catch(() => false);
  }

  private async preloadInterstitial(): Promise<void> {
    if (this.interstitialLoaded) return;
    this.interstitialLoaded = await this.driver.loadInterstitial().catch(() => false);
  }

  /**
   * Player-initiated. Resolves once the ad is off the screen; 'rewarded' is
   * the only outcome that grants anything.
   */
  async showRewarded(_placement: RewardPlacement): Promise<RewardOutcome> {
    if (!this.ready || this.showing) return 'unavailable';
    if (!this.rewardedLoaded) {
      this.rewardedLoaded = await withTimeout(this.driver.loadRewarded(), LOAD_TIMEOUT_MS, false);
      if (!this.rewardedLoaded) return 'unavailable';
    }
    this.showing = true;
    this.onAdStart?.();
    let outcome: RewardOutcome;
    try {
      outcome = await this.driver.showRewarded();
    } catch {
      outcome = 'failed';
    } finally {
      this.rewardedLoaded = false;
      this.showing = false;
      this.onAdEnd?.();
    }
    this.lastAdAt = Date.now();
    void this.preloadRewarded();
    return outcome;
  }

  /**
   * The interstitial gate on leaving a win screen. Counts the win, decides
   * per `shouldShowInterstitial`, and resolves after the ad closes so the
   * caller can continue into the next level. Never waits on a load: an ad
   * that is not already sitting there is skipped, not fetched.
   */
  async maybeShowInterstitial(
    ctx: Omit<InterstitialContext, 'winsSinceAd' | 'secondsSinceAnyAd'>,
  ): Promise<InterstitialOutcome> {
    if (!this.ready || this.showing || !ctx.eligible) return 'skipped';
    this.winsSinceAd += 1;
    const due = shouldShowInterstitial({
      ...ctx,
      winsSinceAd: this.winsSinceAd,
      secondsSinceAnyAd: (Date.now() - this.lastAdAt) / 1000,
    });
    if (!due) return 'skipped';
    if (!this.interstitialLoaded) {
      void this.preloadInterstitial();
      return 'skipped';
    }
    this.showing = true;
    this.onAdStart?.();
    let shown: boolean;
    try {
      shown = await this.driver.showInterstitial();
    } catch {
      shown = false;
    } finally {
      this.interstitialLoaded = false;
      this.showing = false;
      this.onAdEnd?.();
    }
    this.lastAdAt = Date.now();
    this.winsSinceAd = 0;
    void this.preloadInterstitial();
    return shown ? 'shown' : 'failed';
  }
}
