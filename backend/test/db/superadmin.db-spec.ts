import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PasswordHasher } from '../../src/modules/auth/password/password-hasher.js';
import { controlApiToken } from '../../src/modules/site/control-token.guard.js';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  ORIGIN,
  refresh,
  refreshCookieOf,
  uniqueIp,
} from './support/auth-app.js';
import { closePool } from './support/db.js';

const PASSWORD = '582913';
const PANEL_PASSWORD = 'panel-parol-12345';
const BASE_TIME = new Date('2026-10-09T07:00:00.000Z');
const TODAY = '2026-10-09';
const TOMORROW = '2026-10-10';
const YESTERDAY = '2026-10-08';

let t: AuthTestApp;
let admin: { login: string };
let apiUrl: string;
let panelCookie: string;

const server = () => request(t.app.getHttpServer());
const token = () => controlApiToken(t.config);

const setLicense = (paidUntil: string, ownerName = 'Ali Valiyev') =>
  server()
    .put('/api/v1/site-control/license')
    .set('x-control-token', token())
    .set('X-Forwarded-For', uniqueIp())
    .send({ ownerName, paidUntil });

async function signIn() {
  return (await login(t, { login: admin.login, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

const panel = (method: 'get' | 'post' | 'patch', path: string) =>
  server()
    [method](`/api/v1/control${path}`)
    .set({ Cookie: panelCookie, Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest' })
    .set('X-Forwarded-For', uniqueIp());

const newSite = (extra: object = {}) => ({
  name: 'Do‘kon',
  siteUrl: 'https://dokon.example',
  apiUrl,
  apiToken: token(),
  ownerName: 'Ali Valiyev',
  agreedPrice: '500000',
  paidUntil: '2026-11-09',
  ...extra,
});

beforeAll(async () => {
  t = await createAuthApp({ config: { CONTROL_PANEL_ENABLED: true } });
  await t.app.listen(0, '127.0.0.1');
  const { port } = t.app.getHttpServer().address() as AddressInfo;
  apiUrl = `http://127.0.0.1:${port}`;
  admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  await t.prisma.controlAdmin.create({
    data: { login: 'egasi', passwordHash: await t.app.get(PasswordHasher).hash(PANEL_PASSWORD) },
  });
});

beforeEach(async () => {
  t.clock.set(BASE_TIME);
  await t.prisma.siteLicense.deleteMany();
  await t.prisma.controlSite.deleteMany();
  await t.prisma.siteAccessRequest.deleteMany();
});

afterAll(async () => {
  await t.app.close();
  await closePool();
});

describe('sayt: to‘lov muddati va avtomatik blok', () => {
  it('muddat belgilanmagan sayt cheklanmaydi', async () => {
    const accessToken = await signIn();
    const res = await server()
      .get('/api/v1/site/license')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(200);
    expect(res.body).toEqual({});
  });

  it('oxirgi kun ishlaydi va eslatma uchun kun soni qaytadi', async () => {
    await setLicense(TOMORROW).expect(204);
    const accessToken = await signIn();
    const res = await server()
      .get('/api/v1/site/license')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(200);
    expect(res.body).toEqual({ ownerName: 'Ali Valiyev', paidUntil: TOMORROW, daysLeft: 1 });
    await setLicense(TODAY).expect(204);
    await login(t, { login: admin.login, password: PASSWORD }).expect(200);
  });

  it('muddat o‘tsa login to‘g‘ri parolda to‘xtaydi, noto‘g‘ri parolda sir ochilmaydi', async () => {
    await setLicense(YESTERDAY).expect(204);
    const res = await login(t, { login: admin.login, password: PASSWORD }).expect(403);
    expect(res.body.error.code).toBe('LICENSE_EXPIRED');
    expect(res.body.error.message).toContain('+998901333831');
    const wrong = await login(t, { login: admin.login, password: '000000' }).expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('muddat ish paytida tugasa: API va refresh avtomatik yopiladi', async () => {
    await setLicense(TODAY).expect(204);
    t.clock.set(new Date('2026-10-09T18:55:00.000Z'));
    const res = await login(t, { login: admin.login, password: PASSWORD }).expect(200);
    const accessToken = res.body.accessToken as string;
    const cookie = refreshCookieOf(res);
    t.clock.set(new Date('2026-10-09T19:01:00.000Z')); // Toshkentda ertasi kun
    const blocked = await server()
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(403);
    expect(blocked.body.error.code).toBe('LICENSE_EXPIRED');
    await refresh(t, cookie).expect(403);
  });

  it('kalitsiz yoki noto‘g‘ri kalit bilan muddat o‘zgartirilmaydi', async () => {
    await server()
      .put('/api/v1/site-control/license')
      .send({ ownerName: 'X', paidUntil: '2030-01-01' })
      .expect(403);
    await server()
      .put('/api/v1/site-control/license')
      .set('x-control-token', 'x'.repeat(64))
      .send({ ownerName: 'X', paidUntil: '2030-01-01' })
      .expect(403);
    expect(await t.prisma.siteLicense.count()).toBe(0);
  });
});

describe('panel: saytlar va to‘lovlar', () => {
  beforeAll(async () => {
    const res = await server()
      .post('/api/v1/control/auth/login')
      .set({ Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest' })
      .set('X-Forwarded-For', uniqueIp())
      .send({ login: 'egasi', password: PANEL_PASSWORD })
      .expect(204);
    panelCookie = String(res.headers['set-cookie']).split(';')[0]!;
  });

  it('sessiyasiz panel yopiq, noto‘g‘ri parol o‘tmaydi', async () => {
    await server().get('/api/v1/control/sites').expect(401);
    await server()
      .post('/api/v1/control/auth/login')
      .set({ Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest' })
      .set('X-Forwarded-For', uniqueIp())
      .send({ login: 'egasi', password: 'noto-gri-parol' })
      .expect(401);
  });

  it('sayt qo‘shilsa muddat saytga yetib boradi; to‘lov muddatni uzaytiradi', async () => {
    const site = (await panel('post', '/sites').send(newSite()).expect(201)).body;
    expect(site).toMatchObject({ status: 'ACTIVE', daysLeft: 31, synced: true });
    expect(await t.prisma.siteLicense.findUnique({ where: { id: 1 } })).toMatchObject({
      ownerName: 'Ali Valiyev',
    });
    const paid = await panel('post', `/sites/${site.id}/payments`)
      .send({ amount: '500000', paidAt: TODAY, paidUntil: '2026-12-09' })
      .expect(201);
    expect(paid.body).toMatchObject({
      paidUntil: '2026-12-09',
      lastPaidAt: TODAY,
      synced: true,
      payments: [{ amount: '500000.00', paidUntil: '2026-12-09' }],
    });
    const license = await t.prisma.siteLicense.findUnique({ where: { id: 1 } });
    expect(license?.paidUntil.toISOString().slice(0, 10)).toBe('2026-12-09');
  });

  it('egasi nomini o‘zgartirsa saytga boradi; holat muddatdan hisoblanadi', async () => {
    const site = (
      await panel('post', '/sites')
        .send(newSite({ paidUntil: TOMORROW }))
        .expect(201)
    ).body;
    expect(site.status).toBe('EXPIRING');
    const updated = await panel('patch', `/sites/${site.id}`)
      .send({ ownerName: 'Vali Aliyev', paidUntil: YESTERDAY })
      .expect(200);
    expect(updated.body).toMatchObject({ status: 'EXPIRED', ownerName: 'Vali Aliyev' });
    await login(t, { login: admin.login, password: PASSWORD }).expect(403);
  });

  it('sayt javob bermasa o‘zgarish saqlanadi va synced=false', async () => {
    const site = (
      await panel('post', '/sites')
        .send(newSite({ apiUrl: 'http://127.0.0.1:1' }))
        .expect(201)
    ).body;
    expect(site.synced).toBe(false);
    expect(await t.prisma.siteLicense.count()).toBe(0);
  });
});

describe('ko‘rish: admin kodi va faqat o‘qish', () => {
  async function requestView() {
    const site = (await panel('post', '/sites').send(newSite()).expect(201)).body;
    const view = (await panel('post', `/sites/${site.id}/view-requests`).expect(201)).body;
    return { site, view };
  }

  const adminRequest = (accessToken: string) =>
    server()
      .get('/api/v1/site/access-request')
      .set({ Authorization: `Bearer ${accessToken}` });

  it('kod adminga chiqadi; noto‘g‘ri kod o‘tmaydi; to‘g‘ri kod faqat bir marta', async () => {
    const { site, view } = await requestView();
    const shown = (await adminRequest(await signIn()).expect(200)).body;
    expect(shown.id).toBe(view.id);
    expect(shown.code).toMatch(/^\d{6}$/);

    const wrong = shown.code === '000000' ? '111111' : '000000';
    await panel('post', `/sites/${site.id}/view-requests/${view.id}/verify`)
      .send({ code: wrong })
      .expect(403);
    const ok = await panel('post', `/sites/${site.id}/view-requests/${view.id}/verify`)
      .send({ code: shown.code })
      .expect(200);
    expect(ok.body.viewUrl).toMatch(/^https:\/\/dokon\.example\/view#token=/);
    await panel('post', `/sites/${site.id}/view-requests/${view.id}/verify`)
      .send({ code: shown.code })
      .expect(403);
  });

  it('ko‘rish tokeni o‘qiydi, lekin yoza olmaydi; 30 daqiqadan keyin tugaydi', async () => {
    const { site, view } = await requestView();
    const { code } = (await adminRequest(await signIn()).expect(200)).body;
    const { viewUrl } = (
      await panel('post', `/sites/${site.id}/view-requests/${view.id}/verify`)
        .send({ code })
        .expect(200)
    ).body;
    const viewToken = String(viewUrl).split('#token=')[1]!;
    const auth = { Authorization: `Bearer ${viewToken}` };
    await server().get('/api/v1/auth/me').set(auth).expect(200);
    const write = await server()
      .post('/api/v1/warehouses')
      .set(auth)
      .send({ name: 'Yangi ombor' })
      .expect(403);
    expect(write.body.error.code).toBe('READ_ONLY_SESSION');
    t.clock.advance(31 * 60_000);
    await server().get('/api/v1/auth/me').set(auth).expect(401);
  });

  it('admin rad etsa kod ishlamaydi; 5 xato urinishdan keyin ham', async () => {
    const { site, view } = await requestView();
    const accessToken = await signIn();
    const { code } = (await adminRequest(accessToken).expect(200)).body;
    await server()
      .delete(`/api/v1/site/access-request/${view.id}`)
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(204);
    await panel('post', `/sites/${site.id}/view-requests/${view.id}/verify`)
      .send({ code })
      .expect(403);

    const second = (await panel('post', `/sites/${site.id}/view-requests`).expect(201)).body;
    const shown = (await adminRequest(accessToken).expect(200)).body;
    const wrong = shown.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await panel('post', `/sites/${site.id}/view-requests/${second.id}/verify`)
        .send({ code: wrong })
        .expect(403);
    }
    await panel('post', `/sites/${site.id}/view-requests/${second.id}/verify`)
      .send({ code: shown.code })
      .expect(403);
  });
});

describe('panel o‘chiq sayt', () => {
  it('/control/* 404 beradi', async () => {
    const plain = await createAuthApp();
    await request(plain.app.getHttpServer()).get('/api/v1/control/sites').expect(404);
    await plain.app.close();
  });
});
