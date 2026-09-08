import { WebPlugin } from '@capacitor/core';
import type { CloudSavePlugin, CloudSnapshot } from './definitions';

/**
 * Plain web has no platform account: the game shows "Available in the Android
 * and iOS apps" for cloud save and hides the leaderboard button entirely.
 */
export class CloudSaveWeb extends WebPlugin implements CloudSavePlugin {
  async isAvailable(): Promise<{ available: boolean }> {
    return { available: false };
  }
  async currentAccount(): Promise<{ account: string | null }> {
    return { account: null };
  }
  async signIn(): Promise<{ account: string | null }> {
    return { account: null };
  }
  async load(): Promise<{ data: string | null; updatedAt: number; device: string }> {
    return { data: null, updatedAt: 0, device: 'Web' };
  }
  async store(_snapshot: CloudSnapshot): Promise<void> {
    throw this.unavailable('Cloud save is not available on the web.');
  }
  async signOut(): Promise<void> {
    /* nothing to sign out of */
  }

  async isLeaderboardAvailable(): Promise<{ available: boolean }> {
    return { available: false };
  }
  async submitLeaderboardScore(): Promise<void> {
    /* nowhere to post */
  }
  async showLeaderboard(): Promise<{ shown: boolean }> {
    return { shown: false };
  }
}
