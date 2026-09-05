/**
 * Generation sweep for the levels that are dealt on the device rather than
 * precomputed: the next two years of daily challenges and the first thousand
 * endless levels. Run with `npm run levels:sweep` after touching the level
 * recipes, the generator or the solver. Exits non-zero on any failure.
 *
 * Not part of `test:core` (it takes a few minutes); it is the proof that a
 * player can never tap Daily or Endless and be told the level could not be
 * built.
 */
import { applyPour, cloneBoard, isSolved, rulesFor } from './board';
import { dailyId, dailySpec, todayDayNumber } from './daily';
import { generateLevel } from './generator';
import { LEVEL_COUNT, endlessSpec } from './levels';
import type { LevelSpec } from './types';

const DAILY_DAYS = 730;
const ENDLESS_COUNT = 1000;

function sweep(label: string, specs: readonly LevelSpec[]): number {
  let failures = 0;
  let worst = 0;
  let worstId = 0;
  let total = 0;
  for (const spec of specs) {
    const t0 = performance.now();
    try {
      const gen = generateLevel(spec);
      const rules = rulesFor(spec);
      const work = cloneBoard(gen.board);
      for (const m of gen.solution) applyPour(work, m.from, m.to, rules);
      if (!isSolved(work, rules) || gen.par < spec.minPar) {
        failures += 1;
        console.log(`  ${label} ${spec.id}: bad result (par ${gen.par}, floor ${spec.minPar})`);
      }
    } catch (err) {
      failures += 1;
      console.log(`  ${label} ${spec.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const ms = performance.now() - t0;
    total += ms;
    if (ms > worst) {
      worst = ms;
      worstId = spec.id;
    }
  }
  console.log(
    `${label}: ${specs.length} generated in ${(total / 1000).toFixed(0)}s, ${failures} failures, ` +
    `worst ${worst.toFixed(0)}ms (id ${worstId}), avg ${(total / specs.length).toFixed(0)}ms`,
  );
  return failures;
}

const today = todayDayNumber();
let failures = 0;
failures += sweep(
  `daily (next ${DAILY_DAYS} days)`,
  Array.from({ length: DAILY_DAYS }, (_, i) => dailySpec(dailyId(today + i))),
);
failures += sweep(
  `endless (#1..#${ENDLESS_COUNT})`,
  Array.from({ length: ENDLESS_COUNT }, (_, i) => endlessSpec(LEVEL_COUNT + 1 + i)),
);

if (failures > 0) {
  console.log(`\n  ${failures} level(s) failed to generate`);
  process.exit(1);
}
console.log('\n  sweep OK');
