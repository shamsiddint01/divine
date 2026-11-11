import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from '../../src/infrastructure/redis/redis.service.js';
import { ControlBotService } from '../../src/modules/control/control-bot.service.js';
import { controlApiToken } from '../../src/modules/site/control-token.guard.js';
import {
  telegramPublicWebhookSecret,
  telegramWebhookSecret,
} from '../../src/modules/support/support.service.js';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
} from './support/auth-app.js';
import { closePool } from './support/db.js';

// Bepul sinab ko'rish (egasining qarori, 2026-11-10): bot → ism familiya → telefon → umumiy demo saytda
// alohida ADMIN hisob (7 kun, jami 1 soat); demo saytda foydalanuvchi qo'shish/bloklash yopiq.
// Bitta ilova ham superadmin, ham demo sayt: panel saytga o'ziga o'zi so'rov yuboradi.
// Mijozlar boti (`@divine_uzbot`) egasining botidan alohida: ariza va login o'sha yerda.

const CHAT_ID = '987654321';
const GUEST_CHAT = 66601;
const OTHER_CHAT = 66602;
const DEMO_SITE_ID = '0193f0a0-0000-7000-8000-00000000d3d0';
const BASE_TIME = new Date('2026-10-09T07:00:00.000Z');
const PASSWORD = '582913';
const OWNER_TOKEN = '123456:test-token-abcdefghijk';
const PUBLIC_TOKEN = '654321:public-token-abcdefghijk';

let t: AuthTestApp;
const sent: {
  bot: 'owner' | 'public';
  method: string;
  chatId: string;
  text: string;
  markup?: string;
}[] = [];
const realFetch = globalThis.fetch;
/** Demo sayt uyg'onishini sekinlashtirish (bepul server uxlab yotgandek). */
let wakeDelayMs = 0;
/** Telegram HTML formatli xabarni rad etadi (masalan, eski mijoz yoki format xatosi). */
let rejectHtml = false;

const server = () => request(t.app.getHttpServer());
/** Mijozga — faqat mijozlar botidan; egasiga bildirishnoma — faqat egasining botidan. */
const toGuest = (chat: number | string = GUEST_CHAT) =>
  sent.filter((item) => item.bot === 'public' && item.chatId === String(chat));
const toOwner = () => sent.filter((item) => item.bot === 'owner' && item.chatId === CHAT_ID);

const publicHook = (update: object) =>
  server()
    .post('/api/v1/site-control/telegram/public-webhook')
    .set('x-telegram-bot-api-secret-token', telegramPublicWebhookSecret(t.config))
    .set('X-Forwarded-For', uniqueIp())
    .send(update);
const ownerHook = (update: object) =>
  server()
    .post('/api/v1/site-control/telegram/webhook')
    .set('x-telegram-bot-api-secret-token', telegramWebhookSecret(t.config))
    .set('X-Forwarded-For', uniqueIp())
    .send(update)
    .expect(200);
/** Webhook Telegram'ga darhol javob beradi, xabar fonda bajariladi: test uning tugashini kutadi. */
async function guest(message: object, chat: number | string = GUEST_CHAT, updateId?: number) {
  await publicHook({
    ...(updateId === undefined ? {} : { update_id: updateId }),
    message: { message_id: 1, chat: { id: Number(chat), type: 'private' }, ...message },
  }).expect(200);
  await t.app.get(ControlBotService).idle();
}

const api = (method: 'get' | 'post' | 'patch', path: string, accessToken: string) =>
  server()
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp())
    .set({ Authorization: `Bearer ${accessToken}` });

/** Bot orqali sinov hisobi: guest xabaridan login va parol. */
async function issueTrial(chat = GUEST_CHAT, phone = '901234567') {
  await guest({ text: '/start' }, chat);
  await guest({ text: 'Ali Valiyev' }, chat);
  await guest({ text: phone }, chat);
  const text = toGuest(chat).at(-1)?.text ?? '';
  const credentials = {
    login: /Login: <code>(\w+)<\/code>/.exec(text)?.[1] ?? '',
    password: /Parol: <code>(\d{6})<\/code>/.exec(text)?.[1] ?? '',
  };
  return { text, credentials };
}

async function signIn(credentials: { login: string; password: string }) {
  return (await login(t, credentials).expect(200)).body.accessToken as string;
}

