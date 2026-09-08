/**
 * Funnel instrumentation. These are the events you actually need to tune a
 * casual puzzle: where players quit, which level walls them, what they spend on.
 */
export type AnalyticsEvent =
  | { type: 'app_start'; renderer: string }
  | { type: 'profile_created'; avatar: string }
  | { type: 'level_start'; level: number; attempt: number }
  | { type: 'level_complete'; level: number; moves: number; par: number; stars: number; seconds: number }
  | { type: 'chapter_complete'; chapter: number }
  | { type: 'daily_complete'; streak: number }
  | { type: 'daily_share'; stars: number; streak: number; method: 'share' | 'copy' }
  | { type: 'achievement'; id: string }
  | { type: 'login_reward'; day: number; coins: number }
  | { type: 'level_quit'; level: number; moves: number; seconds: number }
  | { type: 'level_stuck'; level: number; moves: number }
  | { type: 'level_skip'; level: number; moves: number; price: number }
  | { type: 'level_no_win'; level: number; moves: number }
  | { type: 'powerup_used'; level: number; powerup: string; paid: boolean }
  | { type: 'tutorial_step'; step: number }
  | { type: 'tutorial_done' }
  | { type: 'shop_open'; source: string }
  | { type: 'shop_coin_spend'; item: string; price: number }
  | { type: 'skin_equip'; skin: string }
  | { type: 'iap_start'; product: string }
  | { type: 'iap_result'; product: string; ok: boolean; reason?: string }
  | { type: 'iap_restored'; count: number }
  /** Uncaught error or rejection; also boot failures. Rate-limited per session. */
  | { type: 'client_error'; source: 'error' | 'unhandledrejection' | 'boot'; message: string;
      stack?: string; renderer?: string; level?: number; saveVersion: number }
  | { type: 'life_lost'; level: number; cause: 'quit' | 'failed' }
  | { type: 'out_of_lives'; level: number }
  | { type: 'support_email_open'; level: number }
  | { type: 'support_code_redeemed'; action: string }
  | { type: 'progress_reset'; source: 'settings' | 'support_code' }
  | { type: 'cloud_sync'; reason: 'boot' | 'signin' | 'manual' | 'choice'; result: string }
  /** Player asked to watch a rewarded ad; `outcome` is what the SDK reported. */
  | { type: 'ad_rewarded'; placement: string; outcome: string }
  /** Interstitial gate fired on leaving a win screen (skips are not tracked). */
  | { type: 'ad_interstitial'; level: number; outcome: 'shown' | 'failed' }
  /** The level-45 leaderboard unlock was shown for the first time. */
  | { type: 'leaderboard_unlocked'; level: number }
  /** Player opened the platform board; `outcome` is what the platform reported. */
  | { type: 'leaderboard_open'; outcome: string; stars: number };

export interface AnalyticsDriver {
  track(event: AnalyticsEvent): void;
}

/** Default driver: visible in dev, silent in production. */
export class ConsoleAnalyticsDriver implements AnalyticsDriver {
  track(event: AnalyticsEvent): void {
    if (import.meta.env.DEV) console.debug('[analytics]', event.type, event);
  }
}

/**
 * PostHog over its plain capture endpoint - no SDK, ~zero bundle cost.
 * Public client-side project token (US cloud, project 594724).
 */
export const POSTHOG_KEY = 'phc_pJdnjr6vMnZQozVsyY6hPQqrtB992zncabWKKVDSSazi';
export const POSTHOG_HOST = 'https://us.i.posthog.com';

export class PostHogDriver implements AnalyticsDriver {
  constructor(
    private readonly apiKey: string,
    /** Stable anonymous ID; the save's supportId, so support and funnel line up. */
    private readonly distinctId: string,
    /**
     * Player consent, read per event so the Settings toggle takes effect
     * immediately. Nothing leaves the device while this returns false.
     */
    private readonly enabled: () => boolean = () => true,
  ) {}

  track(event: AnalyticsEvent): void {
    if (!this.apiKey || !this.enabled()) return;
    const { type, ...properties } = event;
    const body = JSON.stringify({
      api_key: this.apiKey,
      event: type,
      distinct_id: this.distinctId,
      properties,
      timestamp: new Date().toISOString(),
    });
    // keepalive lets the final events of a session survive tab close.
    void fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* offline or blocked - gameplay is unaffected */
    });
  }
}

export class Analytics {
  private readonly drivers: AnalyticsDriver[];
  constructor(...drivers: AnalyticsDriver[]) {
    this.drivers = drivers.length ? drivers : [new ConsoleAnalyticsDriver()];
  }
  /** For drivers that need boot-time data (e.g. the save's supportId). */
  addDriver(driver: AnalyticsDriver): void {
    this.drivers.push(driver);
  }
  track(event: AnalyticsEvent): void {
    for (const d of this.drivers) {
      try {
        d.track(event);
      } catch {
        /* analytics must never break gameplay */
      }
    }
  }
}
