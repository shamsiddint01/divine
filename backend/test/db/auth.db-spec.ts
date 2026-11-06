import { createHash } from 'node:crypto';
import { ROLE_PERMISSIONS } from '@divine/shared';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteSecurityAuditor } from '../../src/common/auth/route-security.auditor.js';
import { RedisService } from '../../src/infrastructure/redis/redis.service.js';
import { SessionCleanupJob } from '../../src/modules/auth/session-cleanup.job.js';
import { localDate } from '../../src/common/time/tashkent-time.js';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  ORIGIN,
  refresh,
  refreshCookieOf,
  uniqueIp,
  uniqueLogin,
} from './support/auth-app.js';

let t: AuthTestApp;
const BASE_TIME = new Date('2026-10-09T08:00:00.000Z');
const PASSWORD = '483920';
const http = () => request(t.app.getHttpServer());
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function auditFor(action: string, sinceMs = 0) {
  return t.prisma.auditLog.findMany({
    where: { action, occurredAt: { gte: new Date(sinceMs) } },
    orderBy: { id: 'desc' },
  });
}

beforeAll(async () => {
  t = await createAuthApp();
});

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  t.clock.set(BASE_TIME);
});

describe('POST /auth/login', () => {
  it('to‘g‘ri credential → 200, access token, CurrentUser, xavfsiz refresh cookie', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const res = await login(t, { login: user.login, password: PASSWORD }).expect(200);

    expect(res.body).toEqual({
      accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
      expiresIn: 900,
      user: {
        id: user.id,
        login: user.login,
        fullName: 'Test Foydalanuvchi',
        role: 'USER',
        status: 'ACTIVE',
        permissions: [...ROLE_PERMISSIONS.USER].sort(),
        warehouseIds: [],
      },
    });
    expect(res.headers['cache-control']).toBe('no-store');

    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('dv_refresh='))!;
    expect(cookie).toMatch(/^dv_refresh=[A-Za-z0-9_-]{43};/);
    for (const attribute of [
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Path=/api/v1/auth',
      'Max-Age=57600',
    ]) {
      expect(cookie).toContain(attribute);
    }

    // DB'da refresh token'ning o'zi emas, faqat SHA-256 hash'i.
    const token = refreshCookieOf(res).slice('dv_refresh='.length);
    const session = await t.prisma.userSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).toBe(sha256(token));
    expect(session.tokenHash).not.toContain(token);
    expect(session.expiresAt.getTime() - BASE_TIME.getTime()).toBe(16 * 3_600_000);

    const [audit] = await auditFor('AUTH_LOGIN_SUCCEEDED');
    expect(audit).toMatchObject({ actorId: user.id, entityType: 'SESSION', entityId: session.id });
  });

  it('login case-insensitive (BR-03, A-05)', async () => {
    const user = await createUser(t, { password: PASSWORD, login: uniqueLogin('Kassir') });
    await login(t, { login: user.login.toUpperCase(), password: PASSWORD }).expect(200);
  });

  it('noto‘g‘ri parol va mavjud bo‘lmagan login — bir xil 401 (enumeration yo‘q), ikkalasida ham argon2', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const dummy = vi.spyOn(t.hasher, 'verifyAgainstDummy');
    const wrong = await login(t, { login: user.login, password: '000000' }).expect(401);
    const unknown = await login(t, { login: uniqueLogin('yoq'), password: '000000' }).expect(401);
    const strip = (body: { error: Record<string, unknown> }) => ({
      ...body.error,
      requestId: undefined,
    });
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
    expect(wrong.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Login yoki parol noto‘g‘ri',
    });
    expect(dummy).toHaveBeenCalledTimes(1);
    dummy.mockRestore();
  });

  it('bloklangan user: to‘g‘ri parol → 403 ACCOUNT_BLOCKED; noto‘g‘ri parol → 401 (oshkor qilinmaydi)', async () => {
    const user = await createUser(t, { password: PASSWORD, status: 'BLOCKED' });
    const blocked = await login(t, { login: user.login, password: PASSWORD }).expect(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_BLOCKED');
    await login(t, { login: user.login, password: '111111' }).expect(401);
    expect(await t.prisma.userSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it.each([
    [{ login: 'ali vali', password: PASSWORD }, 'login'],
    [{ login: 'ab', password: PASSWORD }, 'login'],
    [{ login: '', password: PASSWORD }, 'login'],
    [{ login: 'alivali', password: '12345' }, 'password'],
    [{ login: 'alivali', password: '12345a' }, 'password'],
    [{ login: 'alivali' }, 'password'],
  ])('noto‘g‘ri format → 400 VALIDATION_ERROR o‘zbekcha (%j)', async (body, field) => {
    const res = await login(t, body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe(field);
    expect(res.body.error.details[0].message).toMatch(/Login|Parol/);
  });

  it('noma’lum maydon rad etiladi', async () => {
    const res = await login(t, { login: 'alivali', password: PASSWORD, role: 'ADMIN' }).expect(400);
    expect(res.body.error.details).toEqual([
      { field: '', message: 'Ruxsat etilmagan maydonlar yuborildi' },
    ]);
  });

  it('parol DB, javob va audit‘da ochiq holda yo‘q', async () => {
    const user = await createUser(t, { password: '905172' });
    const ok = await login(t, { login: user.login, password: '905172' }).expect(200);
    await login(t, { login: user.login, password: '905173' }).expect(401);
    expect(JSON.stringify(ok.body)).not.toContain('905172');
    const stored = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).toMatch(/^v1\$\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(stored.passwordHash).not.toContain('905172');
    const audits = await t.prisma.auditLog.findMany({
      where: { metadata: { path: ['login'], equals: user.login } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const serialized = JSON.stringify(audits.map((a) => ({ ...a, id: String(a.id) })));
    expect(serialized).not.toMatch(/905172|905173|argon2/);
  });
});

describe('progressive lockout (SECURITY §4)', () => {
  it('5 ta xato → 423 (15 daq); lock vaqtida to‘g‘ri parol ham rad etiladi; muddat tugagach kirish va hisoblagich nol', async () => {
    const user = await createUser(t, { password: PASSWORD });
    for (let i = 0; i < 4; i++)
      await login(t, { login: user.login, password: '000000' }).expect(401);
    const locked = await login(t, { login: user.login, password: '000000' }).expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(locked.headers['retry-after']).toBe('900');

    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ failedLoginAttempts: 0, lockoutCount: 1 });
    expect(row.lockedUntil?.toISOString()).toBe('2026-10-09T08:15:00.000Z');
    expect((await auditFor('AUTH_ACCOUNT_LOCKED'))[0]).toMatchObject({ entityId: user.id });

    t.clock.set(new Date('2026-10-09T08:14:59.000Z'));
    const stillLocked = await login(t, { login: user.login, password: PASSWORD }).expect(423);
    expect(stillLocked.headers['retry-after']).toBe('1');
    expect(await t.prisma.userSession.count({ where: { userId: user.id } })).toBe(0);

    t.clock.set(new Date('2026-10-09T08:15:00.000Z'));
    await login(t, { login: user.login, password: PASSWORD }).expect(200);
    expect(await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      failedLoginAttempts: 0,
      lockoutCount: 0,
      lockedUntil: null,
    });
  });

  it('har keyingi lock ikki baravar: 15 → 30 → 60 daq; maksimum 24 soat', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const lockOnce = async () => {
      for (let i = 0; i < 4; i++)
        await login(t, { login: user.login, password: '000000' }).expect(401);
      return login(t, { login: user.login, password: '000000' }).expect(423);
    };
    expect((await lockOnce()).headers['retry-after']).toBe(String(15 * 60));
    t.clock.advance(15 * 60_000);
    expect((await lockOnce()).headers['retry-after']).toBe(String(30 * 60));
    t.clock.advance(30 * 60_000);
    expect((await lockOnce()).headers['retry-after']).toBe(String(60 * 60));

    await t.prisma.user.update({
      where: { id: user.id },
      data: { lockoutCount: 12, lockedUntil: null },
    });
    expect((await lockOnce()).headers['retry-after']).toBe(String(24 * 3600));
  });

  it('mavjud bo‘lmagan login uchun ham aynan shu lockout (javoblar bir xil)', async () => {
    const ghost = uniqueLogin('arvoh');
    for (let i = 0; i < 4; i++) await login(t, { login: ghost, password: '000000' }).expect(401);
    const locked = await login(t, { login: ghost, password: '000000' }).expect(423);
    expect(locked.headers['retry-after']).toBe('900');
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    await login(t, { login: ghost, password: '000000' }).expect(423);
    t.clock.advance(15 * 60_000);
    await login(t, { login: ghost, password: '000000' }).expect(401);
  });

  it('20 ta parallel xato urinish → aynan bitta lock (lock vaqtidagi urinishlar hisoblanmaydi)', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => login(t, { login: user.login, password: '000000' })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 401 || s === 423)).toBe(true);
    expect(statuses.filter((s) => s === 423).length).toBeGreaterThanOrEqual(1);
    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockoutCount).toBe(1);
    expect(row.lockedUntil?.toISOString()).toBe('2026-10-09T08:15:00.000Z');
    // Lock paytida to'g'ri parol bilan parallel urinish ham o'tmaydi.
    await login(t, { login: user.login, password: PASSWORD }).expect(423);
  });

  it('IP rate limit: login 10/daq → 11-so‘rov 429 + Retry-After (lockout‘dan mustaqil)', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 10; i++) {
      await login(t, { login: uniqueLogin('rl'), password: '000000' }, ip).expect(401);
    }
    const limited = await login(t, { login: uniqueLogin('rl'), password: '000000' }, ip).expect(
      429,
    );
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Boshqa IP ta'sirlanmaydi (ishonchli proxy: X-Forwarded-For, TRUST_PROXY=1).
    await login(t, { login: uniqueLogin('rl'), password: '000000' }, uniqueIp()).expect(401);
  });
});