beforeAll(async () => {
  t = await createAuthApp({
    config: {
      CONTROL_PANEL_ENABLED: true,
      DEMO_MODE: true,
      DEMO_SITE_ID,
      TELEGRAM_BOT_TOKEN: OWNER_TOKEN,
      TELEGRAM_PUBLIC_BOT_TOKEN: PUBLIC_TOKEN,
      TELEGRAM_CHAT_ID: CHAT_ID,
    },
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.telegram.org/')) {
      if (wakeDelayMs && url.endsWith('/health/live')) {
        await new Promise((resolve) => setTimeout(resolve, wakeDelayMs));
      }
      return realFetch(input, init);
    }
    const body = JSON.parse(String(init?.body)) as {
      chat_id?: string;
      text?: string;
      reply_markup?: unknown;
      parse_mode?: string;
    };
    if (rejectHtml && body.parse_mode) {
      return new Response(
        JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }),
        {
          status: 400,
        },
      );
    }
    sent.push({
      bot: url.includes(PUBLIC_TOKEN) ? 'public' : 'owner',
      method: url.split('/').at(-1)!,
      chatId: String(body.chat_id),
      text: body.text ?? JSON.stringify(body),
      markup: JSON.stringify(body.reply_markup ?? null),
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  });
  await t.app.listen(0, '127.0.0.1');
  const { port } = t.app.getHttpServer().address() as AddressInfo;
  await t.prisma.controlSite.deleteMany({ where: { id: DEMO_SITE_ID } });
  await t.prisma.controlSite.create({
    data: {
      id: DEMO_SITE_ID,
      name: 'Demo',
      siteUrl: 'https://demo.example',
      apiUrl: `http://127.0.0.1:${port}`,
      apiToken: controlApiToken(t.config),
      ownerName: 'Divine',
      agreedPrice: '0',
      paidUntil: new Date('2030-01-01'),
    },
  });
});

beforeEach(async () => {
  t.clock.set(BASE_TIME);
  await t.prisma.controlTrial.deleteMany();
  await t.prisma.controlLead.deleteMany();
  await t.prisma.siteLicense.deleteMany();
  const redis = t.app.get(RedisService).client;
  await redis.del(
    `divine:control:lead:${GUEST_CHAT}`,
    `divine:control:lead:${OTHER_CHAT}`,
    `divine:control:lead:${CHAT_ID}`,
  );
  sent.length = 0;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await t.prisma.controlSite.deleteMany({ where: { id: DEMO_SITE_ID } });
  await t.app.close();
  await closePool();
});

describe('ikki bot: mijozlar boti va egasining boti', () => {
  it('egasining botiga begona yozsa javob yo‘q; mijozlar botida egasi ham mijoz', async () => {
    await ownerHook({
      message: { message_id: 1, text: '/start', chat: { id: GUEST_CHAT, type: 'private' } },
    });
    expect(sent).toEqual([]);

    await guest({ text: '/start' }, CHAT_ID);
    expect(toGuest(CHAT_ID).at(-1)?.text).toContain('ism va familiyangizni yozing');
  });

  it('Telegram qayta yuborgan xabar (bir xil update_id) ikkinchi marta bajarilmaydi', async () => {
    const updateId = Math.floor(Math.random() * 1e9);
    await guest({ text: '/start' }, GUEST_CHAT, updateId);
    await guest({ text: '/start' }, GUEST_CHAT, updateId);
    expect(toGuest()).toHaveLength(1);
    await guest({ text: 'Ali Valiyev' }, GUEST_CHAT, updateId + 1);
    expect(toGuest().at(-1)?.text).toContain('telefon raqamingizni');
  });

  it('mijozlar boti webhook’i sirsiz ishlamaydi', async () => {
    await publicHook({ message: { text: '/start' } })
      .set('x-telegram-bot-api-secret-token', telegramWebhookSecret(t.config))
      .expect(403);
  });

  it('webhook ulash: mijozlar botiga /start, egasining botida begonalarga buyruq yo‘q', async () => {
    const res = await server()
      .post('/api/v1/site-control/support/telegram-webhook')
      .set('x-control-token', controlApiToken(t.config))
      .send({ url: 'https://api.example/api/v1/site-control/telegram/webhook' })
      .expect(200);
    expect(res.body).toEqual({ ok: true, publicBot: true });
    const publicHookSet = sent.find((m) => m.bot === 'public' && m.method === 'setWebhook');
    expect(publicHookSet?.text).toContain('/api/v1/site-control/telegram/public-webhook');
    expect(publicHookSet?.text).toContain(telegramPublicWebhookSecret(t.config));
    const commands = sent.filter((m) => m.method === 'setMyCommands');
    expect(commands.find((m) => m.bot === 'public')?.text).toContain('"start"');
    expect(commands.filter((m) => m.bot === 'owner').map((m) => m.text)).toEqual([
      expect.stringContaining('"commands":[]'),
      expect.stringContaining('"bugun"'),
    ]);
  });
});

