import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // `pnpm coverage` (Phase 15, TESTING.md §3): shared — sof domain qoidalari (validatsiya, ruxsatlar,
    // hisobot ta'riflari, xato kodlari), chegara ≥ 90% (DEVELOPMENT-PLAN Phase 15).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
