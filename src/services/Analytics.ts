/**
 * Funnel instrumentation. These are the events you actually need to tune a
 * casual puzzle: where players quit, which level walls them, what they spend on.
 */
export type AnalyticsEvent =
  | { type: 'app_start'; renderer: string }
  | { type: 'profile_created'; avatar: string }
  | { type: 'level_start'; level: number; attempt: number }
  | { type: 'level_complete'; level: number; moves: number; par: number; stars: number; seconds: number }
  | { type: 'level_quit'; level: number; moves: number; seconds: number }
  | { type: 'level_stuck'; level: number; moves: number }
  | { type: 'powerup_used'; level: number; powerup: string; paid: boolean }
  | { type: 'tutorial_step'; step: number }
  | { type: 'tutorial_done' };

export interface AnalyticsDriver {
  track(event: AnalyticsEvent): void;
}

/** Default driver: visible in dev, silent in production. */
export class ConsoleAnalyticsDriver implements AnalyticsDriver {
  track(event: AnalyticsEvent): void {
    if (import.meta.env.DEV) console.debug('[analytics]', event.type, event);
  }
}

export class Analytics {
  private readonly drivers: AnalyticsDriver[];
  constructor(...drivers: AnalyticsDriver[]) {
    this.drivers = drivers.length ? drivers : [new ConsoleAnalyticsDriver()];
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