describe('bot: bepul sinab ko‘rish hisobi', () => {
  it('ism familiya → telefon → login, parol va manzil; har kimga bitta', async () => {
    await guest({ text: '/start' });
    expect(toGuest().at(-1)?.text).toContain('ism va familiyangizni yozing');
    await guest({ text: 'Ali' });
    expect(toGuest().at(-1)?.text).toContain('Ism va familiyangizni birga yozing');
    await guest({ text: 'Ali Valiyev' });
    await guest({ text: '901234567' });

    const message = toGuest().at(-1)!.text;
    expect(message).toContain('Sinov sayti tayyor');
    expect(message).toContain('Sayt: https://demo.example');
    expect(message).toContain('7 kun, jami 60 daqiqa');
    const lead = await t.prisma.controlLead.findFirstOrThrow();
    const loginName = `demo${lead.number}`;
    expect(message).toContain(`Login: <code>${loginName}</code>`);
    // Bir bosishda nusxalash: login va parol tugmalari, sayt havolasi; telefon tugmasi oldin yopiladi.
    const markup = JSON.parse(toGuest().at(-1)!.markup!) as {
      inline_keyboard: { text: string; url?: string; copy_text?: { text: string } }[][];
    };
    expect(markup.inline_keyboard.flat()).toEqual([
      { text: '📋 Login', copy_text: { text: loginName } },
      { text: '📋 Parol', copy_text: { text: expect.stringMatching(/^\d{6}$/) } },
      { text: '🌐 Saytni ochish', url: 'https://demo.example' },
    ]);
    expect(toGuest().at(-2)?.markup).toContain('remove_keyboard');
    expect(toOwner().at(-1)?.text).toContain(`sinov hisobi berildi (${loginName})`);

    const user = await t.prisma.user.findFirstOrThrow({
      where: { login: loginName },
      include: { role: true, demoAccount: true },
    });
    expect(user).toMatchObject({ fullName: 'Ali Valiyev', role: { code: 'ADMIN' } });
    expect(user.demoAccount?.expiresAt.toISOString()).toBe('2026-10-16T07:00:00.000Z');
    expect(await t.prisma.controlTrial.findFirstOrThrow()).toMatchObject({
      login: loginName,
      phone: '+998901234567',
      siteId: DEMO_SITE_ID,
    });

    const password = /Parol: <code>(\d{6})<\/code>/.exec(message)![1]!;
    await signIn({ login: loginName, password });

    // Takror /start — yangi hisob yo'q, berilgani eslatiladi.
    await guest({ text: '/start' });
    expect(toGuest().at(-1)?.text).toContain(`Sizga sinov hisobi berilgan: login ${loginName}`);
    // Boshqa chatdan shu telefon — ikkinchi sinov berilmaydi.
    await guest({ text: '/start' }, OTHER_CHAT);
    await guest({ text: 'Vali Aliyev' }, OTHER_CHAT);
    await guest({ text: '+998 90 123 45 67' }, OTHER_CHAT);
    expect(toGuest(OTHER_CHAT).at(-1)?.text).toContain('Sizga sinov hisobi berilgan');
    expect(await t.prisma.controlTrial.count()).toBe(1);
  });

  it('demo sayt sekin uyg‘onsa — mijozga "kuting", keyin login', async () => {
    wakeDelayMs = 6_000;
    try {
      const { text } = await issueTrial();
      const messages = toGuest().map((m) => m.text);
      expect(messages.at(-3)).toContain('Sinov saytingiz tayyorlanmoqda');
      expect(text).toContain('Sinov sayti tayyor');
    } finally {
      wakeDelayMs = 0;
    }
  });

  it('Telegram formatli xabarni rad etsa — login va parol oddiy matnda', async () => {
    rejectHtml = true;
    try {
      await issueTrial();
    } finally {
      rejectHtml = false;
    }
    const text = toGuest().at(-1)!.text;
    expect(text).toMatch(/Login: demo\d+\nParol: \d{6}/);
    expect(await t.prisma.controlTrial.count()).toBe(1);
  });

  it('demo sayt javob bermasa — oddiy ariza, egasiga ogohlantirish', async () => {
    await t.prisma.controlSite.update({
      where: { id: DEMO_SITE_ID },
      data: { apiToken: 'noto‘g‘ri-kalit-0123456789abcdefghij' },
    });
    try {
      const { text } = await issueTrial();
      expect(text).toContain('Arizangiz qabul qilindi');
      expect(toOwner().at(-1)?.text).toContain('demo saytda hisob ochilmadi');
      expect(await t.prisma.controlTrial.count()).toBe(0);
    } finally {
      await t.prisma.controlSite.update({
        where: { id: DEMO_SITE_ID },
        data: { apiToken: controlApiToken(t.config) },
      });
    }
    // Sayt tuzalgach /start — shu ariza bo'yicha hisob beriladi, qayta so'ralmaydi.
    await guest({ text: '/start' });
    expect(toGuest().at(-1)?.text).toContain('Sinov sayti tayyor');
    expect(await t.prisma.controlLead.count()).toBe(1);
  });
});

