// Renders the PWA icons from the design's app icon (finance-mockup/img) into public/icons.
// Run with `npm run icons` after changing the icon; the PNGs are committed.
//   icon-192.png, icon-512.png  Android: the round variant (app-icon-round.svg)
//   icon-maskable-512.png       Android adaptive icon: full-bleed green, glyph inside the safe zone
//   apple-touch-icon.png (180)  iPhone: full square, iOS rounds the corners itself
// favicon.svg is copied as is.
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const src = at('../../finance-mockup/img/');
const out = at('../public/icons/');

const round = await readFile(src + 'app-icon-round.svg', 'utf8');
const square = await readFile(src + 'app-icon.svg', 'utf8');

// The glyph (coin, wallet, clasp) is everything after the background shape.
const glyph = square.replace(/^[\s\S]*?<rect width="96" height="96"[^>]*\/>/, '').replace(/<\/svg>\s*$/, '');
const full = (inner) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
  '<rect width="96" height="96" fill="#15803D"/>' + inner + '</svg>';

const jobs = [
  ['icon-192.png', round, 192],
  ['icon-512.png', round, 512],
  // Safe zone of a maskable icon: a centred circle of 80 % of the size. Scale the glyph to 80 %.
  ['icon-maskable-512.png', full('<g transform="translate(9.6 9.6) scale(0.8)">' + glyph + '</g>'), 512],
  ['apple-touch-icon.png', full(glyph), 180],
];

await mkdir(out, { recursive: true });
for (const [name, svg, size] of jobs) {
  await sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 96) * 2 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out + name);
  console.log('icons/' + name, size + 'x' + size);
}
await copyFile(src + 'favicon.svg', at('../public/favicon.svg'));
console.log('favicon.svg');
