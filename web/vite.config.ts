/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './sw-plugin.ts';

const server = 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), serviceWorker()],
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
    // Run every test in UTC, like CI, so code that relies on the machine's time zone fails here too
    // (Saldo shows times in Europe/Brussels, analysis 5.1).
    env: { TZ: 'UTC' },
  },
});
