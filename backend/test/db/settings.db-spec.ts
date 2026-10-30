import { AuditAction } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
} from './support/auth-app.js';
import { closePool, withCommit } from './support/db.js';
import { createGroup, createProduct, createWarehouse, receive } from './support/fixtures.js';

const PASSWORD = '582913';

let t: AuthTestApp;
let adminToken: string;
let sellerToken: string;
let original: Record<string, string>;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function api(method: 'get' | 'patch', path: string, token: string | null = adminToken) {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

const settingsAudit = () =>
  t.prisma.auditLog.findMany({
    where: { action: AuditAction.SETTINGS_UPDATED },
    orderBy: { id: 'asc' },
  });

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminToken = await signIn(admin.login);
  sellerToken = await signIn((await createUser(t, { password: PASSWORD })).login);
  original = (await api('get', '/settings').expect(200)).body;
});

afterAll(async () => {
  // Boshqa test fayllari standart chegaraga tayanadi — boshlang'ich qiymatlar qaytariladi.
  await api('patch', '/settings').send(original);
  await t?.close();
  await closePool();
});

describe('sozlamalar (API §16, D-21)', () => {
  it('faqat 3 ta maydon; anonim → 401; sotuvchi o‘qiy ham, o‘zgartira ham olmaydi → 403', async () => {
    expect(Object.keys(original).sort()).toEqual([
      'companyName',
      'currencyLabel',
      'lowStockDefaultThreshold',
    ]);
    await api('get', '/settings', null).expect(401);
    await api('get', '/settings', sellerToken).expect(403);
    await api('patch', '/settings', sellerToken).send({ companyName: 'X' }).expect(403);
  });

  it('qisman PATCH; chegara normallashtiriladi; audit before/after; o‘zgarishsiz — audit yo‘q', async () => {
    const before = (await settingsAudit()).length;
    const res = await api('patch', '/settings')
      .send({ companyName: '  Divine Savdo  ', lowStockDefaultThreshold: '7.500' })
      .expect(200);
    expect(res.body).toEqual({
      companyName: 'Divine Savdo',
      lowStockDefaultThreshold: '7.5',
      currencyLabel: original.currencyLabel,
    });
    const audits = await settingsAudit();
    expect(audits).toHaveLength(before + 1);
    expect(audits.at(-1)!.metadata).toEqual({
      changes: {
        companyName: { from: original.companyName, to: 'Divine Savdo' },
        lowStockDefaultThreshold: { from: original.lowStockDefaultThreshold, to: '7.5' },
      },
    });
    await api('patch', '/settings').send({ lowStockDefaultThreshold: '7.50' }).expect(200);
    expect(await settingsAudit()).toHaveLength(before + 1);
  });

  it('validatsiya: bo‘sh body, noma’lum maydon (eski mock maydonlari ham), manfiy/noto‘g‘ri chegara, uzun valyuta → 400', async () => {
    for (const body of [
      {},
      { legalName: 'MChJ' },
      { requireIncomingConfirmation: false },
      { lowStockDefaultThreshold: '-1' },
      { lowStockDefaultThreshold: '1.2345' },
      { currencyLabel: 'x'.repeat(11) },
      { companyName: ' ' },
    ]) {
      await api('patch', '/settings').send(body).expect(400);
    }
    await api('patch', '/settings').send({ lowStockDefaultThreshold: '0' }).expect(200);
  });

  it('kam qoldiq chegarasi dashboard va ombor hisobotida darhol qo‘llanadi', async () => {
    const admin = await t.prisma.user.findFirstOrThrow({ where: { role: { code: 'ADMIN' } } });
    const { warehouseId, productId } = await withCommit(async (db) => {
      const warehouseId = await createWarehouse(db, admin.id);
      const groupId = await createGroup(db, admin.id);
      const productId = await createProduct(db, { groupId, actor: admin.id });
      await receive(db, { warehouseId, actor: admin.id, lines: [{ productId, quantity: '8' }] });
      return { warehouseId, productId };
    });
    const status = async () =>
      (await api('get', `/reports/warehouse-stock?warehouseId=${warehouseId}`).expect(200)).body
        .data[0].status;
    const lowCount = async () =>
      (await api('get', '/dashboard/summary').expect(200)).body.lowStock.count as number;

    await api('patch', '/settings').send({ lowStockDefaultThreshold: '5' }).expect(200);
    expect(await status()).toBe('inStock');
    const countAt5 = await lowCount();
    await api('patch', '/settings').send({ lowStockDefaultThreshold: '10' }).expect(200);
    expect(await status()).toBe('lowStock');
    expect(await lowCount()).toBeGreaterThan(countAt5);
    const [row] = await t.prisma.$queryRaw<{ low: boolean }[]>`
      SELECT coalesce((SELECT sum(quantity) FROM warehouse_stock WHERE product_id = ${productId}::uuid), 0) <= 10 AS low`;
    expect(row!.low).toBe(true);
  });
});
