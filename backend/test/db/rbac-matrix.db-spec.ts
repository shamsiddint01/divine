import { randomUUID } from 'node:crypto';
import { RoleCode } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  ORIGIN,
  uniqueIp,
} from './support/auth-app.js';
import { closePool } from './support/db.js';
import { allowed, discoverRoutes, type RouteInfo } from './support/routes.js';

/*
 * AC-18 / REQ-011, REQ-012, REQ-144 (Phase 15): endpoint × rol matritsasi. Endpointlar Nest
 * metadata'sidan topiladi (qo'lda ro'yxat emas) va har biri haqiqiy HTTP so'rovi bilan chaqiriladi:
 *   - token'siz → 401 (Public'dan tashqari hammasi);
 *   - rolda kerakli permission yo'q → 403 FORBIDDEN (guard, body tekshiruvidan oldin);
 *   - permission bor → guard o'tkazadi (401/403 FORBIDDEN emas; keyin 400/404/200 — biznes mantiqi).
 * Kutilgan natija `ROLE_PERMISSIONS`dan (DB seed manbai) hisoblanadi; ruxsatlar esa ishlayotgan
 * ilovada DB'dagi `role_permissions`dan o'qiladi — ikkalasi mos bo'lmasa test yiqiladi.
 * Qo'shimcha: USER kira oladigan endpointlar ro'yxati quyida aniq yozilgan (RBAC.md §3 bilan
 * ko'rib chiqilgan: guruh/ombor tafsiloti va ombor qoldig'i — faqat ADMIN) — permission yoki endpoint
 * o'zgarsa, bu ro'yxat ongli ravishda yangilanadi.
 */
const USER_ALLOWED = [
  'GET /auth/me',
  'GET /customers',
  'GET /dashboard/my-summary',
  'GET /expense-categories',
  'GET /expenses',
  'GET /expenses/:id',
  'GET /product-groups',
  'GET /products',
  'GET /products/:id',
  'GET /products/lookup',
  'GET /sales',
  'GET /sales/:id',
  'GET /warehouses',
  'POST /customers',
  'POST /expense-categories',
  'POST /expenses',
  'POST /sales',
].sort();

const PASSWORD = '582913';
let t: AuthTestApp;
const tokens: Record<RoleCode, string> = { ADMIN: '', USER: '' };

/** `:id` kabi parametrlar — mavjud bo'lmagan UUID (guard'dan o'tsa 404/400, yon ta'sir yo'q). */
function call(route: RouteInfo, token: string | null) {
  const url = `/api/v1${route.path.replace(/:[A-Za-z]+/g, () => randomUUID())}`;
  const req = request(t.app.getHttpServer())[route.method](url).set('X-Forwarded-For', uniqueIp());
  if (token) req.set('Authorization', `Bearer ${token}`);
  // Cookie endpointlari (refresh, logout) CSRF'ni tekshiradi (SECURITY §9) — brauzer kabi so'rov.
  if (route.security.kind === 'public')
    req.set('Origin', ORIGIN).set('X-Requested-With', 'XMLHttpRequest');
  return route.method === 'get' ? req : req.send({});
}

let routes: RouteInfo[];

beforeAll(async () => {
  t = await createAuthApp();
  for (const role of [RoleCode.ADMIN, RoleCode.USER]) {
    const user = await createUser(t, { password: PASSWORD, role });
    tokens[role] = (
      await login(t, { login: user.login, password: PASSWORD }).expect(200)
    ).body.accessToken;
  }
  routes = discoverRoutes(t.app);
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('RBAC matritsasi: har bir endpoint × rol (AC-18, REQ-011, REQ-012, REQ-144)', () => {
  it('endpointlar topildi; USER kira oladiganlar — aniq kelishilgan ro‘yxat', () => {
    expect(routes.length).toBeGreaterThan(60);
    const userAllowed = routes
      .filter((r) => r.security.kind !== 'public' && allowed(RoleCode.USER, r.security))
      .map((r) => r.key)
      .sort();
    expect(userAllowed).toEqual(USER_ALLOWED);
  });

  it('token’siz: Public’dan tashqari har bir endpoint → 401', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.security.kind !== 'public')) {
      const res = await call(route, null);
      if (res.status !== 401) failures.push(`${route.key} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('USER: ruxsat yo‘q endpointlar → 403 FORBIDDEN; ruxsat borlari guard’dan o‘tadi', async () => {
    const failures: string[] = [];
    for (const route of routes) {
      const res = await call(route, tokens.USER);
      const forbidden = res.status === 403 && res.body?.error?.code === 'FORBIDDEN';
      const expectAllowed = allowed(RoleCode.USER, route.security);
      // Public endpointning o'z 401'i (masalan, refresh cookie'siz) — guard rad etgani emas.
      const unauthorized = res.status === 401 && route.security.kind !== 'public';
      if (expectAllowed && (forbidden || unauthorized)) {
        failures.push(`${route.key}: ruxsat kutilgan, ${res.status} ${res.body?.error?.code}`);
      }
      if (!expectAllowed && !forbidden) {
        failures.push(
          `${route.key}: 403 FORBIDDEN kutilgan, ${res.status} ${res.body?.error?.code}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it('ADMIN: hech bir endpoint guard tomonidan rad etilmaydi', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.key !== 'POST /auth/logout')) {
      const res = await call(route, tokens.ADMIN);
      const unauthorized = res.status === 401 && route.security.kind !== 'public';
      if (unauthorized || (res.status === 403 && res.body?.error?.code === 'FORBIDDEN')) {
        failures.push(`${route.key} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
