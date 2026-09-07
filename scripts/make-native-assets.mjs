/**
 * Renders the launcher icons and splash screens for the Capacitor projects
 * from the repo's own art, so the store apps never ship the template robot.
 *
 *   node scripts/make-native-assets.mjs
 *
 * Sources (all in art/):
 *   icon.svg           rounded-square icon  -> Android legacy ic_launcher
 *   icon-maskable.svg  full-bleed icon      -> iOS icon (Apple applies the
 *                                             mask), Android round icon, and
 *                                             the adaptive-icon foreground
 *                                             (background stripped, content
 *                                             fitted to the 66/108 safe zone)
 *   Entry.png          the game's own boot art -> every splash, cover-cropped,
 *                                             so the native splash hands over
 *                                             to the web boot screen seamlessly
 *
 * Run again after changing any of those; the outputs are committed.
 */
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const ANDROID_RES = 'android/app/src/main/res';
const IOS_ASSETS = 'ios/App/App/Assets.xcassets';

/** Icon background gradient, identical to art/icon*.svg's `bg`. */
const BG_TOP = '#b06ef0';
const BG_MID = '#7a3fd0';
const BG_BOTTOM = '#57249c';

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
/** Capacitor's splash set: {qualifier: [w, h]}. Portrait-locked app, but the
 *  template ships both orientations, so both are kept in step. */
const SPLASHES = {
  'drawable': [480, 320],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
};

const written = [];
async function save(pipeline, out) {
  mkdirSync(dirname(out), { recursive: true });
  const info = await pipeline.png().toFile(out);
  written.push(`${out} ${info.width}x${info.height}`);
}

const svg = (file) => readFileSync(file, 'utf8');
const renderSvg = (source, size) => sharp(Buffer.from(source), { density: 600 }).resize(size, size);

/** The maskable icon without its background rect: flask, glow and sparkles only. */
function foregroundSvg() {
  const src = svg('art/icon-maskable.svg');
  const stripped = src.replace(/<rect width="512" height="512" fill="url\(#bg\)"\/>\s*/, '');
  if (stripped === src) throw new Error('icon-maskable.svg: background rect not found');
  return stripped;
}

function gradientSvg(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/><stop offset="0.55" stop-color="${BG_MID}"/>
      <stop offset="1" stop-color="${BG_BOTTOM}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
}

function circleMask(size) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
}

// ------------------------------------------------------------------ Android
for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = `${ANDROID_RES}/mipmap-${density}`;
  const legacy = Math.round(48 * scale);
  const adaptive = Math.round(108 * scale);

  // Legacy launcher (pre-Oreo, and the Play listing thumbnail fallback).
  await save(renderSvg(svg('art/icon.svg'), legacy), `${dir}/ic_launcher.png`);

  // Round legacy launcher: full-bleed art under a circle mask.
  const round = await renderSvg(svg('art/icon-maskable.svg'), legacy).png().toBuffer();
  await save(
    sharp(round).composite([{ input: circleMask(legacy), blend: 'dest-in' }]),
    `${dir}/ic_launcher_round.png`,
  );

  // Adaptive foreground: the 512-unit art already keeps its content inside an
  // 80% circle; the adaptive safe zone is 66/108 of the canvas, so render the
  // art at 61% of the foreground size and centre it on transparency.
  const art = Math.round(adaptive * 0.61 / 0.8);
  const fg = await renderSvg(foregroundSvg(), art).png().toBuffer();
  await save(
    sharp({ create: { width: adaptive, height: adaptive, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: fg, gravity: 'centre' }]),
    `${dir}/ic_launcher_foreground.png`,
  );

  // Adaptive background: the same purple gradient as the icon art.
  await save(sharp(Buffer.from(gradientSvg(adaptive, adaptive))), `${dir}/ic_launcher_background.png`);
}

// Point both adaptive icons at the generated background bitmap.
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
for (const name of ['ic_launcher', 'ic_launcher_round']) {
  writeFileSync(`${ANDROID_RES}/mipmap-anydpi-v26/${name}.xml`, adaptiveXml);
  written.push(`${ANDROID_RES}/mipmap-anydpi-v26/${name}.xml`);
}
// The template's teal grid vector is no longer referenced.
const tealVector = `${ANDROID_RES}/drawable/ic_launcher_background.xml`;
if (existsSync(tealVector)) {
  rmSync(tealVector);
  written.push(`${tealVector} (removed)`);
}

// Splash: the boot art, cover-cropped per size.
for (const [qualifier, [w, h]] of Object.entries(SPLASHES)) {
  await save(
    sharp('art/Entry.png').resize(w, h, { fit: 'cover', position: 'centre' }),
    `${ANDROID_RES}/${qualifier}/splash.png`,
  );
}

// ---------------------------------------------------------------------- iOS
// Apple masks the corners itself and rejects alpha: full-bleed art, flattened.
await save(
  renderSvg(svg('art/icon-maskable.svg'), 1024).flatten({ background: BG_BOTTOM }),
  `${IOS_ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`,
);
// The launch storyboard aspect-fills one square image at every scale.
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await save(
    sharp('art/Entry.png').resize(2732, 2732, { fit: 'cover', position: 'centre' }),
    `${IOS_ASSETS}/Splash.imageset/${name}`,
  );
}

for (const line of written) console.log(line);
console.log(`\n${written.length} files`);
