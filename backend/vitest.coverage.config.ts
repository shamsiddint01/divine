import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';
import dbConfig from './vitest.db.config.ts';
import unitConfig from './vitest.config.ts';

/**
 * Coverage hisoboti (`pnpm coverage`, Phase 15, TESTING.md §3): unit, e2e va DB (real PostgreSQL 18 +
 * Redis, Testcontainers) testlari bitta o'lchovda — service'lar asosan DB testlari orqali tekshiriladi.
 * Chegaralar: domain (framework'siz qoidalar) ≥ 90%, service ≥ 80% (DEVELOPMENT-PLAN, Phase 15).
 * Docker talab qiladi; `test`/`test:db` dan alohida.
 */
const DOMAIN = [
  'src/common/time/**/*.ts',
  'src/common/query/list-query.ts',
  'src/common/errors/**/*.ts',
  'src/common/auth/access-context.ts',
  'src/modules/auth/password/**/*.ts',
];
const SERVICE = ['src/modules/**/*.service.ts'];
const THRESHOLD_DOMAIN = { statements: 90, branches: 90, functions: 90, lines: 90 };
const THRESHOLD_SERVICE = { statements: 80, branches: 80, functions: 80, lines: 80 };

export default mergeConfig(
  defineConfig({ plugins: [swc.vite()] }),
  defineConfig({
    test: {
      include: [...(unitConfig.test?.include ?? []), ...(dbConfig.test?.include ?? [])],
      environment: 'node',
      globalSetup: dbConfig.test?.globalSetup,
      fileParallelism: false,
      testTimeout: 60_000,
      hookTimeout: 240_000,
      env: unitConfig.test?.env,
      coverage: {
        provider: 'v8',
        include: [...DOMAIN, ...SERVICE],
        reporter: ['text', 'text-summary', 'json-summary', 'html'],
        reportsDirectory: 'coverage',
        // Har bir guruh yig'indisi bo'yicha (fayl bo'yicha emas).
        thresholds: {
          [`{${DOMAIN.join(',')}}`]: THRESHOLD_DOMAIN,
          [`{${SERVICE.join(',')}}`]: THRESHOLD_SERVICE,
        },
      },
    },
  }),
);
