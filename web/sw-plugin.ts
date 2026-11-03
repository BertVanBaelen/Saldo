// Builds dist/sw.js from the hand-written sw/sw.js: fills in the list of app-shell files of this build
// and a version derived from their content, so a new release replaces the old cache.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// Files from public/ that belong to the app shell (the bundle's own files are added automatically).
export const PUBLIC_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/theme-init.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export function serviceWorker(): Plugin {
  return {
    name: 'saldo-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const files: string[] = [];
      for (const [name, item] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (name.endsWith('.map')) continue;
        hash.update(name);
        hash.update(item.type === 'chunk' ? item.code : item.source);
        // Dutch text needs only the latin font subsets; the others load on demand when online.
        if (/\.woff2$/.test(name) && !/-latin(-ext)?-/.test(name)) continue;
        if (name !== 'index.html') files.push('/' + name);
      }
      for (const f of PUBLIC_SHELL) {
        if (f === '/') continue;
        hash.update(f);
        hash.update(readFileSync(here('./public' + f)));
      }
      const template = readFileSync(here('./sw/sw.js'), 'utf8');
      const source = template
        .replace('__SW_VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__SW_FILES__', JSON.stringify([...PUBLIC_SHELL, ...files], null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
