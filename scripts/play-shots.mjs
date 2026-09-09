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
const OUT = 'store';
/**
 * The system bars render light on this device while the game is dark, so the
 * bars are found by luminance rather than by a hardcoded height - a fixed trim
 * leaves a white sliver whenever the bar is a pixel or two taller than
 * expected. Anything brighter than this counts as system chrome.
 */
const CHROME_LUMA = 200;

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

/** Rows of system chrome at the top and bottom of a capture. */
async function findChrome(file, meta) {
  const { data } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rowLuma = (y) => {
    let sum = 0;
    for (let x = 0; x < meta.width; x++) sum += data[y * meta.width + x];
    return sum / meta.width;
  };
  let top = 0;
  while (top < meta.height && rowLuma(top) > CHROME_LUMA) top++;
  let bottom = 0;
  while (bottom < meta.height && rowLuma(meta.height - 1 - bottom) > CHROME_LUMA) bottom++;
  return { top, bottom };
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
const { top, bottom } = await findChrome(raw, meta);
const height = meta.height - top - bottom;
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
  .extract({ left: 0, top, width: meta.width, height })
  .extend({ left: side, right: width - meta.width - side, background: PAD })
  .png({ compressionLevel: 9 })
  .toFile(out);

const o = await sharp(out).metadata();
console.log(`${out}  ${o.width}x${o.height}  ratio ${(o.height / o.width).toFixed(3)} (9:16 = 1.778)`);
