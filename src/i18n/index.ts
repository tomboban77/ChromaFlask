/**
 * Localisation runtime.
 *
 * `en` is the source of truth and the fallback; every other language is a
 * partial table loaded on demand (code-split by Vite), so a player downloads
 * only their own. Keys are flat, dotted strings; `{name}` placeholders are
 * interpolated; plural forms live under `key.one` / `key.few` / `key.many` /
 * `key.other` and are chosen with Intl.PluralRules for the active locale, so
 * Russian's four forms and Japanese's single form are both right without the
 * app code knowing.
 *
 * Level and chapter names are stylised proper nouns and deliberately stay in
 * English in every language.
 */
import { en, type MessageKey } from './en';

export type { MessageKey };
export type Params = Record<string, string | number>;
type Table = Partial<Record<string, string>>;

/** Languages the game ships. Native names, for the picker. */
export const SUPPORTED_LOCALES: readonly { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ru', name: 'Русский' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '简体中文' },
];

const loaders: Record<string, () => Promise<{ default: Table }>> = {
  es: () => import('./locales/es'),
  pt: () => import('./locales/pt'),
  fr: () => import('./locales/fr'),
  de: () => import('./locales/de'),
  it: () => import('./locales/it'),
  tr: () => import('./locales/tr'),
  id: () => import('./locales/id'),
  ru: () => import('./locales/ru'),
  hi: () => import('./locales/hi'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
  zh: () => import('./locales/zh'),
};

let locale = 'en';
let table: Table = {};
let plurals = new Intl.PluralRules('en');

/**
 * Pick the best shipped language for a preference ('auto' or a code) and the
 * browser's language list. Matches on the primary subtag, so 'pt-BR' -> 'pt'.
 */
export function resolveLocale(pref: string, navLangs: readonly string[]): string {
  const known = new Set(SUPPORTED_LOCALES.map((l) => l.code));
  if (pref !== 'auto' && known.has(pref)) return pref;
  for (const lang of navLangs) {
    const primary = lang.toLowerCase().split('-')[0] ?? '';
    if (known.has(primary)) return primary;
  }
  return 'en';
}

/** Load and activate a language. Falls back to English if the table fails to load. */
export async function setLocale(code: string): Promise<void> {
  if (code === 'en' || !loaders[code]) {
    locale = 'en';
    table = {};
  } else {
    try {
      table = (await loaders[code]()).default;
      locale = code;
    } catch (err) {
      console.warn(`[i18n] could not load ${code}; using English`, err);
      locale = 'en';
      table = {};
    }
  }
  plurals = new Intl.PluralRules(locale);
  document.documentElement.lang = locale;
}

export function currentLocale(): string {
  return locale;
}

function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : typeof v === 'number' ? formatNumber(v) : v;
  });
}

/** Translate a key; falls back to English, then to the key itself (visible, never blank). */
export function t(key: MessageKey, params?: Params): string {
  const text = table[key] ?? en[key] ?? key;
  return interpolate(text, params);
}

/**
 * Plural-aware translation: picks `${key}.${category}` for `n` (falling back
 * to `.other`), and exposes `n` as `{n}`.
 */
export function tp(key: string, n: number, params?: Params): string {
  const category = plurals.select(n);
  const pick = (tbl: Table): string | undefined =>
    tbl[`${key}.${category}`] ?? tbl[`${key}.other`];
  const text = pick(table) ?? pick(en as unknown as Table) ?? `${key}.other`;
  return interpolate(text, { ...params, n });
}

export function formatNumber(n: number): string {
  return n.toLocaleString(locale);
}

/** e.g. "Friday, 5 September" in the active language. */
export function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

/**
 * Apply the static strings in index.html: elements carrying data-i18n get
 * their text, data-i18n-aria their aria-label, data-i18n-placeholder their
 * placeholder. Idempotent, so it can run again after a language change.
 */
export function applyStaticText(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n as MessageKey);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria as MessageKey));
  }
  for (const node of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder as MessageKey);
  }
}
