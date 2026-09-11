import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Prevent Vite from auto-discovering the project's postcss.config.mjs (Tailwind v4
  // plugin, meant for Next's build pipeline) - tests run in Node and never need CSS.
  css: {
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
