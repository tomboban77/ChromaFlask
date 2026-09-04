/**
 * End-to-end smoke test.
 *
 * Boots the dev server, drives the real game in Edge, plays level 1 to a win
 * using the generated solution, and fails on any console or page error.
 * Screenshots land in .tmp/shots/.
 *
 *   node scripts/smoke.mjs
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5199;
const URL = `http://localhost:${PORT}/`;
const SHOTS = '.tmp/shots';

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = EDGE_PATHS.find((p) => existsSync(p));
if (!edge) {
  console.error('Microsoft Edge not found; cannot run smoke test.');
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });

const problems = [];
let server;

async function waitForServer(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error('dev server did not start');
}

/** Run one full pass at a given viewport. */
async function runViewport(browser, label, width, height, isMobile) {
  console.log(`\n--- ${label} (${width}x${height}) ---`);
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: isMobile ? 3 : 1,
    isMobile,
    hasTouch: isMobile,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[${label}] console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`[${label}] HTTP ${res.status()} ${res.url()}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${err.message}`));

  await page.goto(URL, { waitUntil: 'load' });

  // ---- boot -> profile
  await page.waitForSelector('#screen-profile.screen--active', { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/${label}-1-profile.png` });
  console.log('  profile screen  OK');

  // pick a non-default avatar, type a name
  await page.locator('.avatar').nth(2).click();
  await page.fill('#name-input', 'Tester');
  await page.click('#btn-start-profile');

  // ---- map
  await page.waitForSelector('#screen-map.screen--active', { timeout: 10_000 });
  const nodeCount = await page.locator('.node').count();
  const lockedCount = await page.locator('.node--locked').count();
  console.log(`  map screen      OK (${nodeCount} levels, ${lockedCount} locked)`);
  if (nodeCount !== 10) problems.push(`[${label}] expected 10 level nodes, got ${nodeCount}`);
  if (lockedCount !== 9) problems.push(`[${label}] expected 9 locked levels, got ${lockedCount}`);
  await page.screenshot({ path: `${SHOTS}/${label}-2-map.png` });

  // ---- into level 1
  await page.locator('.node').first().click();
  await page.waitForSelector('#screen-game.screen--active', { timeout: 10_000 });
  await page.waitForSelector('#board-host canvas', { timeout: 10_000 });

  // renderer sanity: a zero-sized canvas means layout never ran
  const canvasBox = await page.locator('#board-host canvas').boundingBox();
  console.log(`  canvas          ${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)}`);
  if (!canvasBox || canvasBox.width < 50 || canvasBox.height < 50) {
    problems.push(`[${label}] canvas has no usable size`);
  }

  await sleep(1400); // let the intro animation settle
  await page.screenshot({ path: `${SHOTS}/${label}-3-game.png` });

  const hookPresent = await page.evaluate(() => typeof window.__cf === 'object');
  if (!hookPresent) {
    problems.push(`[${label}] dev hook missing - cannot drive gameplay`);
    await context.close();
    return;
  }

  const initial = await page.evaluate(() => window.__cf.state());
  console.log(`  level state     tubes=${initial.tubes} par=${initial.par} coins=${initial.coins}`);
  if (initial.tubes !== 4) problems.push(`[${label}] level 1 should have 4 tubes, got ${initial.tubes}`);

  // ---- tutorial should be showing on a fresh profile
  const coachVisible = await page.locator('#coach').isVisible();
  console.log(`  tutorial        ${coachVisible ? 'shown' : 'NOT shown'}`);
  if (!coachVisible) problems.push(`[${label}] tutorial did not appear on level 1`);

  // ---- a manual pour, to exercise real input and the pour animation
  await page.evaluate(() => window.__cf.tap(0));
  await sleep(260);
  await page.screenshot({ path: `${SHOTS}/${label}-4-selected.png` });

  // ---- play the generated winning line
  const run = await page.evaluate(() => window.__cf.autoplay());
  const afterWin = await page.evaluate(() => window.__cf.state());
  console.log(`  autoplay        won in ${run.moves} moves (par ${initial.par})`);
  if (run.moves !== initial.par) {
    problems.push(`[${label}] solution replay took ${run.moves} moves, par is ${initial.par}`);
  }
  // Regression guard: the win used to fire twice, paying the reward out twice.
  if (afterWin.winCount !== 1) {
    problems.push(`[${label}] onWin fired ${afterWin.winCount} times, expected exactly 1`);
  }
  const expectedGain = 50 + 3 * 25 + 100;
  if (afterWin.coins - initial.coins !== expectedGain) {
    problems.push(
      `[${label}] coin reward was ${afterWin.coins - initial.coins}, expected ${expectedGain}`,
    );
  }

  await page.waitForSelector('.modal', { timeout: 8000 });
  const title = (await page.locator('.modal__title').textContent()) ?? '';
  console.log(`  win modal       "${title.trim()}"`);
  if (!/complete/i.test(title)) problems.push(`[${label}] win modal did not appear (saw "${title}")`);

  // Stars pop in on a 180ms + 260ms/star stagger; wait it out before counting.
  await sleep(1300);
  const starsOn = await page.locator('.stars i.on').count();
  console.log(`  stars awarded   ${starsOn}/3`);
  if (starsOn !== 3) problems.push(`[${label}] par run should award 3 stars, got ${starsOn}`);
  if (afterWin.coins <= initial.coins) {
    problems.push(`[${label}] coins did not increase after a win`);
  }
  await page.screenshot({ path: `${SHOTS}/${label}-5-win.png` });

  // ---- next level, verify progression carried
  await page.locator('.modal button').first().click();
  await page.waitForSelector('#screen-game.screen--active', { timeout: 8000 });
  await sleep(900);
  const lvl2 = await page.evaluate(() => window.__cf.state());
  console.log(`  level 2         tubes=${lvl2.tubes} par=${lvl2.par}`);
  if (lvl2.tubes !== 5) problems.push(`[${label}] level 2 should have 5 tubes, got ${lvl2.tubes}`);
  await page.screenshot({ path: `${SHOTS}/${label}-6-level2.png` });

  // ---- powerups
  await page.click('#btn-hint');
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/${label}-7-hint.png` });

  // Play the first move of the real solution so the pour is certain to be legal.
  const first = await page.evaluate(() => window.__cf.move(0));
  await page.evaluate((mv) => window.__cf.tap(mv.from), first);
  await page.evaluate((mv) => window.__cf.tap(mv.to), first);
  await sleep(1100);
  const beforeUndo = await page.evaluate(() => window.__cf.state());
  if (beforeUndo.moves !== 1) {
    problems.push(`[${label}] solution move ${first.from}->${first.to} did not register`);
  }
  await page.click('#btn-undo');
  await sleep(450);
  const afterUndo = await page.evaluate(() => window.__cf.state());
  console.log(`  undo            ${beforeUndo.moves} -> ${afterUndo.moves} moves`);
  if (afterUndo.moves !== beforeUndo.moves - 1) {
    problems.push(`[${label}] undo did not reduce the move count`);
  }

  const tubesBefore = afterUndo.tubes;
  await page.click('#btn-bottle');
  await sleep(700);
  const afterBottle = await page.evaluate(() => window.__cf.state());
  console.log(`  add bottle      ${tubesBefore} -> ${afterBottle.tubes} tubes`);
  if (afterBottle.tubes !== tubesBefore + 1) {
    problems.push(`[${label}] add-bottle did not add a tube`);
  }
  await page.screenshot({ path: `${SHOTS}/${label}-8-powerups.png` });

  // ---- settings, including the colourblind aid
  await page.click('#btn-settings-game');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.locator('.switch').nth(3).click(); // colourblind
  await sleep(400);
  await page.screenshot({ path: `${SHOTS}/${label}-9-settings.png` });
  await page.locator('.modal button').last().click();
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/${label}-10-colorblind.png` });

  // ---- persistence across a reload
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#screen-map.screen--active', { timeout: 15_000 });
  const savedName = await page.locator('#map-name').textContent();
  const unlockedAfter = await page.locator('.node--locked').count();
  console.log(`  after reload    name="${savedName}" locked=${unlockedAfter}`);
  if (savedName !== 'Tester') problems.push(`[${label}] profile did not persist (got "${savedName}")`);
  if (unlockedAfter !== 8) {
    problems.push(`[${label}] level 2 should be unlocked after clearing 1 (locked=${unlockedAfter})`);
  }
  await page.screenshot({ path: `${SHOTS}/${label}-11-reloaded.png` });

  await context.close();
}

try {
  console.log('starting dev server...');
  server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32' },
  );
  await waitForServer();
  console.log('dev server up');

  const browser = await chromium.launch({
    executablePath: edge,
    headless: true,
    args: [
      // Headless needs a software GL path for Pixi to get a WebGL context.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  await runViewport(browser, 'mobile', 390, 844, true);
  await runViewport(browser, 'desktop', 1280, 800, false);

  await browser.close();
} catch (err) {
  problems.push(`fatal: ${err.message}`);
} finally {
  server?.kill();
}

console.log('\n========================================');
if (problems.length === 0) {
  console.log('SMOKE TEST PASSED');
  console.log(`screenshots in ${SHOTS}/`);
  process.exit(0);
}
console.log(`SMOKE TEST FAILED - ${problems.length} problem(s):`);
for (const p of problems) console.log(`  x ${p}`);
process.exit(1);
