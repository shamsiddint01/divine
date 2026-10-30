import { ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/create-test-app.js';

let t: TestApp;
const http = () => request(t.app.getHttpServer());

const VALID_ID = '01928c5e-0000-7000-8000-000000000001';
const validBody = { login: 'Kassir01', quantity: '2.500', customerName: 'Dilnoza' };

/** pino-http javob logi `finish` hodisasida yoziladi — kichik kutish. */
async function waitForLog(match: (log: Record<string, unknown>) => boolean) {
  for (let i = 0; i < 50; i++) {
    const found = t.logs.find(match);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Kutilgan log yozuvi topilmadi');
}

const reqIdOf = (log: Record<string, unknown>) =>
  (log.req as { id?: string } | undefined)?.id ?? (log.requestId as string | undefined);

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t?.app.close();
});

describe('yagona xato strukturasi (API §1.3)', () => {
  it('AppError: status, kod, o‘zbekcha xabar, details va requestId', async () => {
    const res = await http().get('/api/v1/__probe/errors/app').expect(409);
    expect(res.body).toEqual({
      error: {
        code: 'INSUFFICIENT_STOCK',
        message: 'Omborda yetarli mahsulot yo‘q: Telefon (mavjud: 2 dona)',
        details: [{ field: 'items[0].quantity', message: 'Mavjud: 2 dona' }],
        requestId: res.headers['x-request-id'],
      },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('framework (inglizcha) xabari client‘ga chiqmaydi', async () => {
    const res = await http().get('/api/v1/__probe/errors/http').expect(400);
    expect(res.body.error).toMatchObject({ code: 'BAD_REQUEST', message: 'So‘rov noto‘g‘ri' });
    expect(JSON.stringify(res.body)).not.toContain('English');
  });

  it('mavjud bo‘lmagan route → 404 NOT_FOUND o‘zbekcha (log‘da catch-all route yo‘q)', async () => {
    const res = await http().get('/api/v1/yoq-endpoint').expect(404);
    const log = await waitForLog(
      (l) => reqIdOf(l) === res.headers['x-request-id'] && 'responseTime' in l,
    );
    expect(log).not.toHaveProperty('route');
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Ma’lumot topilmadi' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('noto‘g‘ri JSON → 400 BAD_REQUEST', async () => {
    const res = await http()
      .post('/api/v1/__probe/items')
      .set('Content-Type', 'application/json')
      .send('{"login": ')
      .expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    // ID body-parser'dan oldin beriladi — parser xatosida ham bor (smoke testda topilgan regressiya).
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('body > 1 MB → 413 PAYLOAD_TOO_LARGE; 1 MB gacha qabul qilinadi', async () => {
    const big = await http()
      .post('/api/v1/__probe/echo')
      .send({ data: 'x'.repeat(1_100_000) })
      .expect(413);
    expect(big.body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      requestId: big.headers['x-request-id'],
    });
    await http()
      .post('/api/v1/__probe/echo')
      .send({ data: 'x'.repeat(500_000) })
      .expect(201);
  });
});

describe('noma’lum xato (500)', () => {
  it('ichki tafsilot client‘ga chiqmaydi, server log‘ida requestId bilan bor', async () => {
    const res = await http().get('/api/v1/__probe/errors/unknown').expect(500);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Kutilmagan xatolik yuz berdi. Keyinroq urinib ko‘ring',
        requestId: res.headers['x-request-id'],
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('FAQAT-SERVER-LOGIDA');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);

    const log = await waitForLog(
      (l) => l.requestId === res.headers['x-request-id'] && l.level === 50 && 'err' in l,
    );
    expect(log).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      route: '/api/v1/__probe/errors/unknown',
    });
    expect((log.err as { message: string }).message).toContain('FAQAT-SERVER-LOGIDA');
  });
});

describe('DB xatolari mapping (DATABASE §12)', () => {
  it.each([
    [
      'unique-login',
      409,
      'LOGIN_TAKEN',
      [{ field: 'login', message: 'Bu login band. Boshqa login kiriting' }],
    ],
    ['fk', 404, 'NOT_FOUND', undefined],
    ['check', 400, 'VALIDATION_ERROR', undefined],
    ['restrict', 409, 'ENTITY_IN_USE', undefined],
    ['not-null', 400, 'VALIDATION_ERROR', undefined],
    ['immutable', 500, 'INTERNAL_ERROR', undefined],
    ['unavailable', 503, 'SERVICE_UNAVAILABLE', undefined],
  ])('%s → %i %s', async (kind, status, code, details) => {
    const res = await http().get(`/api/v1/__probe/errors/db/${kind}`).expect(status);
    expect(res.body.error.code).toBe(code);
    expect(res.body.error.details).toEqual(details);
    // Xom DB matni, constraint nomi va Prisma xabari client'ga chiqmaydi.
    // requestId (tasodifiy UUID) tekshiruvdan chiqariladi — unda raqamlar tasodifan mos kelishi mumkin.
    const { requestId: _requestId, ...rest } = res.body.error as Record<string, unknown>;
    const body = JSON.stringify(rest);
    expect(body).not.toMatch(/SIZIB-CHIQMASIN|constraint|_key|_fkey|\bP\d{4}\b|\b23\d{3}\b|Prisma/);
  });

  it('DB xatosi log‘ida faqat identifikatorlar: qiymatlar (hash, qator) yo‘q', async () => {
    const res = await http().get('/api/v1/__probe/errors/db/check').expect(400);
    const log = await waitForLog((l) => l.requestId === res.headers['x-request-id'] && 'err' in l);
    expect(log.err).toEqual({
      type: 'PrismaClientKnownRequestError',
      prismaCode: 'P2039',
      sqlState: '23514',
      constraint: 'warehouses_name_not_blank',
      kind: 'postgres',
      model: 'Probe',
    });
    expect(t.rawLogs()).not.toContain('SIZIB-CHIQMASIN');
  });
});

describe('request ID (X-Request-Id)', () => {
  it('har bir javobda bor; xato javobida body bilan bir xil', async () => {
    const ok = await http().get('/api/v1/__probe/items').expect(200);
    expect(ok.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const err = await http().post('/api/v1/__probe/items').send({}).expect(400);
    expect(err.body.error.requestId).toBe(err.headers['x-request-id']);
  });

  it('xavfsiz kiruvchi ID qayta ishlatiladi; xavfsiz bo‘lmagani almashtiriladi', async () => {
    const reused = await http()
      .get('/api/v1/__probe/items')
      .set('X-Request-Id', 'kassa-7-req-0001');
    expect(reused.headers['x-request-id']).toBe('kassa-7-req-0001');
    for (const bad of ['short', 'has space inside', 'a'.repeat(65), 'inj"ection;rm']) {
      const res = await http().get('/api/v1/__probe/items').set('X-Request-Id', bad);
      expect(res.headers['x-request-id']).not.toBe(bad);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('so‘rov logi bilan bog‘langan: method, route, status, davomiylik', async () => {
    const res = await http()
      .get(`/api/v1/__probe/items/${VALID_ID}?search=%2B998901234567`)
      .set('X-Request-Id', 'bog-lanish-test-01')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('bog-lanish-test-01');
    const log = await waitForLog((l) => reqIdOf(l) === 'bog-lanish-test-01' && 'responseTime' in l);
    expect(log).toMatchObject({
      level: 30,
      req: { id: 'bog-lanish-test-01', method: 'GET', url: `/api/v1/__probe/items/${VALID_ID}` },
      res: { statusCode: 200 },
      route: '/api/v1/__probe/items/:id',
    });
    expect(typeof log.responseTime).toBe('number');
    // `route` kaliti yakuniy yozuvda faqat bir marta.
    const line = t
      .rawLogs()
      .split('\n')
      .find((l) => l.includes('bog-lanish-test-01') && l.includes('responseTime'))!;
    expect(line.match(/"route":/g)).toHaveLength(1);
    // Query string (masalan, telefon raqami bilan qidiruv) log'ga tushmaydi.
    expect(t.rawLogs()).not.toContain('998901234567');
  });

  it('4xx — warn, 5xx — error darajasida', async () => {
    const res = await http().get('/api/v1/__probe/items/yaroqsiz').expect(400);
    const log = await waitForLog(
      (l) => reqIdOf(l) === res.headers['x-request-id'] && 'responseTime' in l,
    );
    expect(log.level).toBe(40);
  });
});

describe('Zod validatsiyasi (o‘zbekcha)', () => {
  it('body: aniq o‘zbekcha xabarlar va maydon yo‘llari', async () => {
    const res = await http()
      .post('/api/v1/__probe/items')
      .send({ login: 'ali vali', quantity: '0', customerName: '  ' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Kiritilgan ma’lumotlarda xatolik bor');
    const fields = Object.fromEntries(
      (res.body.error.details as { field: string; message: string }[]).map((d) => [
        d.field,
        d.message,
      ]),
    );
    expect(Object.keys(fields).sort()).toEqual(['customerName', 'login', 'quantity']);
    expect(fields.customerName).toBe('Mijoz ismi majburiy');
    for (const message of Object.values(fields)) expect(message).toMatch(/[a-zʻ‘’']/);
    expect(JSON.stringify(res.body)).not.toMatch(/Invalid|Expected|Required|must/);
  });

  it('body: majburiy maydon yo‘q va noma’lum maydon rad etiladi (mass assignment)', async () => {
    const missing = await http().post('/api/v1/__probe/items').send({}).expect(400);
    expect(missing.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'customerName',
      'login',
      'quantity',
    ]);
    const extra = await http()
      .post('/api/v1/__probe/items')
      .send({ ...validBody, role: 'ADMIN' })
      .expect(400);
    expect(extra.body.error.details).toEqual([
      { field: '', message: 'Ruxsat etilmagan maydonlar yuborildi' },
    ]);
  });

  it('body: to‘g‘ri ma’lumot transform qilingan holda o‘tadi', async () => {
    const res = await http()
      .post('/api/v1/__probe/items')
      .send({ ...validBody, customerName: '  Dilnoza  ' })
      .expect(201);
    expect(res.body).toEqual({ ...validBody, customerName: 'Dilnoza' });
  });

  it('params: noto‘g‘ri UUID', async () => {
    const res = await http().get('/api/v1/__probe/items/123').expect(400);
    expect(res.body.error.details).toEqual([{ field: 'id', message: 'Identifikator noto‘g‘ri' }]);
    await http().get(`/api/v1/__probe/items/${VALID_ID}`).expect(200);
  });

  it('query: noto‘g‘ri filtr qiymatlari', async () => {
    const res = await http()
      .get('/api/v1/__probe/items?status=DELETED&warehouseId=abc&dateFrom=2026-13-40')
      .expect(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'dateFrom',
      'status',
      'warehouseId',
    ]);
  });

  it('query: dateFrom > dateTo', async () => {
    const res = await http()
      .get('/api/v1/__probe/items?dateFrom=2026-10-08&dateTo=2026-10-01')
      .expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'dateTo', message: 'Tugash sanasi boshlanish sanasidan oldin bo‘lishi mumkin emas' },
    ]);
  });
});

describe('pagination (API §1.2)', () => {
  it('standart: page=1, pageSize=20; javob shakli { data, meta }', async () => {
    const res = await http().get('/api/v1/__probe/items').expect(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.prisma).toMatchObject({ skip: 0, take: 20 });
  });

  it('page va pageSize → skip/take', async () => {
    const res = await http().get('/api/v1/__probe/items?page=3&pageSize=10').expect(200);
    expect(res.body.meta).toEqual({ page: 3, pageSize: 10, total: 45, totalPages: 5 });
    expect(res.body.prisma).toMatchObject({ skip: 20, take: 10 });
  });

  it('pageSize maksimal 100', async () => {
    await http().get('/api/v1/__probe/items?pageSize=100').expect(200);
    const res = await http().get('/api/v1/__probe/items?pageSize=101').expect(400);
    expect(res.body.error.details).toEqual([
      { field: 'pageSize', message: expect.stringContaining('100') },
    ]);
  });

  it.each([['page=0'], ['page=-1'], ['page=abc'], ['page=1.5'], ['pageSize=0'], ['pageSize=x']])(
    'noto‘g‘ri qiymat: %s',
    async (qs) => {
      const res = await http().get(`/api/v1/__probe/items?${qs}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe(qs.split('=')[0]);
    },
  );
});

describe('saralash (whitelist)', () => {
  it('standart va ruxsat etilgan maydonlar; tie-breaker id', async () => {
    const def = await http().get('/api/v1/__probe/items').expect(200);
    expect(def.body.prisma.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    const asc = await http().get('/api/v1/__probe/items?sort=name:asc').expect(200);
    expect(asc.body.prisma.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    const implicit = await http().get('/api/v1/__probe/items?sort=name').expect(200);
    expect(implicit.body.query.sort).toEqual({ field: 'name', direction: 'asc' });
  });

  it.each([['password:asc'], ['name:up'], ['name;DROP TABLE users'], ['createdAt:desc,1']])(
    'ruxsat etilmagan: %s → 400',
    async (sort) => {
      const res = await http()
        .get(`/api/v1/__probe/items?sort=${encodeURIComponent(sort)}`)
        .expect(400);
      expect(res.body.error.details).toEqual([
        { field: 'sort', message: 'Saralash parametri noto‘g‘ri' },
      ]);
    },
  );
});

describe('filtrlar foundation', () => {
  it('bo‘sh qiymatlar e’tiborga olinmaydi; sana oralig‘i Toshkent kuni bo‘yicha UTC‘ga', async () => {
    const res = await http()
      .get(
        `/api/v1/__probe/items?search=%20%20&status=&warehouseId=${VALID_ID}&dateFrom=2026-10-01&dateTo=2026-10-08`,
      )
      .expect(200);
    expect(res.body.query.warehouseId).toBe(VALID_ID);
    expect(res.body.query.status).toBeUndefined();
    expect(res.body.query.search).toBeUndefined();
    expect(res.body.prisma.dateRange).toEqual({
      gte: '2026-09-30T19:00:00.000Z',
      lt: '2026-10-08T19:00:00.000Z',
    });
  });
});

describe('xavfsizlik', () => {
  it('Authorization, Cookie va body‘dagi parol log‘ga tushmaydi', async () => {
    await http()
      .post('/api/v1/__probe/echo')
      .set('Authorization', 'Bearer SIR-JWT-TOKEN')
      .set('Cookie', 'dv_refresh=SIR-REFRESH-COOKIE')
      .send({ password: 'SIR-PAROL-123456', passwordHash: 'v1$$argon2id$SIR' })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const raw = t.rawLogs();
    for (const secret of [
      'SIR-JWT-TOKEN',
      'SIR-REFRESH-COOKIE',
      'SIR-PAROL-123456',
      'argon2id$SIR',
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it('secure header’lar va CORS expose', async () => {
    const res = await http().get('/api/v1/__probe/items');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('rate limit (API §1.5)', () => {
  it('anonim: 60 / daqiqa / IP → 429 RATE_LIMITED + Retry-After; health cheklanmaydi', async () => {
    // Alohida ilova: haqiqiy hisoblagich (xotirada), boshqa testlarning so'rovlari aralashmaydi.
    const limited = await createTestApp({ throttlerStorage: new ThrottlerStorageService() });
    try {
      const server = limited.app.getHttpServer();
      for (let i = 0; i < 60; i++) await request(server).get('/api/v1/__probe/items').expect(200);
      const blocked = await request(server).get('/api/v1/__probe/items').expect(429);
      expect(blocked.body.error).toEqual({
        code: 'RATE_LIMITED',
        message: 'Juda ko‘p so‘rov yuborildi. Birozdan keyin urinib ko‘ring',
        requestId: blocked.headers['x-request-id'],
      });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      // Health-check cheklanmaydi (orkestrator probe'lari) — anonim limitdan (60) ko'p so'rov ham 200.
      // Phase 4'da topilgan regressiya: `@SkipThrottle()` faqat `default` nomli throttler'ni o'tkazib yuborardi.
      for (let i = 0; i < 65; i++) await request(server).get('/api/v1/health').expect(200);
    } finally {
      await limited.app.close();
    }
  });
});

describe('Swagger (OpenAPI) foundation sxemalari', () => {
  it('xato va pagination sxemalari, global 429/500/503 javoblari', async () => {
    const res = await http().get('/api/docs/openapi.json').expect(200);
    const doc = res.body as {
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining([
        'ApiErrorBodyDto',
        'ApiErrorDto',
        'ApiErrorDetailDto',
        'PaginationMetaDto',
      ]),
    );
    expect(Object.keys(doc.components.schemas.ApiErrorDto!.properties!)).toEqual([
      'code',
      'message',
      'details',
      'requestId',
    ]);
    expect(Object.keys(doc.paths['/api/v1/health']!.get!.responses)).toEqual(
      expect.arrayContaining(['200', '429', '500', '503']),
    );
  });
});
