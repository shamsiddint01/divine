import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS DI decorator metadata'ga tayanadi — esbuild buni bermaydi, shuning uchun SWC (.swcrc).
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    environment: 'node',
    // Testlar uchun minimal, xavfsiz env. Haqiqiy DB/Redis talab qiladigan integration testlar
    // Phase 3'dan boshlab Testcontainers orqali o'z env'ini beradi.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://divine:divine@localhost:5434/divine_test',
      REDIS_URL: 'redis://localhost:6381',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789-abcdefghij',
      PASSWORD_PEPPER: 'test-password-pepper-0123456789-abcdefghij',
      SWAGGER_ENABLED: 'true',
    },
  },
});
