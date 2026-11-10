import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeLeadPhone } from '../../src/modules/control/control-bot.service.js';
import { PasswordHasher } from '../../src/modules/auth/password/password-hasher.js';
import { RedisService } from '../../src/infrastructure/redis/redis.service.js';
import { controlApiToken } from '../../src/modules/site/control-token.guard.js';
import { telegramWebhookSecret } from '../../src/modules/support/support.service.js';
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

// Superadmin qo'shimchalari (egasining qarori, 2026-11-10): kirishlar tarixi, arizalar, bot buyruqlari,
// sayt statistikasi, texnik ishlar, hammani chiqarish, oylik tushum, ishlayaptimi tekshiruvi.

const PASSWORD = '582913';
const PANEL_PASSWORD = 'panel-parol-12345';
const CHAT_ID = '987654321';
const GUEST_CHAT = 55501;
const BASE_TIME = new Date('2026-10-09T07:00:00.000Z');
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0';

let t: AuthTestApp;
let apiUrl: string;
let panelCookie: string;
let admin: { login: string };
const sent: { chatId: string; text: string; buttons?: string[]; contact?: boolean }[] = [];
let nextMessageId = 100;
const realFetch = globalThis.fetch;

const server = () => request(t.app.getHttpServer());
const token = () => controlApiToken(t.config);
const toOwner = () => sent.filter((item) => item.chatId === CHAT_ID);
const toGuest = () => sent.filter((item) => item.chatId === String(GUEST_CHAT));

