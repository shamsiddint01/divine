import { ALL_PERMISSIONS, AuditAction } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessContext } from '../../src/common/auth/access-context.js';
import { CustomersService } from '../../src/modules/customers/customers.service.js';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
  uniqueLogin,
} from './support/auth-app.js';
import { closePool, withCommit } from './support/db.js';
import { baseContext, createProduct, receive, sell } from './support/fixtures.js';

const PASSWORD = '582913';

let t: AuthTestApp;
let adminId: string;
let adminToken: string;
let sellerToken: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function api(method: 'get' | 'post' | 'patch' | 'delete', path: string, token?: string) {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

/** Boshqa test fayllari mijozlari bilan aralashmasligi uchun noyob telefon (`+99893XXXXXXX`). */
let phoneSeq = 0;
const uniquePhone = () =>
  `+99893${(Date.now() % 1e5).toString().padStart(5, '0')}${(phoneSeq++ % 100).toString().padStart(2, '0')}`;

const create = (body: Record<string, unknown>, token = adminToken) =>
  api('post', '/customers', token).send(body);

const auditOf = (entityId: string) =>
  t.prisma.auditLog.findMany({ where: { entityId }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminId = admin.id;
  adminToken = await signIn(admin.login);
  const seller = await createUser(t, { password: PASSWORD });
  sellerToken = await signIn(seller.login);
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('yaratish, validatsiya, takroriy mijozlar (BR-05, BR-06, A-23)', () => {
  it('ism trim, telefon +998XXXXXXXXX ga normallashtiriladi; bo‘sh telefon → null; audit’da shaxsiy ma’lumot yo‘q', async () => {
    const tag = uniqueLogin('Aziz');
    const phone = uniquePhone();
    const res = await create({
      name: `  ${tag} Karimov `,
      phone: `${phone.slice(4, 6)} ${phone.slice(6, 9)}-${phone.slice(9, 11)}-${phone.slice(11)}`,
      notes: 'Doimiy mijoz',
    }).expect(201);
    expect(res.body).toMatchObject({
      name: `${tag} Karimov`,
      phone,
      notes: 'Doimiy mijoz',
      purchaseCount: 0,
      totalSpent: '0.00',
      lastPurchaseAt: null,
    });
    const noPhone = await create({ name: `${tag} 2`, phone: '' }).expect(201);
    expect(noPhone.body.phone).toBeNull();

    const [audit] = await auditOf(res.body.id);
    expect(audit).toMatchObject({
      action: AuditAction.CUSTOMER_CREATED,
      actorId: adminId,
      entityType: 'CUSTOMER',
    });
    expect(audit!.metadata).toEqual({ hasPhone: true, hasNotes: true });
    expect(JSON.stringify(audit!.metadata)).not.toMatch(
      new RegExp(`${tag}|${phone.slice(4)}|Doimiy`),
    );
  });

  it.each([
    ['ismsiz', { phone: '+998901234567' }],
    ['bo‘sh ism', { name: '   ' }],
    ['150 belgidan uzun ism', { name: 'x'.repeat(151) }],
    ['noto‘g‘ri telefon', { name: 'Aziz', phone: '123' }],
    ['xorijiy telefon', { name: 'Aziz', phone: '+7 999 123 45 67' }],
    ['yig‘ma maydon (client)', { name: 'Aziz', purchaseCount: 5 }],
    ['uzun izoh', { name: 'Aziz', notes: 'x'.repeat(1001) }],
  ])('validatsiya: %s → 400', async (_label, body) => {
    const res = await create(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('takroriy ism va telefon rad etilmaydi (oila a’zolari — A-23): ikkita alohida mijoz', async () => {
    const name = uniqueLogin('Oila');
    const phone = uniquePhone();
    const a = await create({ name, phone }).expect(201);
    const b = await create({ name, phone }).expect(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(await t.prisma.customer.count({ where: { name, phone } })).toBe(2);
  });
});

describe('ruxsatlar (RBAC §5, OWN-07)', () => {
  it('anonim → 401; sotuvchi: qidiruv minimal maydonlar bilan; detal, xarid tarixi, tahrirlash → 403', async () => {
    const tag = uniqueLogin('Sotuvchi');
    const c = (await create({ name: `${tag} Mijoz`, phone: uniquePhone(), notes: 'Ichki izoh' }))
      .body;
    await api('get', '/customers').expect(401);
    const list = await api('get', `/customers?search=${tag}`, sellerToken).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(Object.keys(list.body.data[0]).sort()).toEqual(['id', 'name', 'phone']);
    expect(list.text).not.toMatch(/Ichki izoh|totalSpent|purchaseCount|lastPurchaseAt/);
    for (const res of [
      await api('get', `/customers/${c.id}`, sellerToken),
      await api('get', `/customers/${c.id}/purchases`, sellerToken),
      await api('patch', `/customers/${c.id}`, sellerToken).send({ name: 'Buzish' }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    for (const sort of ['totalSpent:desc', 'purchaseCount:desc']) {
      await api('get', `/customers?sort=${sort}`, sellerToken).expect(400);
    }
    // POS'dagi qidiruv tartibi (oxirgi xarid) sotuvchiga ham ochiq.
    await api('get', '/customers?sort=lastPurchaseAt:desc', sellerToken).expect(200);
    expect((await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).name).toBe(
      `${tag} Mijoz`,
    );
  });

  it('sotuvchi sotuv vaqtida mijoz yarata oladi (javob minimal); izoh yubora olmaydi → 403', async () => {
    const name = uniqueLogin('Kassa');
    const res = await create({ name, phone: uniquePhone() }, sellerToken).expect(201);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'name', 'phone']);
    const denied = await create({ name: `${name} 2`, notes: 'x' }, sellerToken).expect(403);
    expect(denied.body.error).toMatchObject({ code: 'FORBIDDEN', details: [{ field: 'notes' }] });
    expect(await t.prisma.customer.count({ where: { name: `${name} 2` } })).toBe(0);
  });
});

describe('tahrirlash va tarix (API §10)', () => {
  it('ism, telefon, izoh; telefonni tozalash; audit faqat maydon nomlari; o‘zgarishsiz — audit yo‘q; 404/400', async () => {
    const c = (await create({ name: uniqueLogin('Eski'), phone: uniquePhone() })).body;
    const newName = uniqueLogin('Yangi');
    const res = await api('patch', `/customers/${c.id}`, adminToken)
      .send({ name: newName, phone: null, notes: 'VIP' })
      .expect(200);
    expect(res.body).toMatchObject({ name: newName, phone: null, notes: 'VIP' });
    await api('patch', `/customers/${c.id}`, adminToken).send({ name: newName }).expect(200);
    const updates = (await auditOf(c.id)).filter((a) => a.action === AuditAction.CUSTOMER_UPDATED);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.metadata).toEqual({ fields: ['name', 'phone', 'notes'] });
    expect(JSON.stringify(updates.map((u) => u.metadata))).not.toMatch(
      new RegExp(`${newName}|VIP`),
    );

    await api('patch', `/customers/${c.id}`, adminToken).send({}).expect(400);
    await api('patch', `/customers/${c.id}`, adminToken).send({ phone: '777' }).expect(400);
    await api('patch', '/customers/01990000-0000-7000-8000-000000000000', adminToken)
      .send({ name: 'Yo‘q' })
      .expect(404);
    await api('get', '/customers/not-a-uuid', adminToken).expect(400);
    // O'chirish endpointi yo'q (BR-30).
    await api('delete', `/customers/${c.id}`, adminToken).expect(404);
    expect(await t.prisma.customer.count({ where: { id: c.id } })).toBe(1);
  });

  it('xarid tarixi haqiqiy sotuvlardan; snapshot mijoz tahrirlansa ham o‘zgarmaydi; yig‘ma; sana filtri; tannarx ruxsati', async () => {
    const customerName = uniqueLogin('Xaridor');
    const c = (await create({ name: customerName, phone: uniquePhone() })).body;
    const { saleIds, productName } = await withCommit(async (db) => {
      const ctx = await baseContext(db);
      const productId = await createProduct(db, {
        groupId: ctx.groupId,
        actor: ctx.admin,
        costPrice: '600.00',
        salePrice: '1000.00',
      });
      await receive(db, {
        warehouseId: ctx.warehouseId,
        actor: ctx.admin,
        lines: [{ productId, quantity: '10' }],
      });
      const first = await sell(db, {
        warehouseId: ctx.warehouseId,
        userId: ctx.admin,
        customerId: c.id,
        lines: [{ productId, quantity: '2' }],
      });
      const second = await sell(db, {
        warehouseId: ctx.warehouseId,
        userId: ctx.admin,
        customerId: c.id,
        lines: [{ productId, quantity: '3' }],
      });
      const { rows } = await db.query<{ name: string }>('SELECT name FROM products WHERE id = $1', [
        productId,
      ]);
      return { saleIds: [first.saleId, second.saleId], productName: rows[0]!.name };
    });
    await api('patch', `/customers/${c.id}`, adminToken)
      .send({ name: 'Qayta nomlangan' })
      .expect(200);

    const res = await api('get', `/customers/${c.id}/purchases`, adminToken).expect(200);
    expect(res.body.meta).toMatchObject({ total: 2 });
    expect(res.body.data.map((s: { id: string }) => s.id).sort()).toEqual([...saleIds].sort());
    expect(res.body.data[0]).toMatchObject({
      number: expect.stringMatching(/^S-\d{6,}$/),
      status: 'COMPLETED',
      customer: { id: c.id, name: customerName },
      totalCost: expect.any(String),
      grossProfit: expect.any(String),
    });
    expect(res.body.data[0].items[0]).toMatchObject({ productName, unitCost: '600.00' });
    expect(res.body.summary).toMatchObject({ purchaseCount: 2, totalSpent: '5000.00' });
    expect(res.body.summary.lastPurchaseAt).toEqual(expect.any(String));

    const detail = await api('get', `/customers/${c.id}`, adminToken).expect(200);
    expect(detail.body).toMatchObject({ purchaseCount: 2, totalSpent: '5000.00' });
    const none = await api('get', `/customers/${c.id}/purchases?dateTo=2000-01-01`, adminToken);
    expect(none.body.data).toEqual([]);
    await api(
      'get',
      `/customers/${c.id}/purchases?dateFrom=2026-10-10&dateTo=2026-10-01`,
      adminToken,
    ).expect(400);
    await api(
      'get',
      '/customers/01990000-0000-7000-8000-000000000000/purchases',
      adminToken,
    ).expect(404);

    // `products.read_cost`siz kontekst: tannarx va foyda kaliti yo'q.
    const ctx: AccessContext = {
      userId: adminId,
      login: 'test',
      role: 'ADMIN',
      permissions: new Set(ALL_PERMISSIONS.filter((p) => p !== 'products.read_cost')),
      warehouseIds: new Set(),
      issuedAt: 0,
    };
    const noCost = await t.app.get(CustomersService).purchases(ctx, c.id, {
      page: 1,
      pageSize: 20,
      sort: { field: 'soldAt', direction: 'desc' },
    });
    expect(noCost.data[0]).not.toHaveProperty('totalCost');
    expect(noCost.data[0]).not.toHaveProperty('grossProfit');
    expect(noCost.data[0]!.items?.[0]).not.toHaveProperty('unitCost');
    expect(JSON.stringify(noCost)).not.toContain('600.00');

    const drift = await t.prisma.$queryRaw<unknown[]>`
      SELECT * FROM reconcile_customer_aggregates WHERE customer_id = ${c.id}::uuid`;
    expect(drift).toEqual([]);
  });

  it('xaridsiz mijoz: bo‘sh tarix va nol yig‘ma (soxta ma’lumot yo‘q)', async () => {
    const c = (await create({ name: uniqueLogin('Yangi') })).body;
    const res = await api('get', `/customers/${c.id}/purchases`, adminToken).expect(200);
    expect(res.body).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      summary: { purchaseCount: 0, totalSpent: '0.00', lastPurchaseAt: null },
    });
  });
});

describe('qidiruv, saralash, pagination (REQ-081)', () => {
  it('ism (registrsiz, qisman), telefon raqamlari bo‘yicha; LIKE belgilari ekranlangan', async () => {
    const tag = uniqueLogin('Qidir');
    const phone = uniquePhone();
    const a = (await create({ name: `${tag} Dilnoza`, phone })).body;
    await create({ name: `${tag} Jasur` });
    const byName = await api('get', `/customers?search=${tag.toUpperCase()} dil`, adminToken);
    expect(byName.body.data.map((c: { id: string }) => c.id)).toEqual([a.id]);
    const digits = `${phone.slice(6, 9)} ${phone.slice(9)}`;
    const byPhone = await api('get', `/customers?search=${encodeURIComponent(digits)}`, adminToken);
    expect(byPhone.body.data.map((c: { id: string }) => c.id)).toContain(a.id);
    const wildcard = await api(
      'get',
      `/customers?search=${encodeURIComponent(`${tag}%`)}`,
      adminToken,
    );
    expect(wildcard.body.data).toEqual([]);
  });

  it('saralash va pagination; xarid qilmaganlar "oxirgi xarid" kamayishida oxirida', async () => {
    const tag = uniqueLogin('Sort');
    for (const n of ['B', 'A', 'C']) await create({ name: `${tag} ${n}` }).expect(201);
    const asc = await api('get', `/customers?search=${tag}&sort=name:asc&pageSize=2`, adminToken);
    expect(asc.body.meta).toMatchObject({ total: 3, totalPages: 2 });
    expect(asc.body.data.map((c: { name: string }) => c.name)).toEqual([`${tag} A`, `${tag} B`]);
    const page2 = await api(
      'get',
      `/customers?search=${tag}&sort=name:asc&pageSize=2&page=2`,
      adminToken,
    );
    expect(page2.body.data.map((c: { name: string }) => c.name)).toEqual([`${tag} C`]);
    const desc = await api('get', '/customers?sort=lastPurchaseAt:desc&pageSize=100', adminToken);
    const dates = desc.body.data.map((c: { lastPurchaseAt: string | null }) => c.lastPurchaseAt);
    const firstNull = dates.indexOf(null);
    if (firstNull >= 0) expect(dates.slice(firstNull).every((d: unknown) => d === null)).toBe(true);
    await api('get', '/customers?sort=phone:asc', adminToken).expect(400);
  });
});
