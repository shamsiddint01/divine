import { defineConfig } from '@playwright/test';

/**
 * Playwright E2E (Phase 15, TESTING.md §4): asosiy oqimlar haqiqiy backend va toza DB bilan
 * (`e2e/global-setup.ts`). Brauzer — tizimdagi Google Chrome (`channel: 'chrome'`), alohida yuklab
 * olinmaydi. Ishga tushirish: `pnpm --filter @divine/frontend e2e` (Docker kerak).
 */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // Oqimlar bitta DB'da ketma-ket ma'lumot yaratadi; login rate limit (10/daq/IP) ham umumiy.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:5190',
    channel: 'chrome',
    headless: true,
    locale: 'uz-UZ',
    timezoneId: 'Asia/Tashkent',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
