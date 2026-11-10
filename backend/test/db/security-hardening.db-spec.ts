import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  ORIGIN,
  refreshCookieOf,
  uniqueIp,
  uniqueLogin,
} from './support/auth-app.js';
import { closePool } from './support/db.js';

/*
 * Phase 16 (SECURITY §18): production rejimidagi header'lar (HSTS bilan) va Swagger, refresh rate
 * limit (Phase 4 da alohida testi yo'q edi), login enumeration — javob va VAQT bir xil.
 */
const PASSWORD = '417306';
let prod: AuthTestApp;

beforeAll(async () => {
  // Production sozlamalari (config validatsiyasidan keyin almashtiriladi — faqat header/Swagger xulqi).
  prod = await createAuthApp({ config: { NODE_ENV: 'production', SWAGGER_ENABLED: false } });
});

afterAll(async () => {
  await prod?.close();
  await closePool();
});

describe('production header’lari (securityheaders darajasi, SECURITY §12)', () => {
  const EXPECTED: Record<string, RegExp> = {
    'strict-transport-security': /^max-age=\d{8,}; includeSubDomains$/,
    'content-security-policy': /^default-src 'none';\s*frame-ancestors 'none'$/,
    'x-content-type-options': /^nosniff$/,
    'x-frame-options': /^SAMEORIGIN$/,
    'referrer-policy': /^no-referrer$/,
    'cross-origin-resource-policy': /^same-site$/,
    'cross-origin-opener-policy': /^same-origin$/,
  };

  it('muvaffaqiyatli, xato (401, 404, 400) va health javoblarida — bir xil to‘plam; X-Powered-By yo‘q', async () => {
    const http = () => request(prod.app.getHttpServer());
    const responses = [
      await http().get('/api/v1/health'),
      await http().get('/api/v1/auth/me'),
      await http().get('/api/v1/yoq-endpoint'),
      await login(prod, { login: 'a b', password: '1' }),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 401, 404, 400]);
    for (const [i, res] of responses.entries()) {
      for (const [header, pattern] of Object.entries(EXPECTED)) {
        expect(res.headers[header], `#${i} ${res.status} ${header}`).toMatch(pattern);
      }
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.text).not.toMatch(/\bat \w+ \(|node_modules|\.ts:\d+/);
    }
  });

  it('biznes javoblari (shaxsiy ma’lumot, kelgan narxi, hisobot) brauzer keshiga yozilmaydi: Cache-Control: no-store', async () => {
    const admin = await createUser(prod, { password: PASSWORD, role: 'ADMIN' });
    const token = (await login(prod, { login: admin.login, password: PASSWORD }).expect(200)).body
      .accessToken as string;
    for (const path of [
      '/api/v1/auth/me',
      '/api/v1/customers',
      '/api/v1/products',
      '/api/v1/users',
      '/api/v1/audit-logs',
      '/api/v1/reports/sales?dateFrom=2026-10-01&dateTo=2026-10-31',
      '/api/v1/dashboard/summary',
    ]) {
      const res = await request(prod.app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', uniqueIp())
        .expect(200);
      expect(res.headers['cache-control'], path).toBe('no-store');
    }
  });

  it('Swagger production’da o‘chiq (/api/docs → 404)', async () => {
    await request(prod.app.getHttpServer()).get('/api/docs').expect(404);
    await request(prod.app.getHttpServer()).get('/api/docs-json').expect(404);
  });

  it('refresh cookie: HttpOnly, Secure, SameSite=Strict, faqat /api/v1/auth yo‘lida', async () => {
    const user = await createUser(prod, { password: PASSWORD });
    const res = await login(prod, { login: user.login, password: PASSWORD }).expect(200);
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('dv_refresh='))!;
    const attributes = cookie.split(';').map((p) => p.trim());
    expect(attributes).toEqual(
      expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/v1/auth']),
    );
    expect(attributes.find((a) => a.startsWith('Domain='))).toBeUndefined();
  });
});

describe('refresh rate limit (SECURITY §7)', () => {
  it('POST /auth/refresh — 30/daq/IP: 31-so‘rov 429 + Retry-After; boshqa IP ta’sirlanmaydi', async () => {
    const ip = uniqueIp();
    const call = (from: string) =>
      request(prod.app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('X-Forwarded-For', from)
        .set('Origin', ORIGIN)
        .set('X-Requested-With', 'XMLHttpRequest');
    for (let i = 0; i < 30; i++) await call(ip).expect(401); // cookie'siz — SESSION_EXPIRED
    const limited = await call(ip).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await call(uniqueIp()).expect(401);
  });

  it('cookie bilan ham xuddi shu limit (haqiqiy sessiya rotatsiyasi ham hisoblanadi)', async () => {
    const user = await createUser(prod, { password: PASSWORD });
    let cookie = refreshCookieOf(
      await login(prod, { login: user.login, password: PASSWORD }).expect(200),
    );
    const ip = uniqueIp();
    for (let i = 0; i < 30; i++) {
      const res = await request(prod.app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('X-Forwarded-For', ip)
        .set('Origin', ORIGIN)
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie)
        .expect(200);
      cookie = refreshCookieOf(res);
    }
    await request(prod.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('X-Forwarded-For', ip)
      .set('Origin', ORIGIN)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', cookie)
      .expect(429);
  });
});

describe('login enumeration (SECURITY §1, §18)', () => {
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };

  it('mavjud login + noto‘g‘ri parol va mavjud bo‘lmagan login: javob tanasi, header’lar va vaqt bir xil', async () => {
    const users = await Promise.all(
      Array.from({ length: 6 }, () => createUser(prod, { password: PASSWORD })),
    );
    const time = async (body: object) => {
      const started = performance.now();
      const res = await login(prod, body).expect(401);
      return { ms: performance.now() - started, res };
    };
    // Isitish (argon2 va DB ulanishlari).
    await time({ login: uniqueLogin('isit'), password: '000000' });
    const known: number[] = [];
    const unknown: number[] = [];
    const shapes = new Set<string>();
    // Navbatma-navbat — mashina yuklamasi ikkala guruhga teng ta'sir qilsin.
    for (const user of users) {
      const a = await time({ login: user.login, password: '000000' });
      const b = await time({ login: uniqueLogin('yoq'), password: '000000' });
      known.push(a.ms);
      unknown.push(b.ms);
      for (const { res } of [a, b]) {
        shapes.add(
          JSON.stringify({
            status: res.status,
            code: res.body.error.code,
            message: res.body.error.message,
            keys: Object.keys(res.body.error).sort(),
            headers: Object.keys(res.headers)
              .filter((h) => !['date', 'x-request-id', 'etag', 'content-length'].includes(h))
              .filter((h) => !h.startsWith('x-ratelimit'))
              .sort(),
          }),
        );
      }
    }
    expect([...shapes]).toHaveLength(1);
    // Ikkala yo'lda ham argon2 tekshiruvi (mahalliy ~170–210 ms, tez CI serverida ~40 ms) — farq shundan
    // ancha kichik bo'lishi kerak. Tekshiruvsiz yo'l 1–3 ms bo'lardi: 20 ms chegara shuni ushlaydi.
    const [k, u] = [median(known), median(unknown)];
    expect(Math.min(k, u)).toBeGreaterThan(20);
    expect(Math.abs(k - u) / Math.max(k, u)).toBeLessThan(0.35);
  });
});
