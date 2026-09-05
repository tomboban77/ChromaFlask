/**
 * Renders the SVG icon sources in art/ to the PNG set the stores and
 * manifest need. Run after changing art/icon*.svg:  node scripts/make-icons.mjs
 */
import sharp from 'sharp';
import { copyFileSync } from 'node:fs';

const JOBS = [
  { src: 'art/icon.svg', out: 'public/icon-192.png', size: 192 },
  { src: 'art/icon.svg', out: 'public/icon-512.png', size: 512 },
  { src: 'art/icon.svg', out: 'public/apple-touch-icon.png', size: 180 },
  { src: 'art/icon-maskable.svg', out: 'public/icon-maskable-192.png', size: 192 },
  { src: 'art/icon-maskable.svg', out: 'public/icon-maskable-512.png', size: 512 },
];

for (const { src, out, size } of JOBS) {
  const info = await sharp(src, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`${src} -> ${out}  ${(info.size / 1024).toFixed(0)} KB (${size}x${size})`);
}

// The favicon is the plain (rounded-rect) icon, served as crisp SVG.
copyFileSync('art/icon.svg', 'public/icon.svg');
console.log('art/icon.svg -> public/icon.svg (favicon)');