const panel = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
  server()
    [method](`/api/v1/control${path}`)
    .set({ Cookie: panelCookie, Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest' })
    .set('X-Forwarded-For', uniqueIp());

const panelLogin = (password: string, userAgent = CHROME_WINDOWS) =>
  server()
    .post('/api/v1/control/auth/login')
    .set({ Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': userAgent })
    .set('X-Forwarded-For', uniqueIp())
    .send({ login: 'egasi', password });

const panelVerify = (challengeId: string, code: string, userAgent = CHROME_WINDOWS) =>
  server()
    .post('/api/v1/control/auth/verify')
    .set({ Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': userAgent })
    .set('X-Forwarded-For', uniqueIp())
    .send({ challengeId, code });

/** Parol + Telegram'ga kelgan kod → panel sessiyasi. */
async function signInPanel(userAgent = CHROME_WINDOWS): Promise<string> {
  const res = await panelLogin(PANEL_PASSWORD, userAgent).expect(200);
  const code = /kirish kodi: (\d{6})/.exec(toOwner().at(-1)?.text ?? '')?.[1] ?? '';
  const verified = await panelVerify(res.body.challengeId as string, code, userAgent).expect(204);
  return String(verified.headers['set-cookie']).split(';')[0]!;
}

const hook = (update: object) =>
  server()
    .post('/api/v1/site-control/telegram/webhook')
    .set('x-telegram-bot-api-secret-token', telegramWebhookSecret(t.config))
    .set('X-Forwarded-For', uniqueIp())
    .send(update)
    .expect(200);
const ownerText = (text: string) =>
  hook({ message: { message_id: 1, text, chat: { id: Number(CHAT_ID), type: 'private' } } });
const guest = (message: object) =>
  hook({
    message: {
      message_id: 1,
      chat: { id: GUEST_CHAT, type: 'private' },
      from: { username: 'mijoz_uz' },
      ...message,
    },
  });
const press = (data: string) =>
  hook({ callback_query: { id: 'cb1', data, message: { chat: { id: Number(CHAT_ID) } } } });

const newSite = (extra: object = {}) => ({
  name: 'Do‘kon',
  siteUrl: 'https://dokon.example',
  apiUrl,
  apiToken: token(),
  ownerName: 'Ali Valiyev',
  ownerPhone: '+998901112233',
  agreedPrice: '500000',
  paidUntil: '2026-11-09',
  ...extra,
});

beforeAll(async () => {
  t = await createAuthApp({
    config: {
      CONTROL_PANEL_ENABLED: true,
      TELEGRAM_BOT_TOKEN: '123456:test-token-abcdefghijk',
      TELEGRAM_CHAT_ID: CHAT_ID,
      RENDER_GIT_COMMIT: 'abcdef1234567890',
    },
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
    const body = JSON.parse(String(init?.body)) as {
      chat_id?: string;
      text?: string;
      reply_markup?: {
        inline_keyboard?: { callback_data: string }[][];
        keyboard?: { request_contact?: boolean }[][];
      };
    };
    if (body.text) {
      sent.push({
        chatId: String(body.chat_id),
        text: body.text,
        buttons: body.reply_markup?.inline_keyboard?.flat().map((b) => b.callback_data),
        contact: body.reply_markup?.keyboard?.[0]?.[0]?.request_contact,
      });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: nextMessageId++ } }), {
      status: 200,
    });
  });
  await t.app.listen(0, '127.0.0.1');
  const { port } = t.app.getHttpServer().address() as AddressInfo;
  apiUrl = `http://127.0.0.1:${port}`;
  admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  await t.prisma.controlAdmin.create({
    data: { login: 'egasi', passwordHash: await t.app.get(PasswordHasher).hash(PANEL_PASSWORD) },
  });
  panelCookie = await signInPanel();
});

beforeEach(async () => {
  t.clock.set(BASE_TIME);
  await t.prisma.siteLicense.deleteMany();
  await t.prisma.controlEvent.deleteMany();
  await t.prisma.controlSite.deleteMany();
  await t.prisma.controlLead.deleteMany();
  await t.app.get(RedisService).client.del(`divine:control:lead:${GUEST_CHAT}`);
  sent.length = 0;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await t.app.close();
  await closePool();
});

describe('superadmin kirishlar tarixi', () => {
  it('har urinish yoziladi; yangi qurilma, noto‘g‘ri kod va parol haqida ogohlantirish', async () => {
    await t.prisma.controlLogin.deleteMany();
    await t.app.get(RedisService).client.del('divine:control:alert:bad-password');

    await panelLogin('noto‘g‘ri-parol').expect(401);
    await panelLogin('yana-noto‘g‘ri').expect(401);
    // Hujumda Telegram to'lib ketmasin: 15 daqiqada bitta xabar.
    expect(toOwner().filter((m) => m.text.includes('noto‘g‘ri parol'))).toHaveLength(1);

    const started = await panelLogin(PANEL_PASSWORD).expect(200);
    await panelVerify(started.body.challengeId as string, '000000').expect(401);
    expect(toOwner().at(-1)?.text).toContain('kod noto‘g‘ri');

    sent.length = 0;
    await signInPanel(FIREFOX_ANDROID);
    expect(toOwner().at(-1)?.text).toContain('yangi qurilmadan kirildi: Firefox, Android');
    sent.length = 0;
    await signInPanel(FIREFOX_ANDROID);
    expect(toOwner().some((m) => m.text.includes('yangi qurilma'))).toBe(false);

    const logins = (await panel('get', '/sites/logins').expect(200)).body as {
      outcome: string;
      device: string;
      newDevice: boolean;
      ip: string | null;
    }[];
    expect(logins.map((row) => row.outcome)).toEqual([
      'SUCCESS',
      'CODE_SENT',
      'SUCCESS',
      'CODE_SENT',
      'BAD_CODE',
      'CODE_SENT',
      'BAD_PASSWORD',
      'BAD_PASSWORD',
    ]);
    expect(logins[2]).toMatchObject({ device: 'Firefox, Android', newDevice: true });
    expect(logins[0]).toMatchObject({ newDevice: false });
    // Kiritilgan login saqlanmaydi (parol login maydoniga yozilgan bo'lishi mumkin).
    const columns = Object.keys((await t.prisma.controlLogin.findFirstOrThrow()) as object);
    expect(columns).not.toContain('login');
  });

  it('sessiyasiz tarix ko‘rinmaydi', async () => {
    await server().get('/api/v1/control/sites/logins').expect(401);
  });
});

describe('bepul sinab ko‘rish arizasi (bot)', () => {
  it('/start → ism → telefon: ariza panelga va egasiga tugmalar bilan', async () => {
    await guest({ text: '/start' });
    expect(toGuest().at(-1)?.text).toContain('ismingizni yozing');
    await guest({ text: 'Sardor' });
    expect(toGuest().at(-1)).toMatchObject({ contact: true });
    await guest({ text: '12' });
    expect(toGuest().at(-1)?.text).toContain('Raqam noto‘g‘ri');
    await guest({ contact: { phone_number: '998901234567' } });
    expect(toGuest().at(-1)?.text).toContain('Arizangiz qabul qilindi');

    const leads = (await panel('get', '/sites/leads').expect(200)).body;
    expect(leads).toEqual([
      expect.objectContaining({
        name: 'Sardor',
        phone: '+998901234567',
        username: 'mijoz_uz',
        status: 'NEW',
      }),
    ]);
    const notice = toOwner().at(-1)!;
    expect(notice.text).toContain('Ariza #');
    expect(notice.buttons).toContain(`lead:CALLED:${leads[0].id}`);

    // Bir kunda takroriy ariza ochilmaydi.
    await guest({ text: '/start' });
    expect(toGuest().at(-1)?.text).toContain('Arizangiz qabul qilingan');
    expect(await t.prisma.controlLead.count()).toBe(1);

    await press(`lead:CALLED:${leads[0].id}`);
    expect(toOwner().at(-1)?.text).toContain('qo‘ng‘iroq qilindi');
    const updated = (
      await panel('patch', `/sites/leads/${leads[0].id}`)
        .send({ status: 'CLIENT', note: 'Ertaga o‘rnatamiz' })
        .expect(200)
    ).body;
    expect(updated).toMatchObject({ status: 'CLIENT', note: 'Ertaga o‘rnatamiz' });
    await panel('patch', '/sites/leads/not-a-uuid').send({ status: 'CLIENT' }).expect(404);
  });

  it('begona chat egasining buyruqlarini bajara olmaydi; guruhlarga javob yo‘q', async () => {
    await guest({ text: '/qarzdorlar' });
    expect(toGuest().at(-1)?.text).toContain('/start');
    expect(toOwner()).toHaveLength(0);
    sent.length = 0;
    await hook({ message: { message_id: 1, text: '/start', chat: { id: -100, type: 'group' } } });
    expect(sent).toHaveLength(0);
    await hook({
      callback_query: {
        id: 'x',
        data: 'block-yes:00000000-0000-0000-0000-000000000000',
        message: { chat: { id: GUEST_CHAT } },
      },
    });
    expect(sent).toHaveLength(0);
  });

  it('telefon raqamini tozalash', () => {
    expect(normalizeLeadPhone('90 123 45 67')).toBe('+998901234567');
    expect(normalizeLeadPhone('+998 (90) 123-45-67')).toBe('+998901234567');
    expect(normalizeLeadPhone('12')).toBeNull();
  });
});

describe('egasining bot buyruqlari', () => {
  it('/bugun, /qarzdorlar, /saytlar, /blokla (tasdiq bilan)', async () => {
    const site = (
      await panel('post', '/sites')
        .send(newSite({ paidUntil: '2026-10-10' }))
        .expect(201)
    ).body;
    await panel('post', `/sites/${site.id}/payments`)
      .send({ amount: '500000', paidAt: '2026-10-09' })
      .expect(201);
    sent.length = 0;

    await ownerText('/bugun');
    expect(toOwner().at(-1)?.text).toContain('bugungi hisobot');
    expect(toOwner().at(-1)?.text).toMatch(/Bugun tushgan: 1 ta/);

    await panel('patch', `/sites/${site.id}`).send({ paidUntil: '2026-10-10' }).expect(200);
    await ownerText('/qarzdorlar');
    expect(toOwner().at(-1)?.text).toContain('Do‘kon — Ali Valiyev, +998901112233');

    await ownerText('/saytlar');
    expect(toOwner().at(-1)?.text).toMatch(/🟢 Do‘kon: muddati yaqin, 1 kun, v\.abcdef1/);

    await ownerText('/blokla');
    expect(toOwner().at(-1)?.buttons).toEqual([`block:${site.id}`]);
    await press(`block:${site.id}`);
    expect(toOwner().at(-1)?.buttons).toEqual([`block-yes:${site.id}`, 'block-no']);
    await press('block-no');
    expect((await panel('get', `/sites/${site.id}`).expect(200)).body.manualBlock).toBe(false);
    await press(`block-yes:${site.id}`);
    expect(toOwner().at(-1)?.text).toContain('bloklandi');
    expect((await panel('get', `/sites/${site.id}`).expect(200)).body.manualBlock).toBe(true);
    const blocked = await login(t, { login: admin.login, password: PASSWORD }).expect(403);
    expect(blocked.body.error.code).toBe('LICENSE_EXPIRED');
    await press(`block-yes:${site.id}`);
    expect(toOwner().at(-1)?.text).toContain('ochildi');
  });

  it('egasining boshqa matni murojaatlar oqimiga o‘tadi', async () => {
    await ownerText('salom');
    expect(toOwner().at(-1)?.text).toContain('Avval murojaatni tanlang');
  });

  it('kunlik hisobot har kuni yuboriladi (to‘lov bo‘lmasa ham)', async () => {
    const res = await server()
      .post('/api/v1/control/cron/daily')
      .set('x-control-token', token())
      .set('X-Forwarded-For', uniqueIp())
      .expect(200);
    expect(res.body).toEqual({ sent: true });
    expect(toOwner().at(-1)?.text).toContain('kunlik hisobot');
    expect(toOwner().at(-1)?.text).toContain('Kecha tushgan: to‘lov yo‘q');
  });
});

describe('sayt: statistika, versiya, texnik ishlar, hammani chiqarish', () => {
  it('statistika: sonlar va kim oxirgi marta qachon kirgan', async () => {
    const site = (await panel('post', '/sites').send(newSite()).expect(201)).body;
    await login(t, { login: admin.login, password: PASSWORD }).expect(200);
    const stats = (await panel('get', `/sites/${site.id}/stats`).expect(200)).body;
    expect(stats).toMatchObject({
      products: expect.any(Number),
      sales: {
        today: expect.any(Number),
        last30Days: expect.any(Number),
        total: expect.any(Number),
      },
    });
    const me = stats.users.find((user: { login: string }) => user.login === admin.login);
    expect(me).toMatchObject({ role: 'ADMIN', active: true, lastSeenAt: BASE_TIME.toISOString() });
    // Mijoz va sotuv tafsilotlari panelga bormaydi.
    expect(JSON.stringify(stats)).not.toMatch(/password|phone|token/i);
  });

  it('holat: versiya va texnik ishlar; texnik ishlarda kirish yopiq, xabar ko‘rinadi', async () => {
    const site = (await panel('post', '/sites').send(newSite()).expect(201)).body;
    let health = (await panel('get', '/sites/health').expect(200)).body[0];
    expect(health).toMatchObject({
      ok: true,
      version: { commit: 'abcdef1' },
      maintenance: { enabled: false, message: null },
    });
    const accessToken = (await login(t, { login: admin.login, password: PASSWORD }).expect(200))
      .body.accessToken as string;

    await panel('put', `/sites/${site.id}/maintenance`)
      .send({ enabled: true, message: '30 daqiqada tugaydi' })
      .expect(204);
    const me = await server()
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(403);
    expect(me.body.error).toMatchObject({
      code: 'SITE_MAINTENANCE',
      message: 'Saytda texnik ishlar ketmoqda: 30 daqiqada tugaydi',
    });
    const blocked = await login(t, { login: admin.login, password: PASSWORD }).expect(403);
    expect(blocked.body.error.code).toBe('SITE_MAINTENANCE');
    health = (await panel('get', '/sites/health').expect(200)).body[0];
    expect(health.maintenance).toEqual({ enabled: true, message: '30 daqiqada tugaydi' });

    await panel('put', `/sites/${site.id}/maintenance`).send({ enabled: false }).expect(204);
    await server()
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(200);
    const events = (await panel('get', `/sites/events?siteId=${site.id}`).expect(200)).body;
    expect(events.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['MAINTENANCE_ON', 'MAINTENANCE_OFF']),
    );
    const audit = await t.prisma.auditLog.findMany({
      where: { action: 'SITE_MAINTENANCE_CHANGED' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('muddat yozuvi yo‘q saytda texnik ishlar yoqilmaydi', async () => {
    await server()
      .put('/api/v1/site-control/maintenance')
      .set('x-control-token', token())
      .set('X-Forwarded-For', uniqueIp())
      .send({ enabled: true })
      .expect(409);
    await server().put('/api/v1/site-control/maintenance').send({ enabled: true }).expect(403);
  });

  it('hammani chiqarish: access va refresh tokenlar yaroqsiz, yangi kirish ishlaydi', async () => {
    const site = (await panel('post', '/sites').send(newSite()).expect(201)).body;
    const res = await login(t, { login: admin.login, password: PASSWORD }).expect(200);
    const accessToken = res.body.accessToken as string;
    const cookie = refreshCookieOf(res);
    t.clock.set(new Date(BASE_TIME.getTime() + 2_000));

    const result = (await panel('post', `/sites/${site.id}/sessions/revoke-all`).expect(200)).body;
    expect(result.revoked).toBeGreaterThanOrEqual(1);
    const me = await server()
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(401);
    expect(me.body.error.code).toBe('SESSION_EXPIRED');
    await refresh(t, cookie).expect(401);

    t.clock.set(new Date(BASE_TIME.getTime() + 4_000));
    const again = (await login(t, { login: admin.login, password: PASSWORD }).expect(200)).body
      .accessToken as string;
    await server()
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${again}` })
      .expect(200);
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'SESSIONS_REVOKED' } });
    expect(audit).not.toBeNull();
  });
});

describe('pul: oylik tushum va hamma to‘lovlar', () => {
  it('12 oy, bo‘sh oylar 0; to‘lovlar ro‘yxati sayt nomi bilan', async () => {
    const site = (await panel('post', '/sites').send(newSite()).expect(201)).body;
    await panel('post', `/sites/${site.id}/payments`)
      .send({ amount: '500000', paidAt: '2026-09-15' })
      .expect(201);
    await panel('post', `/sites/${site.id}/payments`)
      .send({ amount: '250000.50', paidAt: '2026-10-01' })
      .expect(201);
    const revenue = (await panel('get', '/sites/revenue').expect(200)).body;
    expect(revenue).toHaveLength(12);
    expect(revenue.at(-1)).toEqual({ month: '2026-10', amount: '250000.50', payments: 1 });
    expect(revenue.at(-2)).toEqual({ month: '2026-09', amount: '500000.00', payments: 1 });
    expect(revenue[0]).toEqual({ month: '2025-11', amount: '0.00', payments: 0 });

    const payments = (await panel('get', '/sites/payments').expect(200)).body;
    expect(payments.map((p: { paidAt: string }) => p.paidAt)).toEqual(['2026-10-01', '2026-09-15']);
    expect(payments[0]).toMatchObject({
      siteName: 'Do‘kon',
      ownerName: 'Ali Valiyev',
      amount: '250000.50',
    });
  });
});

describe('ishlayaptimi tekshiruvi', () => {
  it('ketma-ket 2 marta javob bo‘lmasa bir marta xabar; tirik sayt jim', async () => {
    await panel('post', '/sites').send(newSite()).expect(201);
    await panel('post', '/sites')
      .send(newSite({ name: 'O‘chiq', apiUrl: 'http://127.0.0.1:1' }))
      .expect(201);
    // Sayt qo'shilganda `sync` o'chiq saytga ulana olmaydi — bu jim.
    sent.length = 0;
    const check = () =>
      server()
        .post('/api/v1/control/cron/uptime')
        .set('x-control-token', token())
        .set('X-Forwarded-For', uniqueIp())
        .expect(200);
    expect((await check()).body).toEqual({ checked: 2, down: ['O‘chiq'] });
    expect(toOwner()).toHaveLength(0);
    await check();
    expect(toOwner().map((m) => m.text)).toEqual([
      '🔴 O‘chiq ishlamayapti: http://127.0.0.1:1 javob bermayapti.',
    ]);
    await check();
    expect(toOwner()).toHaveLength(1);
    await server().post('/api/v1/control/cron/uptime').expect(403);
  });

  it('`/health/live` bazasiz javob beradi', async () => {
    await server().get('/api/v1/health/live').expect(200, { status: 'ok' });
  });
});
