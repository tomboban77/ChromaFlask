/**
 * Converts source art in art/ to optimized WebP in public/.
 * Run after adding or replacing any painted art:  node scripts/optimize-art.mjs
 */
import sharp from 'sharp';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, parse } from 'node:path';

const SRC = 'art';
const OUT = 'public';

mkdirSync(SRC, { recursive: true });
const files = readdirSync(SRC).filter((f) => /\.(png|jpe?g)$/i.test(f));
if (files.length === 0) {
  console.log('no source art in art/ - nothing to do');
  process.exit(0);
}

/**
 * Per-image settings. Every one of these is on the critical path before the
 * first screen paints, so bytes matter more than the last notch of quality:
 *  - logo: displayed at most 360 CSS px wide, so 1080 px covers 3x screens.
 *  - Entry/home: full-bleed painted backgrounds; soft gradients compress well.
 */
const SETTINGS = {
  logo: { width: 1080, quality: 72 },
  Entry: { width: 1170, quality: 74 },
  home: { width: 1170, quality: 74 },
  // Aspect variants: 9:20 splash for tall phones, 3:4 home for tablets.
  'Entry-tall': { width: 1170, quality: 74 },
  'home-wide': { width: 1536, quality: 74 },
};
const DEFAULT = { width: 1170, quality: 80 };

for (const file of files) {
  const name = parse(file).name;
  const out = join(OUT, `${name}.webp`);
  const { width, quality } = SETTINGS[name] ?? DEFAULT;
  const image = sharp(join(SRC, file));
  const meta = await image.metadata();
  const resized = meta.width > width ? image.resize({ width }) : image;
  const info = await resized.webp({ quality }).toFile(out);
  console.log(`${file} -> ${out}  ${(info.size / 1024).toFixed(0)} KB (${info.width}x${info.height}, q${quality})`);
}
