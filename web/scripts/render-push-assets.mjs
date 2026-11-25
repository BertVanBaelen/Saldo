// Renders the PNGs that web push and e-mail need, from the frozen design SVGs (0.9-1 and 0.9-2):
//   web/public/icons/badge-96.png        monochrome alpha mask of the status-bar silhouette (Android reads only alpha)
//   web/public/icons/icon-{info,warn,error}.png  the app icon in a ring of the type's colour (large notification icon)
//   server/internal/mail/img/{logo,person,people}.png  the mail logo and the two account icons, at 2x
// Run: `node scripts/render-push-assets.mjs` from web/. The sources are read-only (finance-mockup/ is frozen).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p));

// The notification type colours of the board: green info, ochre warning, red error.
const TONES = { info: '#15803D', warn: '#A15C07', error: '#C62828' };

async function badge() {
  // The silhouette is drawn in near-black; Android only looks at alpha, so any opaque colour works. White is the
  // convention and keeps the file readable when someone opens it.
  const svg = read('../../finance-mockup/img/statusbar-icon.svg').toString('utf8').replace('fill="#121A16"', 'fill="#FFFFFF"');
  const png = await sharp(Buffer.from(svg), { density: 576 }).resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  writeFileSync(here('../public/icons/badge-96.png'), png);
}

async function toneIcons() {
  const size = 192;
  const inner = 160;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><circle cx="${inner / 2}" cy="${inner / 2}" r="${inner / 2}"/></svg>`);
  const app = await sharp(read('../public/icons/icon-512.png')).resize(inner, inner).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  for (const [tone, colour] of Object.entries(TONES)) {
    const ring = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 6}" fill="#FFFFFF" stroke="${colour}" stroke-width="12"/></svg>`,
    );
    const png = await sharp(ring)
      .composite([{ input: app, left: (size - inner) / 2, top: (size - inner) / 2 }])
      .png()
      .toBuffer();
    writeFileSync(here(`../public/icons/icon-${tone}.png`), png);
  }
}

async function mailImages() {
  const dir = here('../../server/internal/mail/img/');
  mkdirSync(dir, { recursive: true });
  // The templates show the logo at 28 px and the white account glyphs at 16 px (on a CSS circle), rendered at 2x for sharp screens.
  const jobs = { logo: 56, person: 32, people: 32 };
  for (const [name, px] of Object.entries(jobs)) {
    const png = await sharp(read(`../../finance-mockup/emails/img/${name}.svg`), { density: 576 }).resize(px, px).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(dir + `${name}.png`, png);
  }
}

await badge();
await toneIcons();
await mailImages();
console.log('push and mail images written');
