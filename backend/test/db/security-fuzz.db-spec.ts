import { randomUUID } from 'node:crypto';
import { RoleCode } from '@divine/shared';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenService } from '../../src/modules/auth/token.service.js';
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
 * Phase 16 (DEVELOPMENT-PLAN "RBAC fuzz", SECURITY §18): endpoint ro'yxati Nest metadata'sidan.
 *  1) RBAC fuzz — sotuvchi (USER) ruxsati yo'q har bir endpointga yo'l variantlari (katta harf,
 *     oxirgi `/`, kodlangan belgi, query'da rol/permission), HEAD, method-override header'lari va
 *     soxta/o'zgartirilgan JWT'lar bilan kira olmaydi (hech qachon 2xx emas).
 *  2) Input fuzz — har bir yozuvchi endpointga buzilgan body (massiv, null, buzilgan JSON,
 *     `__proto__`, chuqur obyekt, juda uzun satr, 1e400, boshqaruv belgilari, noma'lum maydonlar),
 *     buzilgan path va query parametrlari: hech qachon 5xx emas, xato javobi yagona shaklda, stack yo'q,
 *     prototype pollution yo'q.
 * Rate limit (yozish 120/daq/user) natijani 429 bilan yashirmasligi uchun tokenlar aylantiriladi.
 */
const PASSWORD = '290457';
let t: AuthTestApp;
let routes: RouteInfo[];
const pool: Record<RoleCode, string[]> = { ADMIN: [], USER: [] };
const turn: Record<RoleCode, number> = { ADMIN: 0, USER: 0 };
let sellerId = '';
const nextToken = (role: RoleCode) => pool[role][turn[role]++ % pool[role].length]!;
const fill = (path: string, value: () => string = randomUUID) =>
  path.replace(/:[A-Za-z]+/g, () => value());

type Method = RouteInfo['method'] | 'head';
function send(
  method: Method,
  url: string,
  opts: { token?: string; body?: string | object; contentType?: string; headers?: object } = {},
) {
  const req = request(t.app.getHttpServer())[method](url).set('X-Forwarded-For', uniqueIp());
  req.set('Origin', ORIGIN).set('X-Requested-With', 'XMLHttpRequest');
  if (opts.token) req.set('Authorization', `Bearer ${opts.token}`);
  for (const [key, value] of Object.entries(opts.headers ?? {})) req.set(key, String(value));
  if (opts.body === undefined || method === 'get' || method === 'head') return req;
  if (typeof opts.body === 'string') {
    return req.set('Content-Type', opts.contentType ?? 'application/json').send(opts.body);
  }
  return req.send(opts.body);
}

/** 4xx javobi API §1.3 shaklida; stack, fayl yo'li va SQL yo'q. */
function badShape(res: request.Response): string | null {
  if (res.status >= 500) return `${res.status} ${res.body?.error?.code}`;
  if (res.status < 400 || res.status === 404) return null;
  const error = res.body?.error;
  if (!error || typeof error.code !== 'string' || typeof error.message !== 'string') {
    return `xato shakli: ${res.text.slice(0, 120)}`;
  }
  if (/\bat \w+ \(|node_modules|\.ts:\d+|SELECT |INSERT |prisma/i.test(res.text)) {
    return `ichki tafsilot: ${res.text.slice(0, 120)}`;
  }
  return null;
}

beforeAll(async () => {
  t = await createAuthApp();
  for (const [role, count] of [
    [RoleCode.ADMIN, 8],
    [RoleCode.USER, 5],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const user = await createUser(t, { password: PASSWORD, role });
      if (role === RoleCode.USER) sellerId = user.id;
      pool[role].push(
        (await login(t, { login: user.login, password: PASSWORD }).expect(200)).body.accessToken,
      );
    }
  }
  routes = discoverRoutes(t.app);
}, 120_000);

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('RBAC fuzz: sotuvchi admin endpointlariga aylanma yo‘l bilan kira olmaydi', () => {
  const denied = () =>
    routes.filter((r) => r.security.kind !== 'public' && !allowed(RoleCode.USER, r.security));

  it('yo‘l variantlari, HEAD va query’dagi rol/permission — hech qachon 2xx emas', async () => {
    const failures: string[] = [];
    // Marshrut kashfiyoti ishlayotganini tekshirish (kirim olib tashlangan, D-23 da sotuvchiga 3 ta xarajat
    // endpointi ochilgan — 2026-11-03 da 48 ta).
    expect(denied().length).toBeGreaterThan(40);
    for (const route of denied()) {
      const path = fill(route.path);
      const encoded = path.replace(/[a-z]/, (c) => `%${c.charCodeAt(0).toString(16)}`);
      const variants: [string, Method, string][] = [
        ['katta harf', route.method, `/API/V1${path.toUpperCase()}`],
        ['oxirida /', route.method, `/api/v1${path}/`],
        ['kodlangan belgi', route.method, `/api/v1${encoded}`],
        [
          'query',
          route.method,
          `/api/v1${path}?role=ADMIN&permissions=users.manage&userId=${randomUUID()}`,
        ],
      ];
      if (route.method === 'get') variants.push(['HEAD', 'head', `/api/v1${path}`]);
      for (const [label, method, url] of variants) {
        const res = await send(method, url, { token: nextToken(RoleCode.USER), body: {} });
        if (res.status < 300 || res.status >= 500) {
          failures.push(`${route.key} [${label}] → ${res.status}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('method-override header’lari e’tiborga olinmaydi (POST /products → GET emas)', async () => {
    for (const header of ['X-HTTP-Method-Override', 'X-HTTP-Method', 'X-Method-Override']) {
      const res = await send('post', '/api/v1/products', {
        token: nextToken(RoleCode.USER),
        body: {},
        headers: { [header]: 'GET' },
      });
      expect(res.status, header).toBe(403);
    }
    // `_method` query/body ham (method-override middleware yo'q).
    const viaQuery = await send('post', '/api/v1/products?_method=GET', {
      token: nextToken(RoleCode.USER),
      body: { _method: 'GET' },
    });
    expect(viaQuery.status).toBe(403);
  });

  it('JWT: to‘g‘ri imzoli, lekin `role: ADMIN` deb yozilgan sotuvchi tokeni ham — ruxsat DB’dan', async () => {
    const tokens = t.app.get(TokenService);
    const forged = await tokens.signAccessToken(
      { userId: sellerId, role: RoleCode.ADMIN },
      t.clock.now(),
    );
    const failures: string[] = [];
    for (const route of denied()) {
      const res = await send(route.method, `/api/v1${fill(route.path)}`, {
        token: forged,
        body: {},
      });
      if (!(res.status === 403 && res.body?.error?.code === 'FORBIDDEN')) {
        failures.push(`${route.key} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('JWT: begona kalit, imzosi buzilgan payload, mavjud bo‘lmagan user, iss/aud xato → 401', async () => {
    const real = nextToken(RoleCode.USER);
    const [header, payload, signature] = real.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const tampered = `${header}.${Buffer.from(JSON.stringify({ ...claims, role: 'ADMIN' })).toString('base64url')}.${signature}`;
    const sign = (key: string, overrides: { sub?: string; iss?: string; aud?: string } = {}) =>
      new SignJWT({ role: 'ADMIN' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(overrides.sub ?? String(claims.sub))
        .setIssuer(overrides.iss ?? 'divine.uz')
        .setAudience(overrides.aud ?? 'divine.uz/api')
        .setIssuedAt(Math.floor(t.clock.now().getTime() / 1000))
        .setExpirationTime(Math.floor(t.clock.now().getTime() / 1000) + 600)
        .sign(new TextEncoder().encode(key));
    const secret = t.config.JWT_ACCESS_SECRET;
    const cases: [string, string][] = [
      ['payload o‘zgartirilgan', tampered],
      ['begona kalit', await sign('begona-kalit-0123456789-abcdefghijklmnop')],
      ['pepper bilan imzolangan', await sign(t.config.PASSWORD_PEPPER)],
      ['mavjud bo‘lmagan user', await sign(secret, { sub: randomUUID() })],
      ['iss xato', await sign(secret, { iss: 'boshqa' })],
      ['aud xato', await sign(secret, { aud: 'boshqa' })],
    ];
    for (const [label, token] of cases) {
      const res = await send('get', '/api/v1/users', { token });
      expect(res.status, label).toBe(401);
    }
  });
});

describe('input fuzz: buzilgan kirish hech qachon 5xx, stack yoki prototype pollution bermaydi', () => {
  const deep = (depth: number): object => (depth === 0 ? {} : { a: deep(depth - 1) });
  const BODIES: [string, string | object, string?][] = [
    ['massiv', []],
    ['satr', '"satr"'],
    ['null', 'null'],
    ['buzilgan JSON', '{"name":'],
    ['__proto__', '{"__proto__":{"fuzzPolluted":true,"role":"ADMIN"},"name":"x"}'],
    ['constructor.prototype', { constructor: { prototype: { fuzzPolluted: true } } }],
    ['chuqur obyekt', deep(400)],
    ['juda uzun satr', { name: 'x'.repeat(150_000), login: 'y'.repeat(150_000) }],
    ['1e400 va NaN', '{"amount":1e400,"quantity":"NaN","price":-1e400}'],
    ['boshqaruv belgilari', { name: '\u0000\u001b[31m‮', note: '\u0000' }],
    ['text/plain', 'name=x', 'text/plain'],
    [
      'noma’lum va himoyalangan maydonlar',
      { role: 'ADMIN', permissions: ['users.manage'], userId: randomUUID(), totalAmount: '1' },
    ],
  ];

  it('har bir yozuvchi endpoint × 12 xil buzilgan body (ADMIN)', async () => {
    const failures: string[] = [];
    const accepted: string[] = [];
    const writes = routes.filter((r) => r.method !== 'get');
    expect(writes.length).toBeGreaterThan(25);
    for (const route of writes) {
      for (const [label, body, contentType] of BODIES) {
        const res = await send(route.method, `/api/v1${fill(route.path)}`, {
          token: nextToken(RoleCode.ADMIN),
          body,
          contentType,
        });
        const problem = badShape(res);
        if (problem) failures.push(`${route.key} [${label}]: ${problem}`);
        if (res.status < 300) accepted.push(`${route.key} [${label}]`);
      }
    }
    expect(failures).toEqual([]);
    // Buzilgan body qabul qilinmaydi — faqat body'ni o'qimaydigan, idempotent logout.
    expect(accepted.filter((a) => !a.startsWith('POST /auth/logout'))).toEqual([]);
    expect(({} as Record<string, unknown>).fuzzPolluted).toBeUndefined();
    expect(({} as Record<string, unknown>).role).toBeUndefined();
  });

  it('path parametrlari: SQL, traversal, NUL, juda uzun qiymat → 400/404 (5xx emas)', async () => {
    const VALUES = [
      "' OR '1'='1",
      '1;DROP TABLE users',
      '..%2F..%2Fetc%2Fpasswd',
      '%00',
      'x'.repeat(4_000),
      '00000000-0000-0000-0000-000000000000',
    ];
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.path.includes(':'))) {
      for (const value of VALUES) {
        const res = await send(route.method, `/api/v1${fill(route.path, () => value)}`, {
          token: nextToken(RoleCode.ADMIN),
          body: {},
        });
        const problem = badShape(res) ?? (res.status < 300 ? `${res.status}` : null);
        if (problem) failures.push(`${route.key} [${value.slice(0, 20)}]: ${problem}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('query parametrlari: saralash injection, chegaradan tashqari sahifa, NUL, buzilgan sana/cursor, __proto__', async () => {
    const QUERIES = [
      'sort=password:asc',
      'sort=name;DROP%20TABLE%20users:asc',
      'page=-1&pageSize=100000',
      'search=%00%27%22%5C',
      'dateFrom=2026-13-45&dateTo=x',
      'limit=1e9&cursor=%%%',
      '__proto__[fuzzPolluted]=1&constructor[prototype][fuzzPolluted]=1',
      'status[]=ACTIVE&status[]=BLOCKED',
    ];
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.method === 'get' && r.security.kind !== 'public')) {
      for (const query of QUERIES) {
        const res = await send('get', `/api/v1${fill(route.path)}?${query}`, {
          token: nextToken(RoleCode.ADMIN),
        });
        const problem = badShape(res);
        if (problem) failures.push(`${route.key} [${query}]: ${problem}`);
      }
    }
    expect(failures).toEqual([]);
    expect(({} as Record<string, unknown>).fuzzPolluted).toBeUndefined();
  });
});
