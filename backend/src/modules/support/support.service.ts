import { createHash, createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type AnnouncementDto,
  type AnnouncementInput,
  ErrorCode,
  type SupportErrorInput,
  type SupportFeedbackSummaryDto,
  type SupportStatus,
  type SupportTicketCreateInput,
  type SupportTicketDto,
} from '@divine/shared';
import type { AccessContext } from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import type { SupportReply, SupportTicket } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { PublicTelegramService, TelegramService } from '../telegram/telegram.service.js';

/** Bitta foydalanuvchi 10 daqiqada shuncha murojaat yozadi: tasodifiy takror va spamdan himoya. */
const TICKET_LIMIT = 5;
const TICKET_WINDOW_MS = 10 * 60_000;
/** Bir xil avtomatik xato shu vaqt ichida yangi murojaat ochmaydi, soni oshadi. */
const ERROR_DEDUPE_MS = 60 * 60_000;
const ANNOUNCEMENT_KEY = 'announcement';
const ANSWER_BUTTON = '✍️ Javob yozish';
/** Telegram'da tanlangan murojaat: keyingi BITTA xabar shu murojaatga javob (egasining qarori, 2026-11-10). */
const REPLY_TARGET_KEY = 'divine:support:telegram-reply-target';
const REPLY_TARGET_TTL_SECONDS = 30 * 60;
const OPEN_LIST_LIMIT = 10;
/** Egasining bot buyruqlari ("/" yozganda ro'yxat bo'lib chiqadi). */
const OWNER_COMMANDS = [
  { command: 'murojaatlar', description: 'Javob kutayotgan murojaatlar' },
  { command: 'bugun', description: 'Bugungi hisobot' },
  { command: 'qarzdorlar', description: 'To‘lashi kerak va bloklanganlar' },
  { command: 'saytlar', description: 'Saytlar holati' },
  { command: 'arizalar', description: 'Bepul sinab ko‘rish arizalari' },
  { command: 'blokla', description: 'Saytni bloklash yoki ochish' },
  { command: 'bekor', description: 'Tanlangan murojaatni bekor qilish' },
];
const STATUS_LABEL: Record<SupportStatus, string> = {
  NEW: 'yangi',
  SEEN: 'ko‘rildi',
  RESOLVED: 'hal qilindi',
};

type TicketRow = SupportTicket & { replies: SupportReply[] };
/** Boshqa modul (superadmin boti) Telegram xabarini o'zi ishlaydi: `true` — ishlandi, bu yerga kelmaydi. */
export type TelegramHandler = (update: unknown) => Promise<boolean>;

/** Telegram webhook sirining manbasi: sayt secret'idan, alohida sozlamasiz. */
export const telegramWebhookSecret = (config: Pick<AppConfig, 'JWT_ACCESS_SECRET'>) =>
  createHmac('sha256', config.JWT_ACCESS_SECRET).update('divine.uz/telegram-webhook').digest('hex');
/** Mijozlar botining webhook siri (egasining botidan alohida). */
export const telegramPublicWebhookSecret = (config: Pick<AppConfig, 'JWT_ACCESS_SECRET'>) =>
  createHmac('sha256', config.JWT_ACCESS_SECRET)
    .update('divine.uz/telegram-public-webhook')
    .digest('hex');

