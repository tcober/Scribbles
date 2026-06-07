import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // Vitest reads this config natively. jsdom gives the dumb-component tests a
  // DOM; the setup file stubs window.api (no Electron preload under test).
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    // Our renderer tests plus the pure main-process helpers — but keep Vitest
    // out of vendored build dirs (e.g. the whisper.cpp checkout ships its own
    // *.spec.js).
    include: ['src/**/*.spec.js', 'electron/**/*.spec.js'],
  },
});
