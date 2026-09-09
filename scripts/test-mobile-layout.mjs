/**
 * Geometry and interaction regressions for the mobile profile, HUD and dialogs.
 * Build first: npm run build:native && node scripts/test-mobile-layout.mjs
 * Optional: SMOKE_BROWSER=webkit, or SMOKE_BROWSER_EXECUTABLE=/path/to/browser.
 * Serves dist through request interception; no server or external requests needed.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const origin = 'http://mobile-layout.test';
assert(existsSync(resolve(dist, 'index.html')), 'Build the app before running the layout check.');
const engine = process.env.SMOKE_BROWSER === 'webkit' ? webkit : chromium;
const installedBrowsers = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = process.env.SMOKE_BROWSER_EXECUTABLE
  ?? (engine === chromium && !process.env.SMOKE_BROWSER ? installedBrowsers.find(existsSync) : undefined);
const browser = await engine.launch({ executablePath, headless: true });
const failures = [];
const context = await browser.newContext({
  viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, locale: 'en-US',
});
const page = await context.newPage();
page.setDefaultTimeout(10_000);
page.on('pageerror', (error) => failures.push(error.message));
const mime = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2',
};
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.fulfill({ status: 204, body: '' });
  const file = resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(dist + sep) || !existsSync(file)) {
    failures.push(`Missing built asset: ${url.pathname}`);
    return route.fulfill({ status: 404, body: '' });
  }
  await route.fulfill({ path: file, contentType: mime[extname(file)] });
});

const intersects = (a, b) => a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5
  && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5;
const rect = async (selector) => {
  const box = await page.locator(selector).boundingBox();
  assert(box, `${selector} must be visible`);
  return box;
};
const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
async function viewport(width, height, insets = { top: 0, bottom: 0, left: 0, right: 0 }) {
  await page.setViewportSize({ width, height });
  await page.evaluate(({ top, bottom, left, right }) => {
    const style = document.documentElement.style;
    for (const [key, value] of Object.entries({ t: top, b: bottom, l: left, r: right })) {
      style.setProperty(`--safe-${key}`, `${value}px`);
    }
  }, insets);
  await settle();
}

/** A clipped control must have a user-scrollable ancestor, then accept a real hit. */
async function reachable(selector, label) {
  const blocked = await page.locator(selector).evaluate((node) => {
    const target = node.getBoundingClientRect();
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const box = parent.getBoundingClientRect();
      const overflow = getComputedStyle(parent).overflowY;
      if (['hidden', 'clip'].includes(overflow) && (target.top < box.top - 1 || target.bottom > box.bottom + 1)) {
        // A nested scrolling region may legitimately contain the target offscreen.
        let scrollable = false;
        for (let inner = node.parentElement; inner && inner !== parent; inner = inner.parentElement) {
          if (/^(auto|scroll)$/.test(getComputedStyle(inner).overflowY) && inner.scrollHeight > inner.clientHeight) scrollable = true;
        }
        if (!scrollable) return `${parent.id || parent.className} clips the control without a scrolling region`;
      }
    }
    return null;
  });
  assert.equal(blocked, null, `${label}: ${blocked}`);
  await page.locator(selector).scrollIntoViewIfNeeded();
  const result = await page.locator(selector).evaluate((node) => {
    const box = node.getBoundingClientRect();
    const vv = window.visualViewport;
    let top = vv?.offsetTop ?? 0;
    let bottom = top + (vv?.height ?? innerHeight);
    let left = 0;
    let right = innerWidth;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      if (css.overflowY !== 'visible') { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      if (css.overflowX !== 'visible') { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
    }
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { fullyVisible: box.top >= top - 1 && box.bottom <= bottom + 1 && box.left >= left - 1 && box.right <= right + 1, acceptsHit: node.contains(hit) };
  });
  assert(result.fullyVisible, `${label}: control remains clipped after scrolling`);
  assert(result.acceptsHit, `${label}: another element intercepts the control`);
  await page.locator(selector).click({ trial: true });
}

async function profile(label) {
  for (const selector of ['#avatar-grid .avatar:first-child', '#name-input', '#btn-start-profile', '#btn-guest']) {
    await reachable(selector, `${label} ${selector}`);
  }
  console.log(`  profile ${label}: all controls reachable`);
}

async function dialog(label, insets) {
  await page.locator('.modal').evaluate((node) => { node.scrollTop = 0; });
  const box = await rect('.modal');
  const size = page.viewportSize();
  assert(box.y >= insets.top - 1 && box.y + box.height <= size.height - insets.bottom + 1, `${label}: dialog overlaps vertical safe area`);
  assert(box.x >= insets.left - 1 && box.x + box.width <= size.width - insets.right + 1, `${label}: dialog overlaps horizontal safe area (${JSON.stringify(box)}, viewport ${JSON.stringify(size)})`);
  if (await page.locator('.modal__x').count()) {
    const close = await rect('.modal__x');
    const textRects = await page.locator('.modal__title').evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects(), (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    });
    assert(textRects.every((text) => !intersects(text, close)), `${label}: title overlaps Close`);
    assert(textRects.every((text) => text.x >= box.x && text.x + text.width <= box.x + box.width), `${label}: title overflows dialog`);
    await reachable('.modal__x', `${label} Close`);
  }
  await reachable('.modal > :is(.modal__actions, .modal__row) > button:last-child', `${label} last action`);
  console.log(`  ${label}: safe areas, title and actions OK`);
}

