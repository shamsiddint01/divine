import { afterEach, describe, expect, it, vi } from 'vitest';

/** `api-mode` env'ni modul yuklanganda o'qiydi — har holat uchun qayta import. */
async function modeWith(env: { VITE_API_MODE?: string; VITE_AUTH_MODE?: string }) {
  vi.resetModules();
  vi.stubEnv('VITE_API_MODE', env.VITE_API_MODE ?? '');
  vi.stubEnv('VITE_AUTH_MODE', env.VITE_AUTH_MODE ?? '');
  return import('./api-mode');
}

afterEach(() => vi.unstubAllEnvs());

describe('transportFor: qaysi so‘rov qayerga boradi', () => {
  it('standart (mock): hammasi mock', async () => {
    const { transportFor } = await modeWith({});
    expect(['/auth/login', '/users', '/products'].map((path) => transportFor(path))).toEqual([
      'mock',
      'mock',
      'mock',
    ]);
  });

  it('VITE_AUTH_MODE=http: backend’da tayyor modullar (auth, users, katalog, omborlar, inventar, kirim, mijozlar, sotuvlar) — http, qolganlari — mock', async () => {
    const { transportFor } = await modeWith({ VITE_AUTH_MODE: 'http' });
    expect(transportFor('/auth/me')).toBe('http');
    expect(transportFor('/users')).toBe('http');
    expect(transportFor('/users/abc/reset-password')).toBe('http');
    expect(transportFor('/users/warehouse-options')).toBe('http');
    expect(transportFor('/products')).toBe('http');
    expect(transportFor('/products/lookup')).toBe('http');
    expect(transportFor('/product-groups')).toBe('http');
    expect(transportFor('/warehouses')).toBe('http');
    expect(transportFor('/warehouses/abc/movements')).toBe('http');
    expect(transportFor('/inventory/reconciliation')).toBe('http');
    expect(transportFor('/sales')).toBe('http');
    expect(transportFor('/reports/sales')).toBe('http');
    expect(transportFor('/dashboard/summary')).toBe('http');
    expect(transportFor('/products/abc/stock')).toBe('http');
    expect(transportFor('/customers')).toBe('http');
    expect(transportFor('/customers/abc/purchases')).toBe('http');
    expect(transportFor('/credits/reminders')).toBe('http');
    expect(transportFor('/expenses')).toBe('http');
    expect(transportFor('/expenses/abc')).toBe('http');
    expect(transportFor('/expense-categories')).toBe('http');
    expect(transportFor('/reports/expenses')).toBe('http');
    expect(transportFor('/reports/finance-summary')).toBe('http');
    expect(transportFor('/dashboard/my-summary')).toBe('http');
    expect(transportFor('/settings')).toBe('http');
    // Faqat mock: demo ma'lumotlarni tiklash backend'da yo'q.
    expect(transportFor('/__demo/reset')).toBe('mock');
  });

  it('VITE_API_MODE=http: hammasi http', async () => {
    const { transportFor } = await modeWith({ VITE_API_MODE: 'http' });
    expect(['/auth/login', '/users', '/sales'].map((path) => transportFor(path))).toEqual([
      'http',
      'http',
      'http',
    ]);
  });
});
