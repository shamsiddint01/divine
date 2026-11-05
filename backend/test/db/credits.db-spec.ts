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
import { closePool } from './support/db.js';

const PASSWORD = '582913';
// Test ilovasi soati (expenses.db-spec bilan bir xil).
const TODAY = '2026-10-09';
const TOMORROW = '2026-10-10';

let t: AuthTestApp;
let adminToken: string;
let sellerToken: string;

function api(method: 'get' | 'post', path: string, token?: string) {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set({ Authorization: `Bearer ${token}` }) : req;
}

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

const body = (extra: Record<string, unknown> = {}) => ({
  debtorName: 'Ali Valiyev',
  debtorPhone: '+998901234567',
  amount: '50000',
  takenAt: `${TODAY}T10:00:00+05:00`,
  firstDueDate: TOMORROW,
  installments: 4,
  ...extra,
});

const create = async (extra: Record<string, unknown> = {}) =>
  (await api('post', '/credits', adminToken).send(body(extra)).expect(201)).body;

const pay = (id: string, amount: string, date = TODAY) =>
  api('post', `/credits/${id}/payments`, adminToken).send({ amount, date });

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

describe('ruxsat: faqat admin (D-24)', () => {
  it('anonim → 401; sotuvchi ro‘yxat, detal, eslatma, qo‘shish, to‘lov → 403 va summalar oshkor bo‘lmaydi', async () => {
    const credit = await create();
    await api('get', '/credits').expect(401);
    for (const res of [
      await api('get', '/credits', sellerToken),
      await api('get', '/credits/reminders', sellerToken),
      await api('get', `/credits/${credit.id}`, sellerToken),
      await api('post', '/credits', sellerToken).send(body()),
      await api('post', `/credits/${credit.id}/payments`, sellerToken).send({
        amount: '1',
        date: TODAY,
      }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.text).not.toContain('Ali Valiyev');
    }
  });
});

describe('nasiya qo‘shish', () => {
  it('50 000 / 4 kun: har kuni 12 500, raqam N-…, audit’da ism va telefon yo‘q', async () => {
    const credit = await create();
    expect(credit).toMatchObject({
      debtorName: 'Ali Valiyev',
      amount: '50000.00',
      paidAmount: '0.00',
      remainingAmount: '50000.00',
      installmentsCount: 4,
      status: 'ACTIVE',
      next: { dueDate: TOMORROW, amount: '12500.00' },
    });
    expect(credit.number).toMatch(/^N-\d{6}$/);
    expect(
      credit.schedule.map((r: { dueDate: string; amount: string }) => [r.dueDate, r.amount]),
    ).toEqual([
      ['2026-10-10', '12500.00'],
      ['2026-10-11', '12500.00'],
      ['2026-10-12', '12500.00'],
      ['2026-10-13', '12500.00'],
    ]);
    const audit = await t.prisma.auditLog.findFirstOrThrow({
      where: { entityId: credit.id, action: AuditAction.CREDIT_CREATED },
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/Ali|998901234567/);
  });

  it('bir yo‘la (1 marta) va har 7 kunda; to‘lov olingan kundan oldin → 400; client summasi → 400', async () => {
    const once = await create({ installments: 1 });
    expect(once.schedule).toHaveLength(1);
    const weekly = await create({ amount: '30000', installments: 3, intervalDays: 7 });
    expect(weekly.schedule.map((r: { dueDate: string }) => r.dueDate)).toEqual([
      '2026-10-10',
      '2026-10-17',
      '2026-10-24',
    ]);
    await api('post', '/credits', adminToken)
      .send(body({ firstDueDate: '2026-10-08' }))
      .expect(400);
    await api('post', '/credits', adminToken)
      .send(body({ remainingAmount: '1' }))
      .expect(400);
  });

  it('summa kamida 1 000 so‘m; telefon majburiy → 400 maydon bilan', async () => {
    const low = await api('post', '/credits', adminToken)
      .send(body({ amount: '999.99', installments: 1 }))
      .expect(400);
    expect(low.body.error.details[0].field).toBe('amount');
    await create({ amount: '1000', installments: 1 });
    const { debtorPhone: _phone, ...noPhone } = body();
    const missing = await api('post', '/credits', adminToken).send(noPhone).expect(400);
    expect(missing.body.error.details[0].field).toBe('debtorPhone');
    await api('post', '/credits', adminToken)
      .send(body({ debtorPhone: '123' }))
      .expect(400);
  });
});

describe('to‘lov: yetmagani keyingisiga, ortig‘i keyingisidan', () => {
  it('ortiqcha to‘lov (20 000): keyingi to‘lovdan ayriladi → 5 000; audit', async () => {
    const credit = await create();
    const res = await pay(credit.id, '20000').expect(201);
    expect(res.body).toMatchObject({
      paidAmount: '20000.00',
      remainingAmount: '30000.00',
      next: { dueDate: '2026-10-11', amount: '5000.00' },
    });
    expect(res.body.payments).toHaveLength(1);
    expect(
      await t.prisma.auditLog.count({
        where: { entityId: credit.id, action: AuditAction.CREDIT_PAYMENT_ADDED },
      }),
    ).toBe(1);
  });

  it('muddat o‘tgan: kam to‘lovning qoldig‘i keyingi kunga qo‘shiladi → OVERDUE', async () => {
    const credit = await create({
      takenAt: '2026-10-01T10:00:00+05:00',
      firstDueDate: '2026-10-08',
    });
    const res = await pay(credit.id, '10000').expect(201);
    expect(res.body.schedule[0]).toMatchObject({ state: 'CARRIED', remaining: '2500.00' });
    expect(res.body).toMatchObject({
      status: 'OVERDUE',
      next: { dueDate: '2026-10-09', amount: '15000.00' },
    });
  });

  it('qoldiqdan oshsa → 422 CREDIT_OVERPAID; to‘liq to‘lansa PAID; kelajak sana → 400; yo‘q nasiya → 404', async () => {
    const credit = await create();
    const over = await pay(credit.id, '50000.01').expect(422);
    expect(over.body.error.code).toBe('CREDIT_OVERPAID');
    await pay(credit.id, '100', TOMORROW).expect(400);
    await pay('01990000-0000-7000-8000-000000000000', '100').expect(404);
    const paid = await pay(credit.id, '50000').expect(201);
    expect(paid.body).toMatchObject({ status: 'PAID', remainingAmount: '0.00', next: null });
    await pay(credit.id, '1').expect(422);
  });

  it('parallel: 2 ta 30 000 lik to‘lovdan faqat bittasi o‘tadi (qoldiqdan oshmaydi)', async () => {
    const credit = await create();
    const results = await Promise.all([pay(credit.id, '30000'), pay(credit.id, '30000')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const detail = await api('get', `/credits/${credit.id}`, adminToken).expect(200);
    expect(detail.body.paidAmount).toBe('30000.00');
  });
});

describe('ro‘yxat va eslatma', () => {
  it('ertaga to‘lovi bor — eslatmada kim, qachon, qancha; to‘langani eslatmadan chiqadi', async () => {
    const credit = await create({ debtorName: 'Eslatma Sinov', amount: '40000' });
    const reminders = await api('get', '/credits/reminders', adminToken).expect(200);
    const mine = () => reminders.body.find((r: { creditId: string }) => r.creditId === credit.id);
    expect(mine()).toMatchObject({
      debtorName: 'Eslatma Sinov',
      dueDate: TOMORROW,
      amount: '10000.00',
    });
    await pay(credit.id, '10000').expect(201);
    const after = await api('get', '/credits/reminders', adminToken).expect(200);
    expect(after.body.map((r: { creditId: string }) => r.creditId)).not.toContain(credit.id);
  });

  it('qidiruv (ism, raqam), holat filtri, yig‘ma; yopilgani oxirida', async () => {
    const credit = await create({ debtorName: 'Qidiruv Noyob' });
    const byName = await api('get', '/credits?search=noyob', adminToken).expect(200);
    expect(byName.body.data.map((c: { id: string }) => c.id)).toEqual([credit.id]);
    const byNumber = await api('get', `/credits?search=${credit.number}`, adminToken).expect(200);
    expect(byNumber.body.data.map((c: { id: string }) => c.id)).toContain(credit.id);
    const overdue = await api('get', '/credits?status=OVERDUE', adminToken).expect(200);
    expect(overdue.body.data.every((c: { status: string }) => c.status === 'OVERDUE')).toBe(true);
    const all = await api('get', '/credits?pageSize=100', adminToken).expect(200);
    expect(all.body.summary.activeCount).toBeGreaterThan(0);
    const statuses = all.body.data.map((c: { status: string }) => c.status);
    expect(statuses.lastIndexOf('ACTIVE')).toBeLessThan(statuses.indexOf('PAID'));
  });
});
