/**
 * Grabs a screenshot off the connected Android device and writes a
 * Play-ready copy next to it.
 *
 *   node scripts/play-shots.mjs 02-board
 *
 * Phone screenshots on Play must sit between 16:9 and 9:16; a modern phone
 * panel is 9:20, so a raw capture is rejected for being too tall. We trim the
 * OS status bar and the gesture pill (neither belongs in a store shot) and pad
 * the sides to an exact 9:16 in the game's own deep purple, so the bars read as
 * framing rather than as letterboxing.
 *
 * Output: store/shot-<name>.png (raw) and store/play-<name>.png (upload this).
 */
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PAD = '#3d1a82'; // --purple-deep in src/styles/main.css
const STATUS_BAR = 60; // px trimmed off the top at 1080 wide
const GESTURE_PILL = 52; // px trimmed off the bottom
const OUT = 'store';

const name = process.argv[2];
if (!name) {
  console.error('usage: node scripts/play-shots.mjs <name>   e.g. 02-board');
  process.exit(1);
}

/** adb is not on PATH in a default Android Studio install. */
function findAdb() {
  if (process.env.ANDROID_HOME) {
    const p = join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe');
    if (existsSync(p)) return p;
  }
  const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
  const guess = join(home, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
  if (existsSync(guess)) return guess;
  return 'adb'; // hope it is on PATH (Linux/macOS)
}

mkdirSync(OUT, { recursive: true });
const raw = join(OUT, `shot-${name}.png`);
const out = join(OUT, `play-${name}.png`);

// maxBuffer: a 1080x2400 PNG is a few MB, well over execFileSync's default.
const png = execFileSync(findAdb(), ['exec-out', 'screencap', '-p'], {
  maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(raw, png);

const meta = await sharp(raw).metadata();
const height = meta.height - STATUS_BAR - GESTURE_PILL;
const width = Math.round((height * 9) / 16);
if (width < meta.width) {
  console.error(
    `capture is ${meta.width}x${meta.height}: wider than 9:16 after trimming, ` +
      'so padding would not help. Crop it by hand.',
  );
  process.exit(1);
}
const side = Math.round((width - meta.width) / 2);

await sharp(raw)
  .extract({ left: 0, top: STATUS_BAR, width: meta.width, height })
  .extend({ left: side, right: width - meta.width - side, background: PAD })
  .png({ compressionLevel: 9 })
  .toFile(out);

const o = await sharp(out).metadata();
console.log(`${out}  ${o.width}x${o.height}  ratio ${(o.height / o.width).toFixed(3)} (9:16 = 1.778)`);
