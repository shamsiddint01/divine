import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * DB testlari (`pnpm test:db`): haqiqiy PostgreSQL 18 (Testcontainers) ga migratsiyalar qo'llanadi,
 * so'ng constraint, trigger, huquq va invariantlar tekshiriladi. Docker talab qiladi.
 * Oddiy `pnpm test` (unit) Docker'siz ishlaydi va bu fayllarni ishga tushirmaydi.
 */
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/db/**/*.db-spec.ts'],
    environment: 'node',
    globalSetup: ['test/db/support/global-setup.ts'],
    // Bitta umumiy DB: fayllar ketma-ket (reconciliation va seed testlari global holatni o'qiydi).
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000,
    env: {
      NODE_ENV: 'test',
    },
  },
});
