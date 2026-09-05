/**
 * Performance profile of the real game.
 *
 * Boots the dev server, plays a level through the dev hook (so the run is
 * deterministic), opens the win screen, home, map and shop, and reports:
 *   - long tasks (>50 ms) with the phase they landed in,
 *   - frame-time percentiles during gameplay,
 *   - the hottest self-time functions from a V8 CPU profile,
 *   - console warnings/errors/info (the render-resolution watchdog logs here).
 *
 *   npm run perf -- <level> [--headed]
 *
 * --headed uses the real GPU in a visible window (representative frame
 * times). Headless uses software GL, roughly ten times slower - a useful
 * stand-in for a slow phone (it is what makes the resolution watchdog fire).
 */
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5199;
const URL = `http://localhost:${PORT}/`;
const args = process.argv.slice(2);
const LEVEL = Number(args.find((a) => /^\d+$/.test(a)) ?? 150);
const HEADED = args.includes('--headed');
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = EDGE_PATHS.find((p) => existsSync(p));

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  shell: true, stdio: 'ignore', cwd: process.cwd(),
});
const killServer = () => {
  if (process.platform === 'win32' && server.pid) {
    spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill();
  }
};
process.on('uncaughtException', (e) => { console.error(e); killServer(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); killServer(); process.exit(1); });

const deadline = Date.now() + 40_000;
while (Date.now() < deadline) {
  try { if ((await fetch(URL)).ok) break; } catch { /* not up yet */ }
  await sleep(300);
}

const browser = await chromium.launch({
  ...(edge ? { executablePath: edge } : {}),
  headless: !HEADED,
  args: HEADED
    ? ['--autoplay-policy=no-user-gesture-required']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
});
const page = await context.newPage();
const logs = [];
page.on('console', (m) => { if (['warning', 'error', 'info'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__long.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
  }).observe({ type: 'longtask', buffered: true });
  window.__frames = [];
  let last = performance.now();
  const tick = (now) => { window.__frames.push({ t: now, d: now - last }); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const marks = [];
const mark = async (name) => marks.push({ name, t: Math.round(await page.evaluate(() => performance.now())) });

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('#screen-profile.screen--active', { timeout: 15_000 });
const bootMs = Date.now() - t0;
await page.click('#btn-start-profile');
await page.waitForSelector('.modal', { timeout: 5000 });
await page.locator('.modal button', { hasText: 'Claim' }).click();
await sleep(300);

const cdp = await context.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
await cdp.send('Profiler.start');
await mark('profile-start');

await page.evaluate((id) => window.__cf.start(id), LEVEL);
await page.waitForSelector('#screen-game.screen--active', { timeout: 15_000 });
await page.waitForFunction(() => window.__cf.state().tubes > 0, null, { timeout: 15_000 });
await sleep(1500);
await mark('level-ready');
const play = await page.evaluate(() => window.__cf.autoplay());
await mark('autoplay-done');
await page.waitForSelector('.modal', { timeout: 10_000 });
await sleep(1200);
await mark('win-shown');
await page.locator('.modal button').last().click();
await page.waitForSelector('#screen-home.screen--active', { timeout: 8000 });
await mark('home');
await page.click('.bottomnav__tab[data-nav="map"]');
await page.waitForSelector('#screen-map.screen--active', { timeout: 8000 });
await sleep(400);
await mark('map-open');
await page.click('.bottomnav__tab[data-nav="shop"]');
await page.waitForSelector('#screen-shop.screen--active', { timeout: 8000 });
await sleep(400);
await mark('shop-open');

const { profile } = await cdp.send('Profiler.stop');
const long = await page.evaluate(() => window.__long);
const frames = await page.evaluate(() => window.__frames);
const renderScale = await page.evaluate(() => window.__cf.state().renderScale);

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dts = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) {
  const cf = byId.get(profile.samples[i]).callFrame;
  const file = (cf.url || '').split('/').slice(-1)[0].split('?')[0];
  const key = `${cf.functionName || '(anon)'} @ ${file}:${cf.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dts[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const phaseOf = (t) => marks.filter((m) => m.t <= t).at(-1)?.name ?? 'boot';

console.log(`\n${HEADED ? 'headed/GPU' : 'headless/software GL'} level ${LEVEL}: ${play.moves} moves; dev boot to first screen ${bootMs} ms; final render scale ${renderScale}`);
console.log('marks:', marks.map((m) => `${m.name}@${m.t}`).join('  '));
console.log(`\nlong tasks (>50ms): ${long.length}`);
for (const l of long) console.log(`  ${String(l.d).padStart(5)} ms at ${l.t} (${phaseOf(l.t)})`);

const a = marks.find((m) => m.name === 'level-ready')?.t ?? 0;
const b = marks.find((m) => m.name === 'autoplay-done')?.t ?? Infinity;
const inPlay = frames.filter((f) => f.t >= a && f.t <= b).map((f) => f.d).sort((x, y) => x - y);
const pct = (q) => Math.round(inPlay[Math.floor(inPlay.length * q)] ?? 0);
console.log(`\ngameplay frames: ${inPlay.length}, median ${pct(0.5)} ms, p95 ${pct(0.95)} ms, p99 ${pct(0.99)} ms, max ${Math.round(inPlay.at(-1) ?? 0)} ms, >34ms: ${inPlay.filter((f) => f > 34).length}, >50ms: ${inPlay.filter((f) => f > 50).length}`);
console.log(`\ntop self time (of ${Math.round(total / 1000)} ms sampled):`);
for (const [k, v] of [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 26)) {
  console.log(`  ${String(Math.round(v / 1000)).padStart(6)} ms  ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
}
console.log('\nconsole (warn/error/info):', logs.length ? logs : 'none');
await browser.close();
killServer();
