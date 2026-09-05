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

for (const file of files) {
  const out = join(OUT, `${parse(file).name}.webp`);
  const image = sharp(join(SRC, file));
  const meta = await image.metadata();
  // 1170px is enough for a 390pt phone at 3x; larger sources are downscaled.
  const resized = meta.width > 1170 ? image.resize({ width: 1170 }) : image;
  const info = await resized.webp({ quality: 82 }).toFile(out);
  console.log(`${file} -> ${out}  ${(info.size / 1024).toFixed(0)} KB (${info.width}x${info.height})`);
}