describe('demo sayt cheklovlari', () => {
  it('sinov hisobi foydalanuvchi qo‘sha, o‘zgartira va bloklay olmaydi; qolgani ochiq', async () => {
    const { credentials: trial } = await issueTrial();
    const token = await signIn(trial);
    const other = await createUser(t, { password: PASSWORD, role: 'ADMIN' });

    const created = await api('post', '/users', token).send({
      login: 'yangiuser',
      role: 'USER',
      warehouseIds: [],
    });
    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe('DEMO_RESTRICTED');
    for (const [method, path, body] of [
      ['patch', `/users/${other.id}/status`, { status: 'BLOCKED' }],
      ['patch', `/users/${other.id}`, { role: 'USER' }],
      ['post', `/users/${other.id}/reset-password`, {}],
    ] as const) {
      const res = await api(method, path, token).send(body);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('DEMO_RESTRICTED');
    }
    await api('get', '/users', token).expect(200);
    await api('get', '/products', token).expect(200);
  });

  it('egasining hisobi (sinov yozuvisiz) demo saytda ham cheklanmaydi', async () => {
    const owner = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
    const token = await signIn({ login: owner.login, password: PASSWORD });
    const { credentials } = await issueTrial();
    const trialUser = await t.prisma.user.findFirstOrThrow({ where: { login: credentials.login } });

    const created = await api('post', '/users', token)
      .send({ login: `yangi${Date.now() % 100000}`, role: 'USER', warehouseIds: [] })
      .expect(201);
    expect(created.body.user.role).toBe('USER');
    await api('patch', `/users/${trialUser.id}/status`, token)
      .send({ status: 'BLOCKED' })
      .expect(200);
    await api('post', `/users/${trialUser.id}/reset-password`, token).send({}).expect(200);
  });

  it('jami 1 soat: so‘rovlar orasidagi vaqt yig‘iladi, uzun tanaffus 5 daqiqa hisoblanadi', async () => {
    const { credentials: trial } = await issueTrial();
    const user = await t.prisma.user.findFirstOrThrow({ where: { login: trial.login } });
    const token = await signIn(trial);

    await api('get', '/site/demo', token).expect(200);
    t.clock.advance(60_000);
    expect((await api('get', '/site/demo', token).expect(200)).body).toMatchObject({
      minutesLeft: 59,
    });
    t.clock.advance(10 * 60_000);
    const fresh = await signIn(trial);
    await api('get', '/products', fresh).expect(200);
    const usage = await t.prisma.demoAccount.findUniqueOrThrow({ where: { userId: user.id } });
    expect(usage.usedSeconds).toBe(60 + 300);

    await t.prisma.demoAccount.update({
      where: { userId: user.id },
      data: { usedSeconds: 3_590 },
    });
    t.clock.advance(30_000);
    const timeUp = await api('get', '/products', fresh);
    expect(timeUp.status).toBe(403);
    expect(timeUp.body.error.code).toBe('DEMO_TIME_UP');
    const denied = await login(t, trial);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('DEMO_TIME_UP');
  });

  it('7 kundan keyin kirib bo‘lmaydi; oddiy hisob cheklanmaydi', async () => {
    const { credentials: trial } = await issueTrial();
    t.clock.advance(7 * 86_400_000);
    const denied = await login(t, trial);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('DEMO_TIME_UP');

    const owner = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
    const token = await signIn({ login: owner.login, password: PASSWORD });
    expect((await api('get', '/site/demo', token).expect(200)).body).toEqual({});
  });
});
