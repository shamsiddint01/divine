import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlApiToken } from '../../src/modules/site/control-token.guard.js';
import { telegramWebhookSecret } from '../../src/modules/support/support.service.js';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
} from './support/auth-app.js';
import { closePool } from './support/db.js';

const PASSWORD = '582913';
const CHAT_ID = '987654321';
const BASE_TIME = new Date('2026-10-09T07:00:00.000Z');

let t: AuthTestApp;
let sellerToken: string;
let otherToken: string;
const sent: { text: string; replyTo?: number; buttons?: string[] }[] = [];
let nextMessageId = 100;
const realFetch = globalThis.fetch;

const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, token?: string) => {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set({ Authorization: `Bearer ${token}` }) : req;
};
const control = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
  api(method, `/site-control/support${path}`).set('x-control-token', controlApiToken(t.config));

beforeAll(async () => {
  t = await createAuthApp({
    config: { TELEGRAM_BOT_TOKEN: '123456:test-token-abcdefghijk', TELEGRAM_CHAT_ID: CHAT_ID },
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
    const body = JSON.parse(String(init?.body)) as {
      text?: string;
      reply_parameters?: { message_id: number };
      reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
    };
    if (body.text) {
      sent.push({
        text: body.text,
        replyTo: body.reply_parameters?.message_id,
        buttons: body.reply_markup?.inline_keyboard.flat().map((b) => b.callback_data),
      });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: nextMessageId++ } }), {
      status: 200,
    });
  });
  for (const [name, setter] of [
    ['seller', (v: string) => (sellerToken = v)],
    ['other', (v: string) => (otherToken = v)],
  ] as const) {
    const user = await createUser(t, {
      password: PASSWORD,
      login: `${name}${Date.now() % 100000}`,
    });
    setter(
      (await login(t, { login: user.login, password: PASSWORD }).expect(200)).body.accessToken,
    );
  }
});

beforeEach(async () => {
  t.clock.set(BASE_TIME);
  await t.prisma.supportTicket.deleteMany();
  await t.prisma.supportFeedback.deleteMany();
  sent.length = 0;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await t.app.close();
  await closePool();
});

