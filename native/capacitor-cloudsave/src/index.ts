import { registerPlugin } from '@capacitor/core';
import type { CloudSavePlugin } from './definitions';

/**
 * Registered under the name the game looks for on `Capacitor.Plugins.CloudSave`.
 * On the web the fallback implementation reports "not available".
 */
export const CloudSave = registerPlugin<CloudSavePlugin>('CloudSave', {
  web: () => import('./web').then((m) => new m.CloudSaveWeb()),
});

export * from './definitions';
