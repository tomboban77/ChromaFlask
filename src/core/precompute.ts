/**
 * Precompute the campaign. Run with `npm run levels:build`.
 *
 * Every level is deterministic, so the board a player would generate on their
 * phone is exactly the board generated here. Doing it once at build time means
 * zero solver work at "Next level" on-device (the worst seeds took over a
 * second on a desktop, several on a mid-range phone) - and, with no time
 * budget to respect, the exact solve can run far longer than the runtime
 * generator allows, so every stored par is the true optimum wherever the
 * search completes.
 *
 * Output: src/core/campaign.json, one level per line so diffs stay readable.
 * `npm run test:core` proves the file against the live generator.
 */
import { writeFileSync } from 'node:fs';
import { rulesFor } from './board';
import { generateLevel } from './generator';
import { LEVELS } from './levels';
import { solve } from './solver';

const OUT = 'src/core/campaign.json';
/** Node budget for the offline exact solve. Bounded by memory, not patience. */
const EXACT_BUDGET = 800_000;

const lines: string[] = [];
let tightened = 0;
let nonOptimal = 0;
const t0 = performance.now();

for (const spec of LEVELS) {
  const started = performance.now();
  const gen = generateLevel(spec);
  const rules = rulesFor(spec);

  let par = gen.par;
  let solution = gen.solution;
  let optimal = true;

  const exact = solve(gen.board, { weight: 1, maxNodes: EXACT_BUDGET, rules });
  if (exact) {
    if (exact.solution.length < gen.par) tightened += 1;
    par = exact.solution.length;
    solution = exact.solution;
  } else {
    // Budget exhausted: keep the generator's (near-optimal) line, flag it.
    nonOptimal += 1;
    optimal = false;
  }

  lines.push(
    JSON.stringify({
      id: spec.id,
      board: gen.board,
      par,
      moves: solution.map((m) => [m.from, m.to]),
      optimal,
    }),
  );

  const ms = performance.now() - started;
  if (ms > 1000 || !optimal || par !== gen.par) {
    console.log(
      `  L${spec.id}: par ${gen.par} -> ${par}${optimal ? '' : ' (budget exhausted)'} ${ms.toFixed(0)} ms`,
    );
  }
}

const file =
  `{\n  "version": 1,\n  "exactBudget": ${EXACT_BUDGET},\n  "levels": [\n` +
  lines.map((l) => `    ${l}`).join(',\n') +
  `\n  ]\n}\n`;
writeFileSync(OUT, file);

console.log(
  `\n  ${LEVELS.length} levels written to ${OUT} in ${((performance.now() - t0) / 1000).toFixed(1)}s` +
  ` - ${tightened} pars tightened, ${nonOptimal} not proven optimal, ${(file.length / 1024).toFixed(0)} KB`,
);
