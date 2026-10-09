/**
 * Difficulty report for the shipped campaign. Run with
 * `npm run levels:difficulty` (add `--rows` for one line per level).
 *
 * Prints the casual-play win rate (see difficulty.ts) of every precomputed
 * board, averaged by stretch of the campaign and by level shape. Measured
 * with fresh seeds, so it is an independent check on the generator's band
 * filter rather than a replay of it. The curve should fall steadily; a flat
 * stretch is a stretch players will call easy.
 */
import campaignJson from './campaign.json';
import { rulesFor } from './board';
import { forgiveness } from './difficulty';
import { getLevelSpec } from './levels';
import type { Board, LevelSpec } from './types';

interface Stored { readonly id: number; readonly board: Board; readonly par: number }
const levels = (campaignJson as unknown as { levels: readonly Stored[] }).levels;

function shapeOf(spec: LevelSpec): string {
  if (spec.recipe && (spec.labels || spec.lock)) return 'combo';
  if (spec.precision) return 'precision';
  if (spec.recipe) return 'recipe';
  if (spec.labels) return 'labelled';
  if (spec.cauldron) return 'cauldron';
  if (spec.oneWay) return 'one-way';
  if (spec.lock) return 'lock';
  if (spec.id % 10 === 4) return 'breather';
  if (spec.empties === 1) return 'squeeze';
  return 'standard';
}

function stretchOf(id: number): string {
  if (id <= 10) return '001-010';
  if (id <= 25) return '011-025';
  if (id <= 50) return '026-050';
  if (id <= 100) return '051-100';
  if (id <= 150) return '101-150';
  if (id <= 200) return '151-200';
  return '201-300';
}

const rows = process.argv.includes('--rows');
const groups = new Map<string, number[]>();
for (const level of levels) {
  const spec = getLevelSpec(level.id);
  const f = forgiveness(level.board, rulesFor(spec), level.id + 7_000_000, 64);
  const shape = shapeOf(spec);
  for (const key of [`${stretchOf(level.id)}  all`, `${stretchOf(level.id)}  ${shape}`, `shape    ${shape}`]) {
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  if (rows) console.log(`L${level.id}\t${shape}\tpar ${level.par}\t${(f * 100).toFixed(0)}%`);
}

console.log('\n  casual win rate (lower = more thinking required)\n');
for (const [key, list] of [...groups].sort()) {
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  console.log(`  ${key.padEnd(20)} n=${String(list.length).padStart(3)}  ${(mean * 100).toFixed(0).padStart(3)}%`);
}