async function hud(label) {
  const selectors = ['#btn-back', '#game-coins-chip', '.levelpill', '#btn-restart', '#btn-settings-game'];
  const boxes = await Promise.all(selectors.map(rect));
  const width = page.viewportSize().width;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    assert(box.x >= -1 && box.x + box.width <= width + 1, `${label}: ${selectors[i]} overflows viewport`);
    for (let j = i + 1; j < boxes.length; j++) assert(!intersects(box, boxes[j]), `${label}: ${selectors[i]} overlaps ${selectors[j]}`);
    if (selectors[i] !== '.levelpill') {
      assert(box.width >= 39 && box.height >= 35, `${label}: ${selectors[i]} collapsed`);
      await reachable(selectors[i], `${label} ${selectors[i]}`);
    }
  }
  const textFits = await page.locator('.levelpill').evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  assert(textFits, `${label}: level label overflows its pill`);
  const canvas = await rect('#board-host canvas');
  const hudBottom = Math.max(...boxes.map((b) => b.y + b.height));
  const powerbar = await rect('#powerbar');
  assert(canvas.height >= 160 && canvas.width >= 250, `${label}: board lost usable space`);
  assert(canvas.y >= hudBottom - 1 && canvas.y + canvas.height <= powerbar.y + 1, `${label}: board overlaps controls`);
  console.log(`  HUD ${label}: controls fit; board ${Math.round(canvas.width)}×${Math.round(canvas.height)}`);
}

