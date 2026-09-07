import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native wrapper for both stores (see docs/NATIVE-BUILD.md).
 *
 * appId is permanent once an app is published: it is the Play package name
 * and the iOS bundle identifier. Confirm it before the first store upload.
 *
 * The web assets come from `npm run build:native` (Vite `--mode native`),
 * which drops the meta CSP so the Capacitor bridge script can run and
 * disables the service worker; see vite.config.ts.
 */
const config: CapacitorConfig = {
  appId: 'com.prismpotions.app',
  appName: 'Prism Potions',
  webDir: 'dist',
  backgroundColor: '#0a0e2a',
  android: {
    allowMixedContent: false,
  },
  ios: {
    // The web view itself never rubber-bands; the map, shop and dialogs
    // scroll internally (docs/STORE-RELEASE.md).
    scrollEnabled: false,
    contentInset: 'never',
  },
};

export default config;
