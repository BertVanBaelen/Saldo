/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import optimizeLocales from '@react-aria/optimize-locales-plugin';
import { serviceWorker } from './sw-plugin.ts';

const server = 'http://localhost:8080';

export default defineConfig({
  // Tailwind only builds the prefixed utilities of web/src/ui/ui.css (phase 0.8-5a); the existing CSS is untouched.
  // React Aria ships its strings for ~35 languages; keep Dutch (nl-BE falls back to nl-NL) and the en-US default.
  plugins: [react(), tailwindcss(), { ...optimizeLocales.vite({ locales: ['nl-NL', 'en-US'] }), enforce: 'pre' }, serviceWorker()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: server, changeOrigin: false },
      '/healthz': { target: server, changeOrigin: false },
    },
  },
  preview: { port: 5180, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // The default 5 s is too short for a busy machine or a loaded CI runner: unrelated tests then time out.
    testTimeout: 15000,
    // Run every test in UTC, like CI, so code that relies on the machine's time zone fails here too
    // (Saldo shows times in Europe/Brussels, analysis 5.1).
    env: { TZ: 'UTC' },
  },
});