/**
 * Murojaat bo'limi (egasining qarori, 2026-11-09). Murojaatlar saytning o'zida saqlanadi, panel ularni
 * `/site-control` orqali o'qiydi. Yangi murojaat va javoblar egasining Telegram'iga boradi; egasi shu
 * xabarga Telegram'da javob yozsa, javob murojaatga qo'shiladi.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly handlers: TelegramHandler[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly telegram: TelegramService,
    private readonly publicBot: PublicTelegramService,
    private readonly redis: RedisService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  private toDto(row: TicketRow): SupportTicketDto {
    return {
      id: row.id,
      number: row.number.toString(),
      kind: row.kind as SupportTicketDto['kind'],
      status: row.status as SupportStatus,
      userLogin: row.userLogin,
      message: row.message,
      page: row.page,
      errorCode: row.errorCode,
      requestId: row.requestId,
      userAgent: row.userAgent,
      occurrences: row.occurrences,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      replies: row.replies.map((reply) => ({
        id: reply.id,
        author: reply.author as 'USER' | 'SUPPORT',
        body: reply.body,
        createdAt: reply.createdAt.toISOString(),
      })),
    };
  }

  private include = { replies: { orderBy: { createdAt: 'asc' as const } } };

  /**
   * Telegram ishlamasa ham murojaat saqlanadi: xabar yuborilmagani faqat logga yoziladi.
   * `answerTicket` berilsa — xabar ostida "Javob yozish" tugmasi.
   */
  private async notify(
    text: string,
    replyTo?: bigint | null,
    answerTicket?: string,
  ): Promise<number | null> {
    if (!this.telegram.enabled) return null;
    try {
      return await this.telegram.send(text, {
        ...(replyTo ? { replyTo: Number(replyTo) } : {}),
        ...(answerTicket
          ? { buttons: [[{ text: ANSWER_BUTTON, data: `reply:${answerTicket}` }]] }
          : {}),
      });
    } catch {
      this.logger.warn('Murojaat Telegram’ga yuborilmadi');
      return null;
    }
  }

  async create(
    ctx: AccessContext,
    input: SupportTicketCreateInput,
    userAgent: string | null,
  ): Promise<SupportTicketDto> {
    const now = this.clock.now();
    const recent = await this.prisma.supportTicket.count({
      where: {
        userId: ctx.userId,
        kind: 'MANUAL',
        createdAt: { gt: new Date(now.getTime() - TICKET_WINDOW_MS) },
      },
    });
    if (recent >= TICKET_LIMIT) {
      throw new AppError(ErrorCode.RATE_LIMITED, {
        message: 'Ko‘p murojaat yuborildi. 10 daqiqadan keyin qayta urinib ko‘ring',
      });
    }
    const row = await this.prisma.supportTicket.create({
      data: {
        kind: 'MANUAL',
        userId: ctx.userId,
        userLogin: ctx.login,
        message: input.message,
        page: input.page ?? null,
        errorCode: input.errorCode ?? null,
        requestId: input.requestId ?? null,
        userAgent: userAgent?.slice(0, 300) ?? null,
        createdAt: now,
      },
      include: this.include,
    });
    const messageId = await this.notify(
      [
        `Yangi murojaat #${row.number} — ${ctx.login}`,
        input.message,
        input.page ? `Sahifa: ${input.page}` : null,
        input.errorCode ? `Xato: ${input.errorCode}` : null,
        '',
        'Javob berish uchun «Javob yozish» tugmasini bosing.',
      ]
        .filter((line) => line !== null)
        .join('\n'),
      null,
      row.id,
    );
    if (messageId) {
      await this.prisma.supportTicket.update({
        where: { id: row.id },
        data: { telegramMessageId: messageId },
      });
    }
    return this.toDto(row);
  }

  /** Sahifa yoki server xatosi: bir soat ichidagi bir xil xato bitta murojaatda jamlanadi. */
  async reportError(
    ctx: AccessContext | null,
    input: SupportErrorInput,
    userAgent: string | null,
  ): Promise<void> {
    const now = this.clock.now();
    const fingerprint = createHash('sha256')
      .update(`${input.errorCode ?? ''}|${input.page ?? ''}|${input.message}`)
      .digest('hex');
    const existing = await this.prisma.supportTicket.findFirst({
      where: { fingerprint, createdAt: { gt: new Date(now.getTime() - ERROR_DEDUPE_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      await this.prisma.supportTicket.update({
        where: { id: existing.id },
        data: { occurrences: { increment: 1 } },
      });
      return;
    }
    const row = await this.prisma.supportTicket.create({
      data: {
        kind: 'AUTO',
        userId: ctx?.userId ?? null,
        userLogin: ctx?.login ?? null,
        message: input.message,
        page: input.page ?? null,
        errorCode: input.errorCode ?? null,
        requestId: input.requestId ?? null,
        userAgent: userAgent?.slice(0, 300) ?? null,
        fingerprint,
        createdAt: now,
      },
    });
    const messageId = await this.notify(
      [
        `Avtomatik xato #${row.number}${ctx ? ` — ${ctx.login}` : ''}`,
        input.message,
        input.page ? `Sahifa: ${input.page}` : null,
        input.errorCode ? `Kod: ${input.errorCode}` : null,
      ]
        .filter((line) => line !== null)
        .join('\n'),
    );
    if (messageId) {
      await this.prisma.supportTicket.update({
        where: { id: row.id },
        data: { telegramMessageId: messageId },
      });
    }
  }

  async mine(ctx: AccessContext): Promise<SupportTicketDto[]> {
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId: ctx.userId, kind: 'MANUAL' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: this.include,
    });
    return rows.map((row) => this.toDto(row));
  }

  async replyAsUser(ctx: AccessContext, id: string, body: string): Promise<SupportTicketDto> {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id, userId: ctx.userId } });
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND);
    await this.prisma.$transaction([
      this.prisma.supportReply.create({ data: { ticketId: id, author: 'USER', body } }),
      this.prisma.supportTicket.update({ where: { id }, data: { status: 'NEW' } }),
    ]);
    await this.notify(
      `Murojaat #${ticket.number} — ${ctx.login} yana yozdi:\n${body}`,
      ticket.telegramMessageId,
      ticket.id,
    );
    return this.get(id);
  }

  private async get(id: string): Promise<SupportTicketDto> {
    const row = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: this.include,
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return this.toDto(row);
  }

  /** Panel uchun: oxirgi murojaatlar (avtomatik xatolar ham). */
  async list(): Promise<SupportTicketDto[]> {
    const rows = await this.prisma.supportTicket.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: this.include,
    });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Egasining javobi. Panelda yozilsa — Telegram'dagi murojaat xabariga ham yuboriladi (ikkala joyda
   * bir xil tarix); Telegram'dan kelgan javob esa u yerda allaqachon bor.
   */
  async replyAsSupport(
    id: string,
    body: string,
    source: 'PANEL' | 'TELEGRAM' = 'PANEL',
  ): Promise<SupportTicketDto> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND);
    await this.prisma.$transaction([
      this.prisma.supportReply.create({ data: { ticketId: id, author: 'SUPPORT', body } }),
      this.prisma.supportTicket.update({
        where: { id },
        data: { status: ticket.status === 'NEW' ? 'SEEN' : ticket.status },
      }),
    ]);
    if (source === 'PANEL') {
      await this.notify(
        `Murojaat #${ticket.number} ga panelda javob berildi:\n${body}`,
        ticket.telegramMessageId,
      );
    }
    return this.get(id);
  }

  async setStatus(id: string, status: SupportStatus): Promise<SupportTicketDto> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new AppError(ErrorCode.NOT_FOUND);
    await this.prisma.supportTicket.update({ where: { id }, data: { status } });
    if (status !== ticket.status) {
      await this.notify(
        `Murojaat #${ticket.number}: ${STATUS_LABEL[status]}`,
        ticket.telegramMessageId,
      );
    }
    return this.get(id);
  }

  /**
   * Telegram webhook (egasining qarori, 2026-11-10): avval murojaat tanlanadi ("Javob yozish" tugmasi
   * yoki /murojaatlar), keyingi BITTA xabar shu murojaatga javob bo'ladi. Tanlovsiz xabar hech narsa
   * qilmaydi — faqat qanday javob berishni eslatadi. Faqat egasining chati.
   */
  addTelegramHandler(handler: TelegramHandler): void {
    this.handlers.push(handler);
  }

  async telegramUpdate(update: unknown): Promise<void> {
    for (const handler of this.handlers) if (await handler(update)) return;
    const callback = (update as { callback_query?: TelegramCallback } | null)?.callback_query;
    if (callback) {
      if (String(callback.message?.chat?.id) !== this.config.TELEGRAM_CHAT_ID) return;
      await this.telegram.answerCallback(callback.id).catch(() => undefined);
      const ticketId = /^reply:([0-9a-f-]{36})$/.exec(callback.data ?? '')?.[1];
      if (ticketId) await this.selectReplyTarget(ticketId);
      return;
    }
    const message = (update as { message?: TelegramMessage } | null)?.message;
    if (!message?.text || String(message.chat?.id) !== this.config.TELEGRAM_CHAT_ID) return;
    const text = message.text.trim();
    if (text.startsWith('/murojaatlar') || text.startsWith('/start')) return this.sendOpenList();
    if (text.startsWith('/bekor')) {
      await this.redis.client.del(REPLY_TARGET_KEY);
      await this.notify('Tanlov bekor qilindi.');
      return;
    }
    const target = await this.redis.client.getdel(REPLY_TARGET_KEY);
    const ticket = target
      ? await this.prisma.supportTicket.findUnique({ where: { id: target } })
      : null;
    if (!ticket) {
      await this.notify(
        'Avval murojaatni tanlang: xabar ostidagi «Javob yozish» tugmasi yoki /murojaatlar.',
      );
      return;
    }
    await this.replyAsSupport(ticket.id, text.slice(0, 2000), 'TELEGRAM');
    await this.notify(
      `✅ Javob murojaat #${ticket.number} ga yuborildi. Keyingi javob uchun murojaatni qayta tanlang.`,
      ticket.telegramMessageId,
    );
  }

  private async selectReplyTarget(ticketId: string): Promise<void> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return;
    await this.redis.client.set(REPLY_TARGET_KEY, ticket.id, 'EX', REPLY_TARGET_TTL_SECONDS);
    await this.notify(
      `Murojaat #${ticket.number} (${ticket.userLogin ?? '—'}) tanlandi.\n` +
        `Javobingizni bitta xabar qilib yozing. Bekor qilish: /bekor`,
      ticket.telegramMessageId,
    );
  }

  /**
   * Javob kutayotgan murojaatlar (`NEW`: hali javob yo'q yoki foydalanuvchi yana yozgan), har biri tugma
   * bilan. Javob berilgani (`SEEN`) va hal qilingani ro'yxatga kirmaydi.
   */
  private async sendOpenList(): Promise<void> {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { kind: 'MANUAL', status: 'NEW' },
      orderBy: { updatedAt: 'desc' },
      take: OPEN_LIST_LIMIT,
    });
    if (tickets.length === 0) {
      await this.notify('Javob kutayotgan murojaat yo‘q.');
      return;
    }
    if (!this.telegram.enabled) return;
    await this.telegram
      .send('Qaysi murojaatga javob yozasiz?', {
        buttons: tickets.map((ticket) => [
          {
            text: `#${ticket.number} ${ticket.userLogin ?? ''}: ${ticket.message.slice(0, 40)}`,
            data: `reply:${ticket.id}`,
          },
        ]),
      })
      .catch(() => undefined);
  }

  async feedback(topic: string, helpful: boolean): Promise<void> {
    await this.prisma.supportFeedback.create({ data: { topic, helpful } });
  }

  async feedbackSummary(): Promise<SupportFeedbackSummaryDto[]> {
    const rows = await this.prisma.supportFeedback.groupBy({
      by: ['topic', 'helpful'],
      _count: { _all: true },
    });
    const byTopic = new Map<string, SupportFeedbackSummaryDto>();
    for (const row of rows) {
      const item = byTopic.get(row.topic) ?? { topic: row.topic, helpful: 0, notHelpful: 0 };
      if (row.helpful) item.helpful += row._count._all;
      else item.notHelpful += row._count._all;
      byTopic.set(row.topic, item);
    }
    return [...byTopic.values()].sort((a, b) => b.notHelpful - a.notHelpful);
  }

  async announcement(): Promise<AnnouncementDto | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: ANNOUNCEMENT_KEY } });
    return (row?.value as unknown as AnnouncementDto | null) ?? null;
  }

  async setAnnouncement(input: AnnouncementInput | null): Promise<void> {
    if (!input) {
      await this.prisma.setting.deleteMany({ where: { key: ANNOUNCEMENT_KEY } });
      return;
    }
    const value = { ...input, updatedAt: this.clock.now().toISOString() };
    await this.prisma.setting.upsert({
      where: { key: ANNOUNCEMENT_KEY },
      create: { key: ANNOUNCEMENT_KEY, value },
      update: { value },
    });
  }

  async registerWebhook(url: string): Promise<{ ok: boolean; publicBot: boolean }> {
    if (!this.telegram.enabled)
      throw new AppError(ErrorCode.BAD_REQUEST, { message: 'Telegram sozlanmagan' });
    await this.telegram.setWebhook(url, telegramWebhookSecret(this.config));
    const trial = [{ command: 'start', description: 'Bepul sinab ko‘rish' }];
    if (this.publicBot.enabled) {
      // Mijozlar boti alohida: ariza o'sha yerda, egasining botida begonalar uchun buyruq yo'q.
      await this.publicBot.setWebhook(
        url.replace(/\/webhook$/, '/public-webhook'),
        telegramPublicWebhookSecret(this.config),
      );
      await this.publicBot.setCommands(trial);
      await this.telegram.setCommands([]);
    } else {
      // Hammaga — faqat ariza; egasiga — boshqaruv buyruqlari (begonalar ularni ko'rmaydi).
      await this.telegram.setCommands(trial);
    }
    await this.telegram.setCommands(OWNER_COMMANDS, true);
    return { ok: true, publicBot: this.publicBot.enabled };
  }
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  chat?: { id: number };
}

interface TelegramCallback {
  id: string;
  data?: string;
  message?: { chat?: { id: number } };
}
