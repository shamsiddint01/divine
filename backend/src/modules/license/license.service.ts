import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  ErrorCode,
  type SiteLicenseDto,
  type SiteLicenseInput,
} from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { tashkentToday } from '../../common/time/tashkent-time.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

/** Har so'rovda DB'ga bormaslik uchun: blok ko'pi bilan shuncha kechikadi. */
const CACHE_TTL_MS = 30_000;
const DAY_MS = 86_400_000;

type License = { ownerName: string; paidUntil: string } | null;

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Saytning to'lov muddati (egasining qarori, 2026-11-07). Blok shu saytning o'zida sanadan
 * hisoblanadi: superadmin paneli ishlamasa ham muddat o'tganda sayt yopiladi. Yozuv yo'q — cheklov yo'q.
 */
@Injectable()
export class LicenseService {
  private cache: { value: License; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  private async read(): Promise<License> {
    const now = this.clock.now().getTime();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    const row = await this.prisma.siteLicense.findUnique({ where: { id: 1 } });
    const value = row ? { ownerName: row.ownerName, paidUntil: dateOnly(row.paidUntil) } : null;
    this.cache = { value, at: now };
    return value;
  }

  /** Muddat o'tgan bo'lsa — `403 LICENSE_EXPIRED`; oxirgi kun butunligicha ishlaydi. */
  async assertActive(): Promise<void> {
    const license = await this.read();
    if (license && tashkentToday(this.clock.now()) > license.paidUntil) {
      throw new AppError(ErrorCode.LICENSE_EXPIRED);
    }
  }

  async current(): Promise<SiteLicenseDto | null> {
    const license = await this.read();
    if (!license) return null;
    const today = Date.parse(tashkentToday(this.clock.now()));
    return { ...license, daysLeft: Math.round((Date.parse(license.paidUntil) - today) / DAY_MS) };
  }

  async set(input: SiteLicenseInput): Promise<void> {
    const data = { ownerName: input.ownerName, paidUntil: new Date(input.paidUntil) };
    await this.prisma.siteLicense.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    this.cache = null;
    await this.audit.record({
      actorId: null,
      action: AuditAction.SITE_LICENSE_UPDATED,
      entityType: AuditEntityType.SITE,
      metadata: { ...input },
      meta: { ip: null, userAgent: 'superadmin', requestId: null },
    });
  }
}
