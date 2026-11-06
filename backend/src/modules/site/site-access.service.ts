import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  ErrorCode,
  RoleCode,
  type SiteAccessRequestDto,
  type SiteViewRequestStatus,
} from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TokenService } from '../auth/token.service.js';

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
/** 3 ta so'rovdan keyin 10 daqiqa so'rov yuborib bo'lmaydi (egasining qarori, 2026-11-07). */
const REQUEST_LIMIT = 3;
const REQUEST_BLOCK_MS = 10 * 60_000;

const META = { ip: null, userAgent: 'superadmin', requestId: null };

/**
 * Superadmin saytni ko'rishi (egasining qarori, 2026-11-07): so'rov adminga kod bilan bildirishnoma
 * bo'lib chiqadi, admin kodni aytsagina faqat-ko'rish tokeni beriladi. Kod bir martalik, 10 daqiqa.
 */
@Injectable()
export class SiteAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async request(): Promise<{ id: string; expiresAt: string }> {
    const now = this.clock.now();
    await this.assertRequestAllowed(now);
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // Yangi so'rov eskisini bekor qiladi: adminda bir vaqtda bitta kod turadi.
    await this.prisma.siteAccessRequest.updateMany({
      where: { usedAt: null, deniedAt: null, expiresAt: { gt: now } },
      data: { deniedAt: now },
    });
    const row = await this.prisma.siteAccessRequest.create({
      data: { code, expiresAt, createdAt: now },
    });
    await this.audit.record({
      actorId: null,
      action: AuditAction.SITE_VIEW_REQUESTED,
      entityType: AuditEntityType.SITE,
      entityId: row.id,
      meta: META,
    });
    return { id: row.id, expiresAt: expiresAt.toISOString() };
  }

  private async assertRequestAllowed(now: Date): Promise<void> {
    const recent = await this.prisma.siteAccessRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: REQUEST_LIMIT,
      select: { createdAt: true },
    });
    if (recent.length < REQUEST_LIMIT) return;
    const latest = recent[0]!.createdAt.getTime();
    const oldest = recent[REQUEST_LIMIT - 1]!.createdAt.getTime();
    const blockedMs = latest + REQUEST_BLOCK_MS - now.getTime();
    if (latest - oldest <= REQUEST_BLOCK_MS && blockedMs > 0) {
      throw new AppError(ErrorCode.RATE_LIMITED, {
        message: `Ko‘p so‘rov tufayli 10 daqiqaga cheklandi. Yana ${Math.ceil(blockedMs / 60_000)} daqiqadan keyin urinib ko‘ring`,
      });
    }
  }

  async status(id: string): Promise<SiteViewRequestStatus> {
    const row = await this.prisma.siteAccessRequest.findUnique({ where: { id } });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    if (row.usedAt) return 'USED';
    if (row.deniedAt) return 'DENIED';
    return row.expiresAt > this.clock.now() ? 'PENDING' : 'EXPIRED';
  }

  async active(): Promise<SiteAccessRequestDto | null> {
    const row = await this.prisma.siteAccessRequest.findFirst({
      where: { usedAt: null, deniedAt: null, expiresAt: { gt: this.clock.now() } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? { id: row.id, code: row.code, expiresAt: row.expiresAt.toISOString() } : null;
  }

  async deny(id: string, actorId: string): Promise<void> {
    const { count } = await this.prisma.siteAccessRequest.updateMany({
      where: { id, usedAt: null, deniedAt: null },
      data: { deniedAt: this.clock.now() },
    });
    if (count === 0) return;
    await this.audit.record({
      actorId,
      action: AuditAction.SITE_VIEW_DENIED,
      entityType: AuditEntityType.SITE,
      entityId: id,
      meta: META,
    });
  }

  async verify(id: string, code: string): Promise<{ token: string; expiresAt: string }> {
    const now = this.clock.now();
    const row = await this.prisma.siteAccessRequest.findUnique({ where: { id } });
    const open =
      row && !row.usedAt && !row.deniedAt && row.expiresAt > now && row.attempts < MAX_ATTEMPTS;
    if (!open) throw new AppError(ErrorCode.FORBIDDEN, { message: 'Kod muddati tugagan' });
    if (row.code !== code) {
      await this.prisma.siteAccessRequest.update({
        where: { id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError(ErrorCode.FORBIDDEN, { message: 'Kod noto‘g‘ri' });
    }
    const admin = await this.prisma.user.findFirst({
      where: { status: 'ACTIVE', role: { code: RoleCode.ADMIN } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!admin) throw new AppError(ErrorCode.NOT_FOUND);
    await this.prisma.siteAccessRequest.update({ where: { id }, data: { usedAt: now } });
    await this.audit.record({
      actorId: admin.id,
      action: AuditAction.SITE_VIEW_GRANTED,
      entityType: AuditEntityType.SITE,
      entityId: id,
      meta: META,
    });
    return this.tokens.signViewToken({ userId: admin.id, role: RoleCode.ADMIN }, now);
  }
}
