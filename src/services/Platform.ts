/**
 * Where the game is running. One question, answered once, so no other module
 * has to sniff globals:
 *
 *  - `platform()`  - 'android' | 'ios' inside the Capacitor wrapper (the
 *                    native bridge injects `window.Capacitor`), else 'web'.
 *  - `BUILD_TARGET` - which bundle this is. `npm run build:native` runs Vite
 *                    with `--mode native`, which drops the meta CSP (the
 *                    Android bridge is an inline script) and skips the
 *                    service worker. Everything else is the 'web' bundle.
 *
 * The two are deliberately separate: a native bundle opened in a browser is
 * still 'web' at runtime and must behave like it.
 */
export type Platform = 'web' | 'android' | 'ios';
export type BuildTarget = 'web' | 'native';

interface CapacitorGlobal {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

/** The runtime injected by the native bridge, if any. */
export function capacitorGlobal(): CapacitorGlobal | null {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap && typeof cap === 'object' ? cap : null;
}

export function platform(): Platform {
  const cap = capacitorGlobal();
  if (!cap?.isNativePlatform?.()) return 'web';
  const p = cap.getPlatform?.();
  return p === 'android' || p === 'ios' ? p : 'web';
}

export function isNativeApp(): boolean {
  return platform() !== 'web';
}

export const BUILD_TARGET: BuildTarget = import.meta.env.MODE === 'native' ? 'native' : 'web';
