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
import { TelegramService } from '../telegram/telegram.service.js';

/** Bitta foydalanuvchi 10 daqiqada shuncha murojaat yozadi: tasodifiy takror va spamdan himoya. */
const TICKET_LIMIT = 5;
const TICKET_WINDOW_MS = 10 * 60_000;
/** Bir xil avtomatik xato shu vaqt ichida yangi murojaat ochmaydi, soni oshadi. */
const ERROR_DEDUPE_MS = 60 * 60_000;
const ANNOUNCEMENT_KEY = 'announcement';
const STATUS_LABEL: Record<SupportStatus, string> = {
  NEW: 'yangi',
  SEEN: 'ko‘rildi',
  RESOLVED: 'hal qilindi',
};

type TicketRow = SupportTicket & { replies: SupportReply[] };

/** Telegram webhook sirining manbasi: sayt secret'idan, alohida sozlamasiz. */
export const telegramWebhookSecret = (config: Pick<AppConfig, 'JWT_ACCESS_SECRET'>) =>
  createHmac('sha256', config.JWT_ACCESS_SECRET).update('divine.uz/telegram-webhook').digest('hex');

/**
 * Murojaat bo'limi (egasining qarori, 2026-11-09). Murojaatlar saytning o'zida saqlanadi, panel ularni
 * `/site-control` orqali o'qiydi. Yangi murojaat va javoblar egasining Telegram'iga boradi; egasi shu
 * xabarga Telegram'da javob yozsa, javob murojaatga qo'shiladi.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly telegram: TelegramService,
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

  /** Telegram ishlamasa ham murojaat saqlanadi: xabar yuborilmagani faqat logga yoziladi. */
  private async notify(text: string, replyTo?: bigint | null): Promise<number | null> {
    if (!this.telegram.enabled) return null;
    try {
      return await this.telegram.send(text, replyTo ? { replyTo: Number(replyTo) } : {});
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
        'Javob berish uchun shu xabarga javob yozing.',
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
      `Murojaat #${ticket.number} — ${ctx.login} javob yozdi:\n${body}`,
      ticket.telegramMessageId,
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
    const { count } = await this.prisma.supportTicket.updateMany({
      where: { id },
      data: { status },
    });
    if (count === 0) throw new AppError(ErrorCode.NOT_FOUND);
    return this.get(id);
  }

  /**
   * Telegram webhook: egasi murojaat xabariga javob yozsa — javob murojaatga qo'shiladi.
   * Faqat egasining chati; boshqa xabarlar e'tiborsiz (bot boshqalarga javob bermaydi).
   */
  async telegramUpdate(update: unknown): Promise<void> {
    const message = (update as { message?: TelegramMessage } | null)?.message;
    if (!message?.text || String(message.chat?.id) !== this.config.TELEGRAM_CHAT_ID) return;
    const repliedTo = message.reply_to_message?.message_id;
    if (!repliedTo) return;
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { telegramMessageId: BigInt(repliedTo) },
    });
    if (!ticket) return;
    await this.replyAsSupport(ticket.id, message.text.slice(0, 2000));
    await this.notify(
      `Javob murojaat #${ticket.number} ga yozildi (${STATUS_LABEL.SEEN}).`,
      BigInt(message.message_id),
    );
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

  async registerWebhook(url: string): Promise<{ ok: boolean }> {
    if (!this.telegram.enabled)
      throw new AppError(ErrorCode.BAD_REQUEST, { message: 'Telegram sozlanmagan' });
    await this.telegram.setWebhook(url, telegramWebhookSecret(this.config));
    return { ok: true };
  }
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  chat?: { id: number };
  reply_to_message?: { message_id: number };
}