describe('SEC-01: noma’lum login xom qiymati saqlanmaydi (SECURITY §15.1)', () => {
  const redis = () => t.app.get(RedisService).client;
  /** Shu IP'dan yozilgan audit qatorlari — metadata matni bilan. */
  const auditFromIp = (ip: string) =>
    t.prisma.$queryRaw<
      { id: string; action: string; metadata: Record<string, unknown>; text: string }[]
    >`
      SELECT id::text, action, metadata, metadata::text AS text
        FROM audit_logs WHERE host(ip) = ${ip} ORDER BY id`;
  const allRedisKeys = async () => {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis().scan(cursor, 'COUNT', 1000);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    return keys;
  };
  const randomDigits = () => String(100_000 + Math.floor(Math.random() * 900_000));
  async function adminToken() {
    const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
    return (await login(t, { login: admin.login, password: PASSWORD }).expect(200)).body
      .accessToken as string;
  }

  it('login maydoniga parol (6 raqam): audit (xato, lock, lock paytidagi urinish), Redis va API javobida xom qiymat yo‘q', async () => {
    const secret = randomDigits();
    const ip = uniqueIp();
    for (let i = 0; i < 4; i++)
      await login(t, { login: secret, password: '000000' }, ip).expect(401);
    await login(t, { login: secret, password: '000000' }, ip).expect(423);
    await login(t, { login: secret, password: '000000' }, ip).expect(423); // lock paytidagi

    const rows = await auditFromIp(ip);
    expect(rows.map((r) => r.action).sort()).toEqual(
      [...Array<string>(6).fill('AUTH_LOGIN_FAILED'), 'AUTH_ACCOUNT_LOCKED'].sort(),
    );
    for (const row of rows) {
      expect(row.text).not.toContain(secret);
      expect(row.metadata).not.toHaveProperty('login');
      expect(row.metadata).not.toHaveProperty('loginFingerprint'); // 10⁶ variant — iz ham saqlanmaydi
      expect(row.metadata).toMatchObject({ loginMasked: true, loginLength: 6, knownUser: false });
    }

    const keys = await allRedisKeys();
    expect(keys.filter((k) => k.includes(secret))).toEqual([]);
    for (const key of keys.filter((k) => k.startsWith('divine:auth:unknown:'))) {
      expect(JSON.stringify(await redis().hgetall(key))).not.toContain(secret);
    }

    const token = await adminToken();
    const list = await http()
      .get('/api/v1/audit-logs?action=AUTH_LOGIN_FAILED&limit=100')
      .set(bearer(token))
      .expect(200);
    expect(list.text).not.toContain(secret);
  });

  it('boshqa noma’lum login: xom qiymat o‘rniga kalitli barmoq izi — takroriy urinishlar bog‘lanadi (katta-kichik harf farqsiz), lockout ishlaydi', async () => {
    const ghost = uniqueLogin('Arvoh');
    const ip = uniqueIp();
    await login(t, { login: ghost, password: '000000' }, ip).expect(401);
    await login(t, { login: ghost.toUpperCase(), password: '000000' }, ip).expect(401);
    for (let i = 0; i < 3; i++)
      await login(t, { login: ghost, password: '000000' }, ip).expect(i < 2 ? 401 : 423);

    const rows = await auditFromIp(ip);
    expect(rows).toHaveLength(6); // 5 xato + 1 lock
    const prints = new Set(rows.map((r) => r.metadata.loginFingerprint));
    expect(prints.size).toBe(1);
    const [print] = [...prints] as [string];
    expect(print).toMatch(/^[0-9a-f]{32}$/);
    // Kalitsiz hash emas (lug'at bilan ochib bo'lmasin).
    expect(sha256(ghost.toLowerCase())).not.toContain(print);
    for (const row of rows) {
      expect(row.text.toLowerCase()).not.toContain(ghost.toLowerCase());
      expect(row.metadata).toMatchObject({ loginLength: ghost.length, knownUser: false });
      expect(row.metadata).not.toHaveProperty('loginMasked');
    }
    expect(
      (await allRedisKeys()).filter((k) => k.toLowerCase().includes(ghost.toLowerCase())),
    ).toEqual([]);
  });

  it('mavjud audit yozuvlari o‘zgarmaydi; API ularni ham xom qiymatsiz ko‘rsatadi', async () => {
    const secret = randomDigits();
    const oldGhost = uniqueLogin('eskiarvoh');
    const legacy = await t.prisma.$queryRaw<{ id: string; text: string }[]>`
      INSERT INTO audit_logs (actor_id, action, entity_type, metadata)
      VALUES (NULL, 'AUTH_LOGIN_FAILED', 'SESSION',
              ${JSON.stringify({ login: secret, reason: 'INVALID_CREDENTIALS', knownUser: false })}::jsonb),
             (NULL, 'AUTH_ACCOUNT_LOCKED', 'SESSION',
              ${JSON.stringify({ login: oldGhost, knownUser: false, lockedUntil: '2026-10-09T08:15:00.000Z' })}::jsonb)
      RETURNING id::text, metadata::text AS text`;

    // Xuddi shu loginning yangi urinishi bilan bir xil iz — eski va yangi yozuvlar bog'lanadi.
    const ip = uniqueIp();
    await login(t, { login: oldGhost, password: '000000' }, ip).expect(401);
    const [fresh] = await auditFromIp(ip);

    const token = await adminToken();
    const masked = await http()
      .get(`/api/v1/audit-logs/${legacy[0]!.id}`)
      .set(bearer(token))
      .expect(200);
    expect(masked.text).not.toContain(secret);
    expect(masked.body.metadata).toEqual({
      loginMasked: true,
      loginLength: 6,
      reason: 'INVALID_CREDENTIALS',
      knownUser: false,
    });
    const printed = await http()
      .get(`/api/v1/audit-logs/${legacy[1]!.id}`)
      .set(bearer(token))
      .expect(200);
    expect(printed.text).not.toContain(oldGhost);
    expect(printed.body.metadata).toMatchObject({
      loginFingerprint: fresh!.metadata.loginFingerprint,
      loginLength: oldGhost.length,
      lockedUntil: '2026-10-09T08:15:00.000Z',
    });

    // DB'dagi qatorlar o'zgarmagan (immutable: trigger UPDATE'ni rad etadi, kod ham yozmaydi).
    const after = await t.prisma.$queryRaw<{ id: string; text: string }[]>`
      SELECT id::text, metadata::text AS text FROM audit_logs
       WHERE id = ANY(${legacy.map((r) => r.id)}::bigint[]) ORDER BY id`;
    expect(after).toEqual(legacy);
  });

  it('ilova ishga tushganda xom loginli eski Redis lockout kalitlari o‘chiriladi (yangi formatdagilar qoladi)', async () => {
    const secret = randomDigits();
    const legacyKey = `divine:auth:unknown:${secret}`;
    await redis().hset(legacyKey, 'fails', 3);
    await redis().pexpire(legacyKey, 60_000);
    const ghost = uniqueLogin('yangi');
    await login(t, { login: ghost, password: '000000' }).expect(401);
    const current = (await allRedisKeys()).filter((k) => k.startsWith('divine:auth:unknown:fp:'));
    expect(current.length).toBeGreaterThan(0);

    const second = await createAuthApp();
    try {
      expect(await redis().exists(legacyKey)).toBe(0);
      for (const key of current) expect(await redis().exists(key)).toBe(1);
    } finally {
      await second.close();
    }
  });
});

