// Key-parity check for the message tables. English (src/i18n/en.ts) is the
// source of truth; every locale under src/i18n/locales/ must
//   - define every base key English defines (plural suffixes collapse to one
//     base key, so a locale may carry more or fewer plural forms),
//   - define no key English lacks (a stale key would be dead text),
//   - carry the `.other` form for every plural English pluralises,
//   - use exactly the same `{placeholders}` as English in each string.
// Exit code 1 on any issue, so it can gate CI. Usage: npm run i18n:check
import { readFileSync, readdirSync } from 'node:fs';

const KEY_RE = /^\s*'([a-zA-Z0-9_.]+)':\s/gm;
const ENTRY_RE = /^\s*'([a-zA-Z0-9_.]+)':\s*(['"`])([\s\S]*?)\2,\s*$/gm;
const PLURAL_SUFFIX = /\.(one|few|many|other)$/;

const keysOf = (src) => [...src.matchAll(KEY_RE)].map((m) => m[1]);
const baseOf = (key) => key.replace(PLURAL_SUFFIX, '');
const placeholdersOf = (src) => {
  const out = new Map();
  for (const m of src.matchAll(ENTRY_RE)) {
    const names = [...m[3].matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
    out.set(m[1], names.join(','));
  }
  return out;
};

const enSrc = readFileSync('src/i18n/en.ts', 'utf8');
const enKeys = keysOf(enSrc);
const enBase = new Set(enKeys.map(baseOf));
const enPlaceholders = placeholdersOf(enSrc);
const enPlurals = new Set(enKeys.filter((k) => k.endsWith('.other')).map(baseOf));

let issues = 0;
for (const file of readdirSync('src/i18n/locales').sort()) {
  const src = readFileSync(`src/i18n/locales/${file}`, 'utf8');
  const keys = keysOf(src);
  const keySet = new Set(keys);
  const base = new Set(keys.map(baseOf));
  const placeholders = placeholdersOf(src);

  const problems = [
    ...[...enBase].filter((k) => !base.has(k)).map((k) => `missing ${k}`),
    ...[...base].filter((k) => !enBase.has(k)).map((k) => `unknown ${k}`),
    ...keys.filter((k, i) => keys.indexOf(k) !== i).map((k) => `duplicate ${k}`),
    ...[...enPlurals].filter((b) => base.has(b) && !keySet.has(`${b}.other`)).map((b) => `no .other for ${b}`),
    ...[...placeholders]
      .filter(([k, v]) => enPlaceholders.has(k) && enPlaceholders.get(k) !== v)
      .map(([k, v]) => `placeholders ${k}: {${v}} vs en {${enPlaceholders.get(k)}}`),
  ];
  issues += problems.length;
  console.log(`${file.padEnd(6)} ${String(keys.length).padStart(3)} keys ${problems.length ? '' : 'OK'}`);
  for (const p of problems) console.log(`    ${p}`);
}
console.log(`en.ts  ${String(enKeys.length).padStart(3)} keys · ${issues} issue${issues === 1 ? '' : 's'}`);
process.exit(issues ? 1 : 0);