describe('murojaat', () => {
  it('foydalanuvchi yozadi, Telegram’ga boradi; faqat o‘zinikini ko‘radi', async () => {
    const res = await api('post', '/support/tickets', sellerToken)
      .send({ message: 'Sotuvni yopa olmadim', page: '/sales', errorCode: 'INTERNAL_ERROR' })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'NEW', kind: 'MANUAL', page: '/sales' });
    expect(sent.at(-1)?.text).toContain(`Yangi murojaat #${res.body.number}`);
    expect(sent.at(-1)?.text).toContain('Sotuvni yopa olmadim');

    expect((await api('get', '/support/tickets', sellerToken).expect(200)).body).toHaveLength(1);
    expect((await api('get', '/support/tickets', otherToken).expect(200)).body).toHaveLength(0);
    await api('post', `/support/tickets/${res.body.id}/replies`, otherToken)
      .send({ body: 'begona' })
      .expect(404);
  });

  it('panel javob beradi va holatni o‘zgartiradi; foydalanuvchi javobni ko‘radi', async () => {
    const ticket = (
      await api('post', '/support/tickets', sellerToken).send({ message: 'Yordam' }).expect(201)
    ).body;
    const replied = await control('post', `/tickets/${ticket.id}/replies`)
      .send({ body: 'Tuzatdik' })
      .expect(201);
    expect(replied.body).toMatchObject({
      status: 'SEEN',
      replies: [{ author: 'SUPPORT', body: 'Tuzatdik' }],
    });
    // Panel javobi botdagi murojaat xabariga ham boradi.
    const stored = await t.prisma.supportTicket.findUnique({ where: { id: ticket.id } });
    expect(sent.at(-1)).toEqual({
      text: expect.stringContaining('panelda javob berildi:\nTuzatdik'),
      replyTo: Number(stored!.telegramMessageId),
    });
    await control('patch', `/tickets/${ticket.id}`).send({ status: 'RESOLVED' }).expect(200);
    expect(sent.at(-1)?.text).toContain('hal qilindi');
    const mine = (await api('get', '/support/tickets', sellerToken).expect(200)).body[0];
    expect(mine).toMatchObject({ status: 'RESOLVED', replies: [{ body: 'Tuzatdik' }] });

    const again = await api('post', `/support/tickets/${ticket.id}/replies`, sellerToken)
      .send({ body: 'Yana chiqdi' })
      .expect(201);
    expect(again.body.status).toBe('NEW');
    expect(sent.at(-1)).toMatchObject({ replyTo: expect.any(Number) });
    await control('get', '/tickets').expect(200);
    await api('get', '/site-control/support/tickets').expect(403);
  });

  it('Telegram: murojaat tanlanadi, keyingi BITTA xabar javob; keyingisi hech narsa qilmaydi', async () => {
    const ticket = (
      await api('post', '/support/tickets', sellerToken).send({ message: 'Narx?' }).expect(201)
    ).body;
    expect(sent.at(-1)?.buttons).toEqual([`reply:${ticket.id}`]);
    const hook = (update: object) =>
      api('post', '/site-control/telegram/webhook')
        .set('x-telegram-bot-api-secret-token', telegramWebhookSecret(t.config))
        .send(update)
        .expect(200);
    const text = (value: string, chatId = CHAT_ID) =>
      hook({ message: { message_id: 1000, text: value, chat: { id: Number(chatId) } } });
    const replies = async () =>
      (await api('get', '/support/tickets', sellerToken).expect(200)).body[0].replies;

    await text('tanlovsiz');
    expect(sent.at(-1)?.text).toContain('Avval murojaatni tanlang');
    expect(await replies()).toHaveLength(0);

    await hook({
      callback_query: {
        id: 'cb1',
        data: `reply:${ticket.id}`,
        message: { chat: { id: Number(CHAT_ID) } },
      },
    });
    expect(sent.at(-1)?.text).toContain(`Murojaat #${ticket.number}`);
    await text('Narxi 100 000 so‘m', '111');
    expect(await replies()).toHaveLength(0);
    await text('Narxi 100 000 so‘m');
    await text('ikkinchi xabar');
    expect(await replies()).toEqual([
      expect.objectContaining({ author: 'SUPPORT', body: 'Narxi 100 000 so‘m' }),
    ]);
    expect(sent.at(-1)?.text).toContain('Avval murojaatni tanlang');
    // Telegram javobi panelda ham bor; botga qayta "panelda javob" yuborilmaydi.
    const panelList = (await control('get', '/tickets').expect(200)).body;
    expect(panelList[0].replies[0].body).toBe('Narxi 100 000 so‘m');
    expect(sent.some((m) => m.text.includes('panelda javob berildi'))).toBe(false);

    await text('/murojaatlar');
    expect(sent.at(-1)?.buttons).toEqual([`reply:${ticket.id}`]);
    await hook({
      callback_query: {
        id: 'cb2',
        data: `reply:${ticket.id}`,
        message: { chat: { id: Number(CHAT_ID) } },
      },
    });
    await text('/bekor');
    await text('bekor qilingandan keyin');
    expect(await replies()).toHaveLength(1);
    await api('post', '/site-control/telegram/webhook').send({}).expect(403);
  });

  it('10 daqiqada 5 tadan ortiq murojaat yuborib bo‘lmaydi', async () => {
    for (let i = 0; i < 5; i += 1) {
      await api('post', '/support/tickets', sellerToken)
        .send({ message: `m${i}` })
        .expect(201);
    }
    const blocked = await api('post', '/support/tickets', sellerToken).send({ message: 'x' });
    expect(blocked.status).toBe(429);
    t.clock.advance(11 * 60_000);
    await api('post', '/support/tickets', sellerToken).send({ message: 'keyin' }).expect(201);
  });

  it('avtomatik xato bir soat ichida jamlanadi; foydalanuvchi ro‘yxatida ko‘rinmaydi', async () => {
    const report = () =>
      api('post', '/support/errors', sellerToken)
        .send({ message: 'TypeError: x is undefined', page: '/sales', errorCode: 'CLIENT' })
        .expect(204);
    await report();
    await report();
    const rows = await t.prisma.supportTicket.findMany({ where: { kind: 'AUTO' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurrences).toBe(2);
    expect(sent.filter((m) => m.text.startsWith('Avtomatik xato'))).toHaveLength(1);
    expect((await api('get', '/support/tickets', sellerToken).expect(200)).body).toHaveLength(0);
    await api('post', '/support/errors').send({ message: 'x' }).expect(401);
  });

  it('baho va e’lon', async () => {
    await api('post', '/support/feedback', sellerToken)
      .send({ topic: 'barcode', helpful: false })
      .expect(204);
    await api('post', '/support/feedback', sellerToken)
      .send({ topic: 'barcode', helpful: true })
      .expect(204);
    expect((await control('get', '/feedback').expect(200)).body).toEqual([
      { topic: 'barcode', helpful: 1, notHelpful: 1 },
    ]);

    expect((await api('get', '/support/announcement', sellerToken).expect(200)).body).toEqual({});
    await control('put', '/announcement')
      .send({ kind: 'MAINTENANCE', text: 'Ertaga 10:00 da texnik ishlar' })
      .expect(204);
    expect((await api('get', '/support/announcement', sellerToken).expect(200)).body).toMatchObject(
      {
        kind: 'MAINTENANCE',
        text: 'Ertaga 10:00 da texnik ishlar',
      },
    );
    await control('delete', '/announcement').expect(204);
    expect((await api('get', '/support/announcement', sellerToken).expect(200)).body).toEqual({});
  });
});