describe('pepper rotation (SECURITY §13, Phase 17)', () => {
  it('PASSWORD_PEPPER_V2 yoqilgach: v1$ hash bilan login o‘tadi va hash v2$ ga almashadi; sessiyalar va tokenlar saqlanadi', async () => {
    const user = await createUser(t, { password: PASSWORD }); // v1$ (hozirgi ilova)
    const before = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(before.passwordHash).toMatch(/^v1\$/);
    const oldSession = await login(t, { login: user.login, password: PASSWORD }).expect(200);

    const rotated = await createAuthApp({
      config: { PASSWORD_PEPPER_V2: 'test-password-pepper-v2-0123456789-abcdefgh' },
    });
    try {
      rotated.clock.set(t.clock.now());
      const res = await login(rotated, { login: user.login, password: PASSWORD }).expect(200);
      const after = await rotated.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.passwordHash).toMatch(/^v2\$\$argon2id\$/);
      // Parol o'zgarmadi — eski tokenlar bekor bo'lmaydi (password_changed_at o'sha).
      expect(after.passwordChangedAt).toEqual(before.passwordChangedAt);
      await request(rotated.app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(bearer(oldSession.body.accessToken))
        .expect(200);
      await request(rotated.app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(bearer(res.body.accessToken))
        .expect(200);
      // Qayta login (endi v2$) va xato parol — odatdagidek.
      await login(rotated, { login: user.login, password: PASSWORD }).expect(200);
      await login(rotated, { login: user.login, password: '000000' }).expect(401);
      // v2$ hash qayta hash qilinmaydi (har login'da yozuv yo'q).
      expect(
        (await rotated.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
      ).toBe(after.passwordHash);
    } finally {
      await rotated.close();
    }
    // V2'siz ilova v2$ hash'ni tekshira olmaydi (pepper yo'q) — rotation'ni orqaga qaytarib bo'lmaydi.
    await login(t, { login: user.login, password: PASSWORD }).expect(401);
  });
});

describe('eski sessiyalarni tozalash (SECURITY §3, Phase 17)', () => {
  it('30 kundan oldin muddati tugagan yoki bekor qilingan sessiyalar o‘chiriladi; faol va yangilari qoladi; kuniga bir marta', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      await login(t, { login: user.login, password: PASSWORD }).expect(200);
    }
    const sessions = await t.prisma.userSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    ids.push(...sessions.map((s) => s.id));
    const day = 86_400_000;
    const now = t.clock.now().getTime();
    // Sessiyalar 40 kun oldin ochilgan deb (CHECK: expires_at > created_at; bekor qilish sababi bilan).
    const set = (id: string, data: { expiresAt?: Date; revokedAt?: Date }) =>
      t.prisma.userSession.update({
        where: { id },
        data: {
          createdAt: new Date(now - 40 * day),
          ...data,
          ...(data.revokedAt ? { revokedReason: 'LOGOUT' } : {}),
        },
      });
    await set(ids[0]!, { expiresAt: new Date(now - 31 * day) }); // muddati 31 kun oldin tugagan → o'chadi
    await set(ids[1]!, { revokedAt: new Date(now - 31 * day) }); // 31 kun oldin bekor qilingan → o'chadi
    await set(ids[2]!, { expiresAt: new Date(now - 29 * day) }); // 29 kun — qoladi
    await set(ids[3]!, { revokedAt: new Date(now - 2 * day) }); // yaqinda bekor qilingan — qoladi
    // ids[4] — faol sessiya; ids[0] ga ishora qiluvchi zanjir (replaced_by) bo'lsa ham FK SET NULL.
    await t.prisma.userSession.update({
      where: { id: ids[3]! },
      data: { replacedById: ids[0]! },
    });

    const job = t.app.get(SessionCleanupJob);
    await t.app
      .get(RedisService)
      .client.del(`divine:job:session-cleanup:${localDate(t.clock.now())}`);
    const first = await job.runOnce();
    expect(first).toBe(true);
    const left = await t.prisma.userSession.findMany({ where: { userId: user.id } });
    expect(left.map((s) => s.id).sort()).toEqual([ids[2]!, ids[3]!, ids[4]!].sort());
    expect(left.find((s) => s.id === ids[3])!.replacedById).toBeNull();
    // Faol sessiya bilan refresh ishlayveradi; o'sha kuni ikkinchi ishga tushirish — qulf (boshqa instansiya).
    expect(await job.runOnce()).toBe(false);
  });
});

