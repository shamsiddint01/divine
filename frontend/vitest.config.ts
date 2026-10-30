import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Lazy sahifalarning birinchi yuklanishi (Vite transform) test muhitida bir necha soniya olishi mumkin.
      testTimeout: 30_000,
      // Har bir fayl to'liq ilovani (jsdom + router + mock API) ko'taradi: yadrolar soniga teng ishchi
      // bo'lsa, yuklangan mashinada sahifa kutishlari (15 s) vaqtidan oshib ketadi.
      maxWorkers: '50%',
      // `pnpm coverage` (Phase 15, TESTING.md §3): hisobot butun `src` bo'yicha; chegara (≥ 90%) —
      // frontend domain qoidalari: savat, kirim jami, decimal/format, forma maydonlari, audit metadata.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/__tests__/**', 'src/main.tsx'],
        reporter: ['text-summary', 'json-summary', 'html'],
        thresholds: {
          '{src/features/*/lib/*.ts,src/shared/lib/{decimal,format}.ts,src/shared/forms/fields.ts}':
            {
              statements: 90,
              branches: 90,
              functions: 90,
              lines: 90,
            },
        },
      },
    },
  }),
);
