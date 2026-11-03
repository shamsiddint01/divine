import { AuditAction } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
  uniqueLogin,
} from './support/auth-app.js';
import { closePool } from './support/db.js';

const PASSWORD = '582913';
/** Test soati 2026-10-09T08:00Z → Toshkentda 2026-10-09 13:00 (`createAuthApp`). */
const TODAY = '2026-10-09';
const TOMORROW = '2026-10-10';

let t: AuthTestApp;
let adminToken: string;
let sellerToken: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function api(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, token?: string) {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

async function category(name = uniqueLogin('Kat'), token = adminToken): Promise<string> {
  return (await api('post', '/expense-categories', token).send({ name }).expect(201)).body.id;
}

const createExpense = (body: Record<string, unknown>, token = adminToken) =>
  api('post', '/expenses', token).send(body);

const auditOf = (entityId: string) =>
  t.prisma.auditLog.findMany({ where: { entityId }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminToken = await signIn(admin.login);
  const seller = await createUser(t, { password: PASSWORD });
  sellerToken = await signIn(seller.login);
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('xarajat qo‘shish va validatsiya (REQ-100, BR-32, D-11, D-19)', () => {
  it('ADMIN: 201 — sana, summa, kategoriya, izoh, muallif; audit’da izoh matni yo‘q', async () => {
    const categoryId = await category('Ijara ' + uniqueLogin(''));
    const res = await createExpense({
      date: '2026-10-01',
      amount: '3500000.5',
      categoryId,
      note: '  Do‘kon ijarasi — Karimov A. ',
    }).expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      date: '2026-10-01',
      amount: '3500000.50',
      category: { id: categoryId, name: expect.stringMatching(/^Ijara /) },
      note: 'Do‘kon ijarasi — Karimov A.',
      createdBy: expect.objectContaining({ login: expect.any(String) }),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('status');
    const [audit] = await auditOf(res.body.id);
    expect(audit).toMatchObject({ action: AuditAction.EXPENSE_CREATED, entityType: 'EXPENSE' });
    expect(audit!.metadata).toEqual({
      date: '2026-10-01',
      amount: '3500000.50',
      categoryId,
      hasNote: true,
    });
    expect(JSON.stringify(audit!.metadata)).not.toMatch(/Karimov|ijarasi/);
  });

  it('rad etiladi: kategoriyasiz, summa ≤ 0, 3 kasr, holat (D-11), noto‘g‘ri sana, noma’lum maydon → 400', async () => {
    const categoryId = await category();
    const ok = { date: TODAY, amount: '100', categoryId };
    const cases: [Record<string, unknown>, string][] = [
      [{ date: TODAY, amount: '100' }, 'categoryId'],
      [{ ...ok, categoryId: 'ijara' }, 'categoryId'],
      [{ ...ok, amount: '0' }, 'amount'],
      [{ ...ok, amount: '-10' }, 'amount'],
      [{ ...ok, amount: '1.005' }, 'amount'],
      // Noma'lum maydon — umumiy konvensiya: `field: ''` (products.db-spec bilan bir xil).
      [{ ...ok, status: 'PAID' }, ''],
      [{ ...ok, date: '09.10.2026' }, 'date'],
      [{ ...ok, date: '2026-02-30' }, 'date'],
    ];
    for (const [body, field] of cases) {
      const res = await createExpense(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    }
    expect(await t.prisma.expense.count({ where: { categoryId } })).toBe(0);
  });

  it('D-19: sana Toshkent bo‘yicha bugundan keyin → 400 (`date`); bugun va o‘tgan sana → 201', async () => {
    const categoryId = await category();
    const future = await createExpense({ date: TOMORROW, amount: '100', categoryId }).expect(400);
    expect(future.body.error.details).toEqual([
      { field: 'date', message: 'Xarajat sanasi bugundan keyin bo‘lishi mumkin emas' },
    ]);
    await createExpense({ date: TODAY, amount: '100', categoryId }).expect(201);
    await createExpense({ date: '2024-01-31', amount: '100', categoryId }).expect(201);
    expect(await t.prisma.expense.count({ where: { categoryId } })).toBe(2);
  });

  it('noma’lum kategoriya → 404 (`categoryId`); nofaol kategoriya → 422 EXPENSE_CATEGORY_INACTIVE', async () => {
    const missing = await createExpense({
      date: TODAY,
      amount: '100',
      categoryId: '01990000-0000-7000-8000-000000000000',
    }).expect(404);
    expect(missing.body.error.details).toEqual([expect.objectContaining({ field: 'categoryId' })]);
    const categoryId = await category();
    await api('patch', `/expense-categories/${categoryId}`, adminToken)
      .send({ isActive: false })
      .expect(200);
    const inactive = await createExpense({ date: TODAY, amount: '100', categoryId }).expect(422);
    expect(inactive.body.error).toMatchObject({
      code: 'EXPENSE_CATEGORY_INACTIVE',
      details: [{ field: 'categoryId' }],
    });
    expect(await t.prisma.expense.count({ where: { categoryId } })).toBe(0);
  });
});

describe('ruxsatlar (RBAC §5, D-12, D-19, D-23)', () => {
  it('anonim → 401 barcha endpointlarda', async () => {
    const id = '01990000-0000-7000-8000-000000000000';
    for (const [method, path] of [
      ['get', '/expenses'],
      ['get', `/expenses/${id}`],
      ['post', '/expenses'],
      ['patch', `/expenses/${id}`],
      ['delete', `/expenses/${id}`],
      ['get', '/expense-categories'],
      ['post', '/expense-categories'],
      ['patch', `/expense-categories/${id}`],
      ['delete', `/expense-categories/${id}`],
    ] as const) {
      await api(method, path).expect(401);
    }
  });

  it('sotuvchi (D-23): admin kategoriyalari ko‘rinmaydi va tanlab bo‘lmaydi; o‘z kategoriyasini qo‘shadi (`id, name`)', async () => {
    const adminCategory = await category();
    const list = await api('get', '/expense-categories', sellerToken).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).not.toContain(adminCategory);
    // Begona (admin) kategoriyasi bilan xarajat — 404, mavjudligi oshkor qilinmaydi.
    const foreign = await createExpense(
      { date: TODAY, amount: '1000', categoryId: adminCategory },
      sellerToken,
    ).expect(404);
    expect(foreign.body.error.details).toEqual([
      { field: 'categoryId', message: expect.any(String) },
    ]);

    // Admin bilan bir xil nom — sotuvchiga ruxsat (nom user ichida noyob); o'zida takror → 409.
    const adminName = (
      await t.prisma.expenseCategory.findUniqueOrThrow({ where: { id: adminCategory } })
    ).name;
    const own = await api('post', '/expense-categories', sellerToken)
      .send({ name: adminName })
      .expect(201);
    expect(Object.keys(own.body).sort()).toEqual(['id', 'name']);
    await api('post', '/expense-categories', sellerToken)
      .send({ name: adminName.toUpperCase() })
      .expect(409);
    const mine = await api('get', '/expense-categories', sellerToken).expect(200);
    expect(mine.body.map((c: { id: string }) => c.id)).toContain(own.body.id);
    for (const c of mine.body) expect(Object.keys(c).sort()).toEqual(['id', 'name']);
    // Admin hammasini ko'radi — kim qo'shgani bilan.
    const all = await api('get', '/expense-categories', adminToken).expect(200);
    expect(all.body.find((c: { id: string }) => c.id === own.body.id)).toMatchObject({
      createdBy: { login: expect.any(String) },
    });
  });

  it('sotuvchi (D-23): faqat o‘z xarajatlari ro‘yxatda va detalda; adminniki — ro‘yxatda yo‘q, detal 404; tahrirlash/o‘chirish 403', async () => {
    const adminCategory = await category();
    const adminExpense = await createExpense({
      date: TODAY,
      amount: '999000',
      categoryId: adminCategory,
    }).expect(201);
    const sellerCategory = await category(uniqueLogin('Sot'), sellerToken);
    const created = await createExpense(
      { date: TODAY, amount: '45000', categoryId: sellerCategory, note: 'Tushlik' },
      sellerToken,
    ).expect(201);
    const id = created.body.id as string;
    const seller = await t.prisma.user.findFirstOrThrow({
      where: { login: created.body.createdBy.login },
    });
    expect((await t.prisma.expense.findUniqueOrThrow({ where: { id } })).createdById).toBe(
      seller.id,
    );

    // `createdBy` filtrini boshqa userga qo'ysa ham — baribir faqat o'ziniki.
    const list = await api(
      'get',
      `/expenses?pageSize=100&createdBy=${adminExpense.body.createdBy.id}`,
      sellerToken,
    ).expect(200);
    const ids = list.body.data.map((e: { id: string }) => e.id);
    expect(ids).toContain(id);
    expect(ids).not.toContain(adminExpense.body.id);
    expect(
      list.body.data.every((e: { createdBy: { id: string } }) => e.createdBy.id === seller.id),
    ).toBe(true);
    expect(list.body.summary.count).toBe(list.body.meta.total);
    await api('get', `/expenses/${id}`, sellerToken).expect(200);
    await api('get', `/expenses/${adminExpense.body.id}`, sellerToken).expect(404);

    await api('patch', `/expenses/${id}`, sellerToken).send({ amount: '1' }).expect(403);
    await api('delete', `/expenses/${id}`, sellerToken).expect(403);
    await api('patch', `/expense-categories/${sellerCategory}`, sellerToken)
      .send({ isActive: false })
      .expect(403);
    await api('delete', `/expense-categories/${sellerCategory}`, sellerToken).expect(403);
    const after = await t.prisma.expense.findUniqueOrThrow({ where: { id } });
    expect(after.amount.toFixed(2)).toBe('45000.00');
    expect(after.deletedAt).toBeNull();
    // Admin sotuvchining xarajatini ham ko'radi.
    const adminList = await api('get', '/expenses?pageSize=100', adminToken).expect(200);
    expect(adminList.body.data.map((e: { id: string }) => e.id)).toContain(id);
  });

  it('ADMIN: kategoriyalar to‘liq (holat, xarajatlar soni), `isActive` filtri bilan', async () => {
    const off = await category();
    await api('patch', `/expense-categories/${off}`, adminToken)
      .send({ isActive: false })
      .expect(200);
    const all = await api('get', '/expense-categories', adminToken).expect(200);
    expect(all.body.find((c: { id: string }) => c.id === off)).toMatchObject({
      isActive: false,
      expenseCount: 0,
    });
    const inactiveOnly = await api('get', '/expense-categories?isActive=false', adminToken);
    expect(inactiveOnly.body.every((c: { isActive: boolean }) => !c.isActive)).toBe(true);
    await api('get', '/expense-categories?isActive=ha', adminToken).expect(400);
  });
});

describe('qisman tahrirlash (PATCH, API §12)', () => {
  it('faqat yuborilgan maydon o‘zgaradi; izohni tozalash; audit — o‘zgarishlar, izoh matnisiz', async () => {
    const categoryId = await category();
    const other = await category();
    const e = (
      await createExpense({ date: '2026-10-05', amount: '1000', categoryId, note: 'Eski izoh' })
    ).body;

    const amountOnly = await api('patch', `/expenses/${e.id}`, adminToken)
      .send({ amount: '1500.5' })
      .expect(200);
    expect(amountOnly.body).toMatchObject({
      date: '2026-10-05',
      amount: '1500.50',
      category: { id: categoryId },
      note: 'Eski izoh',
    });

    const moved = await api('patch', `/expenses/${e.id}`, adminToken)
      .send({ categoryId: other, note: null, date: '2026-10-06' })
      .expect(200);
    expect(moved.body).toMatchObject({
      date: '2026-10-06',
      amount: '1500.50',
      category: { id: other },
      note: null,
    });

    const audit = await auditOf(e.id);
    expect(audit.map((a) => a.action)).toEqual([
      AuditAction.EXPENSE_CREATED,
      AuditAction.EXPENSE_UPDATED,
      AuditAction.EXPENSE_UPDATED,
    ]);
    expect(audit[1]!.metadata).toEqual({
      fields: ['amount'],
      changes: { amount: { from: '1000.00', to: '1500.50' } },
    });
    expect(audit[2]!.metadata).toEqual({
      fields: ['date', 'categoryId', 'note'],
      changes: {
        date: { from: '2026-10-05', to: '2026-10-06' },
        categoryId: { from: categoryId, to: other },
      },
    });
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toMatch(/Eski izoh/);
    const row = await t.prisma.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.updatedById).not.toBeNull();
  });

  it('o‘zgarishsiz (`"1500"` = `"1500.00"`) — audit yo‘q; bo‘sh body → 400; holat → 400', async () => {
    const categoryId = await category();
    const e = (await createExpense({ date: TODAY, amount: '1500.00', categoryId })).body;
    const same = await api('patch', `/expenses/${e.id}`, adminToken)
      .send({ amount: '1500', categoryId, date: TODAY })
      .expect(200);
    expect(same.body.updatedAt).toBe(e.updatedAt);
    expect((await auditOf(e.id)).map((a) => a.action)).toEqual([AuditAction.EXPENSE_CREATED]);
    await api('patch', `/expenses/${e.id}`, adminToken).send({}).expect(400);
    await api('patch', `/expenses/${e.id}`, adminToken).send({ status: 'PENDING' }).expect(400);
    await api('patch', `/expenses/${e.id}`, adminToken).send({ amount: '0' }).expect(400);
  });

  it('kelajak sanaga → 400; nofaol kategoriyaga ko‘chirish → 422; nofaol kategoriyadagi eski xarajatni boshqa maydon bilan tahrirlash mumkin', async () => {
    const categoryId = await category();
    const e = (await createExpense({ date: TODAY, amount: '700', categoryId })).body;
    await api('patch', `/expenses/${e.id}`, adminToken).send({ date: TOMORROW }).expect(400);

    const off = await category();
    await api('patch', `/expense-categories/${off}`, adminToken)
      .send({ isActive: false })
      .expect(200);
    const rejected = await api('patch', `/expenses/${e.id}`, adminToken)
      .send({ categoryId: off })
      .expect(422);
    expect(rejected.body.error.code).toBe('EXPENSE_CATEGORY_INACTIVE');

    await api('patch', `/expense-categories/${categoryId}`, adminToken)
      .send({ isActive: false })
      .expect(200);
    const kept = await api('patch', `/expenses/${e.id}`, adminToken)
      .send({ amount: '800', categoryId })
      .expect(200);
    expect(kept.body).toMatchObject({ amount: '800.00', category: { id: categoryId } });
  });

  it('noma’lum xarajat → 404', async () => {
    await api('patch', '/expenses/01990000-0000-7000-8000-000000000000', adminToken)
      .send({ amount: '1' })
      .expect(404);
    await api('get', '/expenses/abc', adminToken).expect(400);
  });
});

describe('soft delete (API §12, BR-33)', () => {
  it('204; ro‘yxat, detal va yig‘madan chiqadi; qator bazada qoladi; qayta o‘chirish va tahrirlash → 404; audit', async () => {
    const categoryId = await category();
    const keep = (await createExpense({ date: TODAY, amount: '100', categoryId })).body;
    const gone = (await createExpense({ date: TODAY, amount: '250', categoryId })).body;
    const before = await api('get', `/expenses?categoryId=${categoryId}`, adminToken).expect(200);
    expect(before.body.summary).toEqual({ count: 2, totalAmount: '350.00' });

    await api('delete', `/expenses/${gone.id}`, adminToken).expect(204);

    const after = await api('get', `/expenses?categoryId=${categoryId}`, adminToken).expect(200);
    expect(after.body.data.map((e: { id: string }) => e.id)).toEqual([keep.id]);
    expect(after.body.summary).toEqual({ count: 1, totalAmount: '100.00' });
    await api('get', `/expenses/${gone.id}`, adminToken).expect(404);
    await api('delete', `/expenses/${gone.id}`, adminToken).expect(404);
    await api('patch', `/expenses/${gone.id}`, adminToken).send({ amount: '1' }).expect(404);

    const row = await t.prisma.expense.findUniqueOrThrow({ where: { id: gone.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).not.toBeNull();
    expect(row.amount.toFixed(2)).toBe('250.00');
    const audit = await auditOf(gone.id);
    expect(audit.map((a) => a.action)).toEqual([
      AuditAction.EXPENSE_CREATED,
      AuditAction.EXPENSE_DELETED,
    ]);
    expect(audit[1]!.metadata).toEqual({ date: TODAY, amount: '250.00', categoryId });
  });
});

describe('parallel o‘chirish', () => {
  it('bir xarajatni 2 ta parallel DELETE: bittasi 204, ikkinchisi 404; audit bitta', async () => {
    const categoryId = await category();
    const e = (await createExpense({ date: TODAY, amount: '60', categoryId })).body;
    const results = await Promise.all([
      api('delete', `/expenses/${e.id}`, adminToken),
      api('delete', `/expenses/${e.id}`, adminToken),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
    expect((await auditOf(e.id)).map((a) => a.action)).toEqual([
      AuditAction.EXPENSE_CREATED,
      AuditAction.EXPENSE_DELETED,
    ]);
  });
});

describe('ro‘yxat: filtrlar, saralash, pagination, yig‘ma (REQ-101)', () => {
  it('sana oralig‘i, kategoriya, kiritgan user, izoh qidiruvi birgalikda; yig‘ma butun filtr bo‘yicha', async () => {
    const author = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
    const token = await signIn(author.login);
    const a = await category();
    const b = await category();
    const tag = uniqueLogin('Filtr');
    const rows = [
      { date: '2026-09-30', amount: '10.00', categoryId: a, note: `${tag} oktabrdan oldin` },
      { date: '2026-10-01', amount: '20.50', categoryId: a, note: `${tag} 100%_belgi` },
      { date: '2026-10-03', amount: '30.00', categoryId: b, note: `${tag} boshqa` },
      { date: '2026-10-05', amount: '40.00', categoryId: a },
    ];
    for (const body of rows) await createExpense(body, token).expect(201);
    const mine = `createdBy=${author.id}`;

    const all = await api('get', `/expenses?${mine}&pageSize=2`, adminToken).expect(200);
    expect(all.body.meta).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(all.body.data.map((e: { date: string }) => e.date)).toEqual([
      '2026-10-05',
      '2026-10-03',
    ]);
    expect(all.body.summary).toEqual({ count: 4, totalAmount: '100.50' });

    const range = await api(
      'get',
      `/expenses?${mine}&dateFrom=2026-10-01&dateTo=2026-10-03`,
      adminToken,
    ).expect(200);
    expect(range.body.summary).toEqual({ count: 2, totalAmount: '50.50' });

    const combined = await api(
      'get',
      `/expenses?${mine}&dateFrom=2026-10-01&categoryId=${a}`,
      adminToken,
    ).expect(200);
    expect(combined.body.data.map((e: { amount: string }) => e.amount)).toEqual(['40.00', '20.50']);

    const search = await api(
      'get',
      `/expenses?${mine}&search=${encodeURIComponent('100%_')}`,
      adminToken,
    ).expect(200);
    expect(search.body.data.map((e: { amount: string }) => e.amount)).toEqual(['20.50']);
    const percentOnly = await api('get', `/expenses?${mine}&search=%25`, adminToken).expect(200);
    expect(percentOnly.body.summary.count).toBe(1);

    const byAmount = await api('get', `/expenses?${mine}&sort=amount:asc`, adminToken).expect(200);
    expect(byAmount.body.data.map((e: { amount: string }) => e.amount)).toEqual([
      '10.00',
      '20.50',
      '30.00',
      '40.00',
    ]);

    const empty = await api('get', `/expenses?${mine}&dateFrom=2027-01-01`, adminToken).expect(200);
    expect(empty.body).toMatchObject({ data: [], summary: { count: 0, totalAmount: '0.00' } });

    await api('get', '/expenses?sort=status:asc', adminToken).expect(400);
    await api('get', '/expenses?dateFrom=2026-10-05&dateTo=2026-10-01', adminToken).expect(400);
    await api('get', '/expenses?categoryId=abc', adminToken).expect(400);
  });
});

describe('kategoriyalar (D-19, BR-31)', () => {
  it('nom registrsiz unique → 409; qayta nomlash; nofaol qilish — eski xarajatlarda nomi saqlanadi; audit', async () => {
    const name = uniqueLogin('Kommunal');
    const id = await category(name);
    const dup = await api('post', '/expense-categories', adminToken)
      .send({ name: name.toUpperCase() })
      .expect(409);
    expect(dup.body.error).toMatchObject({ code: 'NAME_TAKEN', details: [{ field: 'name' }] });
    await api('post', '/expense-categories', adminToken).send({ name: ' ' }).expect(400);

    const e = (await createExpense({ date: TODAY, amount: '90', categoryId: id })).body;
    const renamed = await api('patch', `/expense-categories/${id}`, adminToken)
      .send({ name: `${name} 2`, isActive: false })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: `${name} 2`, isActive: false, expenseCount: 1 });
    const detail = await api('get', `/expenses/${e.id}`, adminToken).expect(200);
    expect(detail.body.category).toEqual({ id, name: `${name} 2` });

    const other = await category();
    await api('patch', `/expense-categories/${other}`, adminToken)
      .send({ name: `${name} 2` })
      .expect(409);

    const audit = await auditOf(id);
    expect(audit.map((a) => a.action)).toEqual([
      AuditAction.EXPENSE_CATEGORY_CREATED,
      AuditAction.EXPENSE_CATEGORY_UPDATED,
    ]);
    expect(audit[1]!.metadata).toMatchObject({
      changes: { name: { from: name, to: `${name} 2` }, isActive: { from: true, to: false } },
    });
  });

  it('ishlatilgan kategoriya (soft-delete qilingan xarajat bilan ham) o‘chirilmaydi → 409; bo‘shi → 204', async () => {
    const used = await category();
    const e = (await createExpense({ date: TODAY, amount: '5', categoryId: used })).body;
    await api('delete', `/expenses/${e.id}`, adminToken).expect(204);
    const res = await api('delete', `/expense-categories/${used}`, adminToken).expect(409);
    expect(res.body.error.code).toBe('ENTITY_IN_USE');
    expect(await t.prisma.expenseCategory.count({ where: { id: used } })).toBe(1);

    const unused = await category();
    await api('delete', `/expense-categories/${unused}`, adminToken).expect(204);
    await api('delete', `/expense-categories/${unused}`, adminToken).expect(404);
    expect((await auditOf(unused)).map((a) => a.action)).toEqual([
      AuditAction.EXPENSE_CATEGORY_CREATED,
      AuditAction.EXPENSE_CATEGORY_DELETED,
    ]);
  });
});

describe('moliyaviy yaxlitlik', () => {
  it('xarajat qo‘shish, tahrirlash, o‘chirish ombor ledger’i, qoldig‘i va sotuvlarga ta’sir qilmaydi', async () => {
    const snapshot = async () => ({
      movements: await t.prisma.inventoryMovement.count(),
      sales: await t.prisma.sale.count(),
      stock: (
        await t.prisma.warehouseStock.aggregate({ _sum: { quantity: true } })
      )._sum.quantity?.toFixed(3),
    });
    const before = await snapshot();
    const categoryId = await category();
    const e = (await createExpense({ date: TODAY, amount: '1000', categoryId })).body;
    await api('patch', `/expenses/${e.id}`, adminToken).send({ amount: '2000' }).expect(200);
    await api('delete', `/expenses/${e.id}`, adminToken).expect(204);
    expect(await snapshot()).toEqual(before);
  });
});
