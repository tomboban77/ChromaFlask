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
/** Must match LEVEL_COUNT in src/core/levels.ts. */
const LEVEL_COUNT = 500;

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
// Local Windows machines drive the installed Edge; anywhere else (CI) uses
// Playwright's own Chromium, installed with `npx playwright-core install chromium`.
const edge = EDGE_PATHS.find((p) => existsSync(p));
console.log(edge ? `browser: Edge (${edge})` : 'browser: Playwright Chromium');

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
  // One entry per distinct error with a count and the top of its stack: a
  // per-frame failure would otherwise drown the report in identical lines.
  const seenErrors = new Map(); // key -> { index, count }
  page.on('pageerror', (err) => {
    const top = (err.stack || '').split('\n').slice(1, 4).map((l) => l.trim()).join(' <- ');
    const key = `[${label}] pageerror: ${err.message} ${top}`;
    const seen = seenErrors.get(key);
    if (!seen) {
      seenErrors.set(key, { index: problems.length, count: 1 });
      problems.push(key);
    } else {
      seen.count += 1;
      problems[seen.index] = `${key} (x${seen.count})`;
    }
  });

  await page.goto(URL, { waitUntil: 'load' });

  // ---- boot -> profile
  await page.waitForSelector('#screen-profile.screen--active', { timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/${label}-1-profile.png` });
  console.log('  profile screen  OK');

  // pick a non-default avatar, type a name
  await page.locator('.avatar').nth(2).click();
  await page.fill('#name-input', 'Tester');
  await page.click('#btn-start-profile');

  // ---- home
  await page.waitForSelector('#screen-home.screen--active', { timeout: 10_000 });
  const playLabel = (await page.locator('#btn-play').textContent())?.trim();
  console.log(`  home screen     OK (play button: "${playLabel}")`);
  if (playLabel !== 'Level 1') problems.push(`[${label}] play button should read "Level 1", got "${playLabel}"`);
  const livesShown = (await page.locator('#home-lives').textContent())?.trim();
  if (livesShown !== '5') problems.push(`[${label}] fresh profile should have 5 hearts, got "${livesShown}"`);
  await page.screenshot({ path: `${SHOTS}/${label}-1b-home.png` });

  // ---- daily challenge: today's board is generated in the worker
  const dailySub = (await page.locator('#daily-sub').textContent())?.trim();
  console.log(`  daily button    "${dailySub}"`);
  if (dailySub !== 'A new potion every day') problems.push(`[${label}] fresh profile daily sub-line wrong: "${dailySub}"`);
  await page.click('#btn-daily');
  await page.waitForSelector('#screen-game.screen--active', { timeout: 15_000 });
  await page.waitForFunction(() => window.__cf.state().tubes > 0, null, { timeout: 15_000 });
  await sleep(500);
  const dailyLabel = (await page.locator('#game-level-label').textContent())?.trim();
  console.log(`  daily level     "${dailyLabel}"`);
  if (dailyLabel !== 'Daily challenge') problems.push(`[${label}] HUD should read "Daily challenge", got "${dailyLabel}"`);
  await page.click('#btn-back'); // no moves: straight home
  await page.waitForSelector('#screen-home.screen--active', { timeout: 8000 });

  // ---- shop (open from the bottom nav, then close)
  await page.click('.bottomnav__tab[data-nav="shop"]');
  await page.waitForSelector('#screen-shop.screen--active', { timeout: 8000 });
  const bundleCount = await page.locator('.bundle').count();
  const coinItemCount = await page.locator('.shopitem').count();
  console.log(`  shop screen     OK (${bundleCount} bundles, ${coinItemCount} coin items)`);
  if (bundleCount !== 2) problems.push(`[${label}] expected 2 IAP bundles in dev, got ${bundleCount}`);
  if (coinItemCount !== 4) problems.push(`[${label}] expected 4 coin items, got ${coinItemCount}`);
  await page.screenshot({ path: `${SHOTS}/${label}-1c-shop.png` });
  await page.click('#btn-shop-close');
  await page.waitForSelector('#screen-home.screen--active', { timeout: 8000 });

  // ---- map
  await page.click('.bottomnav__tab[data-nav="map"]');
  await page.waitForSelector('#screen-map.screen--active', { timeout: 10_000 });
  const nodeCount = await page.locator('.node').count();
  const lockedCount = await page.locator('.node--locked').count();
  console.log(`  map screen      OK (${nodeCount} levels, ${lockedCount} locked)`);
  if (nodeCount !== LEVEL_COUNT) problems.push(`[${label}] expected ${LEVEL_COUNT} level nodes, got ${nodeCount}`);
  const chapterCount = await page.locator('.chapter').count();
  if (chapterCount !== LEVEL_COUNT / 20) problems.push(`[${label}] expected ${LEVEL_COUNT / 20} chapter headers, got ${chapterCount}`);
  if (lockedCount !== LEVEL_COUNT - 1) problems.push(`[${label}] expected ${LEVEL_COUNT - 1} locked levels, got ${lockedCount}`);
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
  const handVisible = await page.locator('#tutorial-hand').isVisible();
  console.log(`  hand pointer    ${handVisible ? 'shown' : 'NOT shown'}`);
  if (!handVisible) problems.push(`[${label}] tutorial hand pointer did not appear`);

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
  const expectedGain = 50 + 3 * 15; // baseReward + 3 stars * rewardPerStar (+ firstClearBonus 0)
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

  // ---- bottles are never free: the first tap opens the shop, nothing is charged
  const tubesBefore = afterUndo.tubes;
  await page.evaluate(() => window.__cf.addCoins(1000)); // fund the test account
  const coinsBeforeBottle = (await page.evaluate(() => window.__cf.state())).coins;
  await page.click('#btn-bottle');
  await page.waitForSelector('#screen-shop.screen--active', { timeout: 8000 });
  const coinsAtShop = (await page.evaluate(() => window.__cf.state())).coins;
  console.log(`  bottle (0 free) shop opened, coins ${coinsBeforeBottle} -> ${coinsAtShop}`);
  if (coinsAtShop !== coinsBeforeBottle) {
    problems.push(`[${label}] tapping Bottle with none in stock must open the shop, not charge coins`);
  }
  // buy a Bottle x3 pack (item order: hearts, undo, hint, bottle)
  await page.locator('.shopitem .pricebtn').nth(3).click();
  await sleep(400);
  const afterBottlePack = (await page.evaluate(() => window.__cf.state())).coins;
  console.log(`  coin purchase   bottle x3 for 320 (coins ${coinsAtShop} -> ${afterBottlePack})`);
  if (afterBottlePack !== coinsAtShop - 320) problems.push(`[${label}] bottle pack should cost 320 coins`);
  await page.click('#btn-shop-close');
  await page.waitForSelector('#screen-game.screen--active', { timeout: 8000 });
  await page.click('#btn-bottle'); // consumes owned stock
  await sleep(700);
  const afterBottle = await page.evaluate(() => window.__cf.state());
  console.log(`  add bottle      ${tubesBefore} -> ${afterBottle.tubes} tubes`);
  if (afterBottle.tubes !== tubesBefore + 1) {
    problems.push(`[${label}] add-bottle did not add a tube`);
  }
  await page.screenshot({ path: `${SHOTS}/${label}-8-powerups.png` });

  // ---- out of a powerup -> the shop opens instead of charging coins
  // (the single free hint was spent earlier in this level)
  const coinsBeforeEmpty = (await page.evaluate(() => window.__cf.state())).coins;
  await page.click('#btn-hint');
  await page.waitForSelector('#screen-shop.screen--active', { timeout: 8000 });
  const coinsAfterEmpty = (await page.evaluate(() => window.__cf.state())).coins;
  console.log(`  powerup empty   shop opened, coins ${coinsBeforeEmpty} -> ${coinsAfterEmpty}`);
  if (coinsAfterEmpty !== coinsBeforeEmpty) {
    problems.push(`[${label}] running out of hints must open the shop, not charge coins`);
  }
  await page.screenshot({ path: `${SHOTS}/${label}-8b-shop-from-game.png` });

  // buy a Hint x3 pack with coins (item order: hearts, undo, hint, bottle)
  await page.locator('.shopitem .pricebtn').nth(2).click();
  await sleep(400);
  const afterPack = await page.evaluate(() => window.__cf.state());
  console.log(`  coin purchase   hint x3 for 200 (coins ${coinsAfterEmpty} -> ${afterPack.coins})`);
  if (afterPack.coins !== coinsAfterEmpty - 200) {
    problems.push(`[${label}] hint pack should cost 200 coins`);
  }
  await page.click('#btn-shop-close');
  await page.waitForSelector('#screen-game.screen--active', { timeout: 8000 });
  await page.click('#btn-hint'); // consumes owned stock
  await sleep(450);
  const hintBadge = (await page.locator('#badge-hint').textContent())?.trim();
  console.log(`  owned stock     hint badge now "${hintBadge}"`);
  if (hintBadge !== '2') {
    problems.push(`[${label}] hint badge should read 2 after using 1 of 3 bought, got "${hintBadge}"`);
  }

  // ---- settings, including the colourblind aid
  await page.click('#btn-settings-game');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.locator('.switch').nth(3).click(); // colourblind
  await sleep(400);
  await page.screenshot({ path: `${SHOTS}/${label}-9-settings.png` });
  await page.locator('.modal button').last().click();
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/${label}-10-colorblind.png` });

  // ---- replaying an already-perfect level must pay nothing (coin-farm guard)
  const coinsBeforeReplay = (await page.evaluate(() => window.__cf.state())).coins;
  await page.evaluate(() => window.__cf.start(1));
  await sleep(900);
  const replay = await page.evaluate(() => window.__cf.autoplay());
  await page.waitForSelector('.modal', { timeout: 8000 });
  const coinsAfterReplay = (await page.evaluate(() => window.__cf.state())).coins;
  console.log(`  replay level 1  ${replay.moves} moves, coins ${coinsBeforeReplay} -> ${coinsAfterReplay}`);
  if (coinsAfterReplay !== coinsBeforeReplay) {
    problems.push(`[${label}] replaying a 3-star level paid ${coinsAfterReplay - coinsBeforeReplay} coins; must be 0`);
  }
  await page.locator('.modal button').last().click(); // Home
  await page.waitForSelector('#screen-home.screen--active', { timeout: 8000 });

  // ---- mid-level resume: a move made on level 2 survives a full reload
  await page.evaluate(() => window.__cf.start(2));
  await sleep(900);
  const resumeMove = await page.evaluate(() => window.__cf.move(0));
  await page.evaluate((mv) => window.__cf.tap(mv.from), resumeMove);
  await page.evaluate((mv) => window.__cf.tap(mv.to), resumeMove);
  await sleep(1100);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#screen-home.screen--active', { timeout: 15_000 });
  const resumeLabel = (await page.locator('#btn-play').textContent())?.trim();
  console.log(`  resume          play button reads "${resumeLabel}"`);
  if (resumeLabel !== 'Continue level 2') {
    problems.push(`[${label}] play button should offer to continue level 2, got "${resumeLabel}"`);
  }
  await page.click('#btn-play');
  await page.waitForSelector('#screen-game.screen--active', { timeout: 8000 });
  await sleep(900);
  const resumed = await page.evaluate(() => window.__cf.state());
  console.log(`  resumed level   moves=${resumed.moves} tubes=${resumed.tubes}`);
  if (resumed.moves !== 1 || resumed.tubes !== 5) {
    problems.push(`[${label}] resumed level 2 should have 1 move and 5 tubes, got ${resumed.moves}/${resumed.tubes}`);
  }
  // Leaving a live board is free and drops the saved attempt.
  await page.click('#btn-back');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.locator('.modal button').last().click(); // Leave
  await page.waitForSelector('#screen-home.screen--active', { timeout: 8000 });
  const afterLeave = (await page.locator('#btn-play').textContent())?.trim();
  const livesAfterLeave = (await page.locator('#home-lives').textContent())?.trim();
  console.log(`  after leaving   play button "${afterLeave}", hearts ${livesAfterLeave}`);
  if (afterLeave !== 'Level 2') problems.push(`[${label}] leaving should clear the saved attempt (got "${afterLeave}")`);
  if (livesAfterLeave !== '5') problems.push(`[${label}] leaving a live board must not cost a heart (hearts=${livesAfterLeave})`);

  // ---- endless mode: the first level past the campaign is generated in the worker on demand
  await page.evaluate((id) => window.__cf.start(id), LEVEL_COUNT + 1);
  await page.waitForSelector('#screen-game.screen--active', { timeout: 15_000 });
  await page.waitForFunction(() => window.__cf.state().tubes > 0, null, { timeout: 15_000 });
  await sleep(600);
  const endless = await page.evaluate(() => window.__cf.state());
  const endlessLabel = (await page.locator('#game-level-label').textContent())?.trim();
  console.log(`  endless #1      "${endlessLabel}" tubes=${endless.tubes} ideal=${endless.par}`);
  if (endlessLabel !== 'Endless #1') problems.push(`[${label}] HUD should read "Endless #1", got "${endlessLabel}"`);
  if (endless.tubes !== 10) problems.push(`[${label}] endless #1 should be 8 colours + 2 empties = 10 tubes, got ${endless.tubes}`);
  if (!(endless.par >= 22)) problems.push(`[${label}] endless #1 ideal should be >= 22, got ${endless.par}`);
  await page.click('#btn-back'); // no moves made: straight home, no dialog
  await page.waitForSelector('#screen-home.screen--active', { timeout: 8000 });

  // ---- locked bottle (level 205): tapping the padlocked bottle is refused, others select
  await page.evaluate(() => window.__cf.start(205));
  await page.waitForSelector('#screen-game.screen--active', { timeout: 15_000 });
  await sleep(1500);
  await page.evaluate(() => window.__cf.tap(0)); // bottle 0 is the locked one
  await sleep(300);
  const afterLockedTap = await page.evaluate(() => window.__cf.state());
  await page.evaluate(() => window.__cf.tap(1));
  await sleep(300);
  const afterFreeTap = await page.evaluate(() => window.__cf.state());
  console.log(`  locked bottle   tap locked -> selected=${afterLockedTap.selected}, tap free -> selected=${afterFreeTap.selected}`);
  if (afterLockedTap.selected !== null) problems.push(`[${label}] the locked bottle must not be selectable`);
  if (afterFreeTap.selected !== 1) problems.push(`[${label}] an ordinary bottle should still select on a lock level`);
  await page.evaluate(() => window.__cf.tap(1)); // deselect
  await sleep(200);
  await page.click('#btn-back'); // no moves: straight home
  await page.waitForSelector('#screen-home.screen--active', { timeout: 8000 });

  // ---- back button: closes an open dialog, then returns from map to home
  await page.click('#btn-settings-home');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.goBack();
  await sleep(300);
  const modalAfterBack = await page.locator('.modal').count();
  console.log(`  back on dialog  ${modalAfterBack === 0 ? 'closed it' : 'did NOT close it'}`);
  if (modalAfterBack !== 0) problems.push(`[${label}] back button did not close the settings dialog`);
  await page.click('.bottomnav__tab[data-nav="map"]');
  await page.waitForSelector('#screen-map.screen--active', { timeout: 8000 });
  await page.goBack();
  await page.waitForSelector('#screen-home.screen--active', { timeout: 5000 });
  console.log('  back on map     returned home');

  // ---- persistence across a reload (lands on home, then check the map)
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#screen-home.screen--active', { timeout: 15_000 });
  await page.click('.bottomnav__tab[data-nav="map"]');
  await page.waitForSelector('#screen-map.screen--active', { timeout: 8000 });
  const savedName = await page.locator('#map-name').textContent();
  const unlockedAfter = await page.locator('.node--locked').count();
  console.log(`  after reload    name="${savedName}" locked=${unlockedAfter}`);
  if (savedName !== 'Tester') problems.push(`[${label}] profile did not persist (got "${savedName}")`);
  if (unlockedAfter !== LEVEL_COUNT - 2) {
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
    ...(edge ? { executablePath: edge } : {}),
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