try {
  console.log(`Mobile layout check (${engine.name()}${executablePath ? `: ${executablePath}` : ''})`);
  await page.goto(origin);
  await page.locator('#screen-profile.screen--active').waitFor();
  await page.addStyleTag({ content: '*,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; }' });
  for (const [width, height] of [[320, 568], [375, 350], [393, 852]]) {
    await viewport(width, height);
    await profile(`${width}×${height}`);
  }

  // iOS can shrink/pan only the visual viewport while leaving innerHeight intact.
  // Stub those read-only metrics to exercise the app's actual resize/scroll handlers.
  await viewport(375, 667);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 350 });
    Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 80 });
    window.visualViewport.dispatchEvent(new Event('resize'));
    window.visualViewport.dispatchEvent(new Event('scroll'));
  });
  await settle();
  await profile('visual viewport 350px, panned 80px');
  await page.evaluate(() => {
    delete window.visualViewport.height;
    delete window.visualViewport.offsetTop;
    window.visualViewport.dispatchEvent(new Event('resize'));
    window.visualViewport.dispatchEvent(new Event('scroll'));
  });
  await viewport(393, 852);
  const avatarIds = ['🐱', '🦊', '🐼', '🐸', '🦉', '🐙', '🦄', '🐧'];
  assert.deepEqual(await page.locator('#avatar-grid .avatar').evaluateAll(nodes => nodes.map(n => n.dataset.avatar)), avatarIds);
  assert.equal(await page.locator('#avatar-grid .avatar svg').count(), 8);
  await page.locator('#avatar-grid .avatar').nth(4).click();
  await page.locator('#name-input').fill('Layout Tester');
  await page.locator('#analytics-consent').uncheck();
  await page.locator('#btn-start-profile').click();
  await page.locator('#screen-home.screen--active').waitFor();
  await page.getByRole('button', { name: /^Claim/ }).click();
  // Modal dismissal removes an asynchronous browser-history guard.
  await page.waitForFunction(() => history.state?.cf === 'root');

  // The artwork changes, but existing saves still use the original emoji IDs.
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('chromaflask.save.v1'));
    return saved?.profile?.avatar === '🦉' && saved.login.streak === 1
      && String(saved.coins) === document.querySelector('#home-coins').textContent;
  });
  const beforeEdit = await page.evaluate(() => JSON.parse(localStorage.getItem('chromaflask.save.v1')));
  await page.locator('#home-profile').click();
  await page.getByRole('button', { name: 'Change look', exact: true }).click();
  assert.equal(await page.locator('.avatar[aria-checked="true"]').getAttribute('data-avatar'), '🦉');
  assert(await page.locator('#btn-guest').isHidden(), 'Editing should hide the guest button');
  await page.locator('#avatar-grid .avatar').nth(1).click();
  await page.locator('#name-input').fill('');
  await page.locator('#btn-start-profile').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('chromaflask.save.v1'))?.profile?.avatar === '🦊');
  const afterEdit = await page.evaluate(() => JSON.parse(localStorage.getItem('chromaflask.save.v1')));
  assert.deepEqual(afterEdit.profile, { ...beforeEdit.profile, avatar: '🦊' }, 'Changing an avatar must preserve profile identity');
  assert.equal(afterEdit.coins, beforeEdit.coins, 'Editing must preserve coins');
  assert.deepEqual(afterEdit.levels, beforeEdit.levels, 'Editing must preserve progress');
  await page.reload();
  await page.locator('#screen-home.screen--active').waitFor();
  await page.addStyleTag({ content: '*,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; }' });
  assert.equal(await page.locator('#home-avatar').getAttribute('data-avatar'), '🦊');
  const avatarBox = await rect('#home-avatar svg');
  const frameBox = await rect('#home-profile');
  assert(avatarBox.width >= 12 && avatarBox.height >= 12 && avatarBox.x >= frameBox.x && avatarBox.y >= frameBox.y
    && avatarBox.x + avatarBox.width <= frameBox.x + frameBox.width && avatarBox.y + avatarBox.height <= frameBox.y + frameBox.height,
  'Home avatar must have visible dimensions and fit inside its frame');
  await page.locator('#home-profile').click();
  await page.getByRole('button', { name: 'Change look', exact: true }).click();
  assert.equal(await page.locator('.avatar[aria-checked="true"]').getAttribute('data-avatar'), '🦊');
  await page.locator('#btn-start-profile').click();
  console.log('  avatars: original IDs, selection, profile identity, dimensions and reload OK');

  const notched = { top: 59, bottom: 34, left: 0, right: 0 };
  for (const [width, height, insets] of [[320, 568, notched], [393, 852, notched], [667, 375, { top: 0, bottom: 21, left: 59, right: 59 }]]) {
    await viewport(width, height, insets);
    await page.locator('#btn-settings-home').click();
    await dialog(`Settings ${width}×${height}`, insets);
    await page.keyboard.press('Escape');
    await page.locator('#home-profile').click();
    await page.getByRole('button', { name: 'Achievements', exact: true }).click();
    await dialog(`Achievements ${width}×${height}`, insets);
    await page.locator('.modal__x').click();
  }

  await viewport(320, 568);
  await page.locator('#btn-play').click();
  await page.locator('#screen-game.screen--active').waitFor();
  await page.locator('#board-host canvas').waitFor();
  await page.locator('#coach-skip').click();
  await page.waitForFunction(() => document.querySelector('#levelintro').hidden);
  await hud('320×568 initial');

  // Test-only labels stress the real HUD without altering stored progress/economy.
  const original = await page.evaluate(() => ['game-level-label', 'game-move-label', 'game-coins'].map((id) => document.getElementById(id).textContent));
  for (const width of [320, 360, 393, 402, 430, 768]) {
    await viewport(width, 700);
    for (const coins of ['12345', '123456789']) {
      await page.evaluate((coins) => {
        document.getElementById('game-level-label').textContent = 'Tägliche Herausforderung';
        document.getElementById('game-move-label').textContent = '123 Züge · 12 bis ★★';
        document.getElementById('game-coins').textContent = coins;
      }, coins);
      await settle();
      await hud(`${width}px, ${coins} coins, long labels`);
    }
  }
  await page.evaluate((values) => ['game-level-label', 'game-move-label', 'game-coins'].forEach((id, i) => { document.getElementById(id).textContent = values[i]; }), original);
  await viewport(320, 568);
  await page.locator('#btn-settings-game').click();
  await page.locator('.modal').waitFor();
  await page.keyboard.press('Escape');
  // Production keyboard controls select bottle 1 and pour into empty bottle 3.
  await page.keyboard.press('1');
  await page.keyboard.press('3');
  await page.waitForFunction(() => /^1 move\b/.test(document.querySelector('#game-move-label').textContent));
  await page.locator('#btn-undo').click();
  await page.waitForFunction(() => /^0 moves\b/.test(document.querySelector('#game-move-label').textContent));
  console.log('  gameplay: Settings opens; pour and Undo work after resizing');
  assert.deepEqual(failures, [], 'App errors or missing built assets');
  console.log('Mobile layout checks passed.');
} catch (error) {
  console.error('Layout diagnostics:', await page.evaluate(() => ({
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight, top: visualViewport.offsetTop, left: visualViewport.offsetLeft },
    elements: ['#app', '.modal-root', '.modal', '#btn-settings-home', '#home-avatar'].map(selector => {
      const n = document.querySelector(selector);
      if (!n) return {selector};
      return {selector, box:n.getBoundingClientRect().toJSON(), scrollLeft:n.scrollLeft, scrollWidth:n.scrollWidth, clientWidth:n.clientWidth};
    }),
  })));
  throw error;
} finally {
  await browser.close();
}
