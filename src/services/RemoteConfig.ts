import { DEFAULT_ECONOMY, type EconomyConfig } from '@/core/progression';
import { DEFAULT_ADS, type AdsConfig } from './Ads';

/**
 * Live-tunable values. Served statically today; swap in a fetch driver to
 * retune the economy, difficulty or ad cadence without shipping a build.
 */
export interface RemoteValues {
  economy: EconomyConfig;
  /** Show the "need a hand?" nudge after this many moves past par. */
  strugglingThreshold: number;
  /** Interstitial cadence and rewarded-ad payouts (native builds only). */
  ads: AdsConfig;
}

const DEFAULTS: RemoteValues = {
  economy: DEFAULT_ECONOMY,
  strugglingThreshold: 12,
  ads: DEFAULT_ADS,
};

export interface RemoteConfigDriver {
  fetchValues(): Promise<Partial<RemoteValues>>;
}

class StaticRemoteConfigDriver implements RemoteConfigDriver {
  async fetchValues(): Promise<Partial<RemoteValues>> {
    return {};
  }
}

export class RemoteConfig {
  private values: RemoteValues = DEFAULTS;

  constructor(private readonly driver: RemoteConfigDriver = new StaticRemoteConfigDriver()) {}

  /** Never blocks boot: defaults apply until (and unless) the fetch lands. */
  async refresh(): Promise<void> {
    try {
      const remote = await this.driver.fetchValues();
      this.values = { ...DEFAULTS, ...remote };
    } catch {
      this.values = DEFAULTS;
    }
  }

  get current(): Readonly<RemoteValues> {
    return this.values;
  }
}
