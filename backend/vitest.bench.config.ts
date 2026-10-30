import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Hisobotlar performance benchmark'i (`pnpm bench:reports`, REQ-167, D-21 (4)): 1 mln sotuvli seed,
 * `EXPLAIN (ANALYZE, BUFFERS)` va HTTP vaqtlari. Doimiy test to'plamiga (`test`, `test:db`) va CI'ga
 * kirmaydi — bir necha daqiqa davom etadi va Docker talab qiladi.
 */
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/bench/**/*.bench-spec.ts'],
    environment: 'node',
    globalSetup: ['test/db/support/global-setup.ts'],
    fileParallelism: false,
    // Natijalar jadvali (console.table) testlar o'tganda ham ko'rsatilsin.
    silent: false,
    testTimeout: 600_000,
    hookTimeout: 1_800_000,
    env: {
      NODE_ENV: 'test',
    },
  },
});