describe('access token va himoyalangan endpointlar', () => {
  it('GET /auth/me: token bilan 200; tokensiz, buzilgan, begona kalit, alg=none va muddati o‘tgan → 401', async () => {
    const user = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
    const { body } = await login(t, { login: user.login, password: PASSWORD }).expect(200);
    const me = await http().get('/api/v1/auth/me').set(bearer(body.accessToken)).expect(200);
    expect(me.body).toEqual(body.user);

    await http().get('/api/v1/auth/me').expect(401);
    await http()
      .get('/api/v1/auth/me')
      .set(bearer(`${body.accessToken}x`))
      .expect(401);
    const foreign = await new SignJWT({ role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('divine.uz')
      .setAudience('divine.uz/api')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('begona-secret-0123456789-abcdefghijklmn'));
    await http().get('/api/v1/auth/me').set(bearer(foreign)).expect(401);
    const [header, payload] = body.accessToken.split('.');
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
    expect(header).toBeTruthy();
    await http().get('/api/v1/auth/me').set(bearer(none)).expect(401);

    t.clock.advance(15 * 60_000 + 31_000); // TTL + clock skew
    const expired = await http().get('/api/v1/auth/me').set(bearer(body.accessToken)).expect(401);
    expect(expired.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('bloklangan user — keyingi so‘rovda darhol 401 ACCOUNT_BLOCKED (AC-27)', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const { body } = await login(t, { login: user.login, password: PASSWORD }).expect(200);
    await t.prisma.user.update({ where: { id: user.id }, data: { status: 'BLOCKED' } });
    const res = await http().get('/api/v1/auth/me').set(bearer(body.accessToken)).expect(401);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
  });

  it('parol o‘zgargandan oldingi token → 401 SESSION_EXPIRED', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const { body } = await login(t, { login: user.login, password: PASSWORD }).expect(200);
    await t.prisma.user.update({
      where: { id: user.id },
      data: { passwordChangedAt: new Date(BASE_TIME.getTime() + 5_000) },
    });
    const res = await http().get('/api/v1/auth/me').set(bearer(body.accessToken)).expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('autentifikatsiyalangan so‘rovlar user bo‘yicha limitlanadi (anonim 60/daq IP limiti emas)', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const { body } = await login(t, { login: user.login, password: PASSWORD }).expect(200);
    const ip = uniqueIp();
    for (let i = 0; i < 65; i++) {
      await http()
        .get('/api/v1/auth/me')
        .set('X-Forwarded-For', ip)
        .set(bearer(body.accessToken))
        .expect(200);
    }
  });
});

describe('refresh: rotation, reuse detection, CSRF', () => {
  it('rotation: yangi cookie va token; eski sessiya ROTATED → yangisiga ishora', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const first = await login(t, { login: user.login, password: PASSWORD }).expect(200);
    const firstCookie = refreshCookieOf(first);

    const rotated = await refresh(t, firstCookie).expect(200);
    const secondCookie = refreshCookieOf(rotated);
    expect(secondCookie).not.toBe(firstCookie);
    expect(rotated.body.user.id).toBe(user.id);
    await http().get('/api/v1/auth/me').set(bearer(rotated.body.accessToken)).expect(200);

    // Test soati qotirilgan — sessiyalar created_at bo'yicha emas, holati bo'yicha ajratiladi.
    const sessions = await t.prisma.userSession.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(2);
    const old = sessions.find((s) => s.revokedAt !== null)!;
    const current = sessions.find((s) => s.revokedAt === null)!;
    expect(old).toMatchObject({ revokedReason: 'ROTATED', replacedById: current.id });
    expect(current).toMatchObject({ familyId: old.familyId, replacedById: null });
  });

  it('eski (almashtirilgan) token qayta ishlatilsa — butun family bekor qilinadi + audit', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const first = refreshCookieOf(
      await login(t, { login: user.login, password: PASSWORD }).expect(200),
    );
    const second = refreshCookieOf(await refresh(t, first).expect(200));

    t.clock.advance(31_000); // grace oralig'idan keyin
    const reused = await refresh(t, first).expect(401);
    expect(reused.body.error.code).toBe('SESSION_EXPIRED');
    // O'g'irlangan bo'lishi mumkin bo'lgan zanjirning yangi tokeni ham endi ishlamaydi.
    await refresh(t, second).expect(401);

    const sessions = await t.prisma.userSession.findMany({ where: { userId: user.id } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    expect(sessions.map((s) => s.revokedReason).sort()).toEqual(['REUSE_DETECTED', 'ROTATED']);
    expect((await auditFor('AUTH_REFRESH_REUSE_DETECTED'))[0]).toMatchObject({ actorId: user.id });
  });

  it('bir xil token bilan parallel refresh (ikki tab): ikkalasi o‘tadi, sessiya yopilmaydi', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const cookie = refreshCookieOf(
      await login(t, { login: user.login, password: PASSWORD }).expect(200),
    );
    const results = await Promise.all([refresh(t, cookie), refresh(t, cookie)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await auditFor('AUTH_REFRESH_REUSE_DETECTED')).toHaveLength(0);
    await refresh(t, refreshCookieOf(results[0]!)).expect(200);
    await refresh(t, refreshCookieOf(results[1]!)).expect(200);
  });

  it('refresh muddatni uzaytirmaydi: kirishdan 16 soat o‘tgach sessiya tugaydi', async () => {
    const user = await createUser(t, { password: PASSWORD });
    let cookie = refreshCookieOf(
      await login(t, { login: user.login, password: PASSWORD }).expect(200),
    );
    t.clock.advance(15 * 3_600_000);
    const res = await refresh(t, cookie).expect(200);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=3600');
    cookie = refreshCookieOf(res);
    t.clock.advance(3_600_000 + 1_000);
    await refresh(t, cookie).expect(401);
  });

  it('muddati o‘tgan refresh → 401 SESSION_EXPIRED va cookie tozalanadi', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const cookie = refreshCookieOf(
      await login(t, { login: user.login, password: PASSWORD }).expect(200),
    );
    t.clock.advance(16 * 3_600_000 + 1_000);
    const res = await refresh(t, cookie).expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('refresh paytida user bloklangan → 401 ACCOUNT_BLOCKED, sessiya USER_BLOCKED', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const cookie = refreshCookieOf(
      await login(t, { login: user.login, password: PASSWORD }).expect(200),
    );
    await t.prisma.user.update({ where: { id: user.id }, data: { status: 'BLOCKED' } });
    expect((await refresh(t, cookie).expect(401)).body.error.code).toBe('ACCOUNT_BLOCKED');
    expect(
      await t.prisma.userSession.findFirstOrThrow({ where: { userId: user.id } }),
    ).toMatchObject({
      revokedReason: 'USER_BLOCKED',
    });
  });

  it('cookie yo‘q yoki soxta → 401', async () => {
    await refresh(t, undefined).expect(401);
    await refresh(t, 'dv_refresh=soxta').expect(401);
    await refresh(t, `dv_refresh=${'A'.repeat(43)}`).expect(401);
  });

  it.each([
    ['X-Requested-With yo‘q', { 'X-Requested-With': '' }],
    ['begona Origin', { Origin: 'https://evil.example' }],
    ['Origin yo‘q', { Origin: '' }],
  ])('CSRF: %s → 403 FORBIDDEN (refresh va logout)', async (_label, headers) => {
    const user = await createUser(t, { password: PASSWORD });
    const cookie = refreshCookieOf(
      await login(t, { login: user.login, password: PASSWORD }).expect(200),
    );
    const build = (path: string) => {
      const req = http().post(`/api/v1/auth/${path}`).set('Cookie', cookie);
      const all = { Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest', ...headers };
      for (const [key, value] of Object.entries(all)) if (value) req.set(key, value);
      return req;
    };
    expect((await build('refresh').expect(403)).body.error.code).toBe('FORBIDDEN');
    await build('logout').expect(403);
    // Sessiya buzilmagan: to'g'ri so'rov hali ham ishlaydi.
    await refresh(t, cookie).expect(200);
  });
});

describe('POST /auth/logout', () => {
  it('204, sessiya LOGOUT bilan yopiladi, cookie tozalanadi, audit; keyin refresh ishlamaydi', async () => {
    const user = await createUser(t, { password: PASSWORD });
    const cookie = refreshCookieOf(
      await login(t, { login: user.login, password: PASSWORD }).expect(200),
    );
    const res = await http()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .set('X-Requested-With', 'XMLHttpRequest')
      .expect(204);
    const cleared = String(res.headers['set-cookie']);
    expect(cleared).toMatch(/dv_refresh=;/);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Path=/api/v1/auth');
    expect(
      await t.prisma.userSession.findFirstOrThrow({ where: { userId: user.id } }),
    ).toMatchObject({
      revokedReason: 'LOGOUT',
    });
    expect((await auditFor('AUTH_LOGOUT'))[0]).toMatchObject({ actorId: user.id });
    await refresh(t, cookie).expect(401);
  });

  it('idempotent: cookie‘siz ham 204', async () => {
    await http()
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-Requested-With', 'XMLHttpRequest')
      .expect(204);
  });
});

describe('RBAC (RBAC §4)', () => {
  let warehouseA: string;
  let warehouseB: string;

  beforeAll(async () => {
    const owner = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
    const create = async (suffix: string) =>
      (
        await t.prisma.warehouse.create({
          data: { name: `RBAC ${suffix} ${uniqueLogin()}`, createdById: owner.id },
        })
      ).id;
    warehouseA = await create('A');
    warehouseB = await create('B');
  });

  async function tokenFor(role: 'ADMIN' | 'USER', warehouseIds: string[] = []) {
    const user = await createUser(t, { password: PASSWORD, role, warehouseIds });
    return (await login(t, { login: user.login, password: PASSWORD }).expect(200)).body
      .accessToken as string;
  }

  it('anonim → 401 UNAUTHENTICATED (barcha himoyalangan endpointlar)', async () => {
    for (const path of ['users-manage', 'sales-any', 'reports-and-audit', 'context']) {
      const res = await http().get(`/api/v1/__rbac/${path}`).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('USER: ruxsat etilgan → 200, admin permission → 403 FORBIDDEN; kontekst = ROLE_PERMISSIONS.USER', async () => {
    const token = await tokenFor('USER', [warehouseA]);
    await http().get('/api/v1/__rbac/sales-any').set(bearer(token)).expect(200);
    const forbidden = await http()
      .get('/api/v1/__rbac/users-manage')
      .set(bearer(token))
      .expect(403);
    expect(forbidden.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Bu amalni bajarishga ruxsatingiz yo‘q',
    });
    await http().get('/api/v1/__rbac/reports-and-audit').set(bearer(token)).expect(403);
    const ctx = await http().get('/api/v1/__rbac/context').set(bearer(token)).expect(200);
    expect(ctx.body).toMatchObject({
      role: 'USER',
      permissions: [...ROLE_PERMISSIONS.USER].sort(),
      warehouseIds: [warehouseA],
    });
  });

  it('ADMIN: barcha permission endpointlari → 200', async () => {
    const token = await tokenFor('ADMIN');
    for (const path of ['users-manage', 'sales-any', 'reports-and-audit', 'context']) {
      await http().get(`/api/v1/__rbac/${path}`).set(bearer(token)).expect(200);
    }
  });

  it('ombor ownership: USER faqat biriktirilgan omborga; ADMIN istalganiga (OWN-02)', async () => {
    const user = await tokenFor('USER', [warehouseA]);
    await http().get(`/api/v1/__rbac/warehouses/${warehouseA}`).set(bearer(user)).expect(200);
    const denied = await http()
      .get(`/api/v1/__rbac/warehouses/${warehouseB}`)
      .set(bearer(user))
      .expect(403);
    expect(denied.body.error.code).toBe('WAREHOUSE_ACCESS_DENIED');
    const admin = await tokenFor('ADMIN');
    await http().get(`/api/v1/__rbac/warehouses/${warehouseB}`).set(bearer(admin)).expect(200);
  });

  it('himoyasiz endpoint yo‘q (barcha route‘lar decorator bilan)', () => {
    expect(t.app.get(RouteSecurityAuditor).findUnprotectedRoutes()).toEqual([]);
  });
});
