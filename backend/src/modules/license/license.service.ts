import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  amountDue,
  ErrorCode,
  type SiteLicenseDto,
  type SiteLicenseInput,
  type SiteLicensePaymentDto,
} from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { tashkentToday } from '../../common/time/tashkent-time.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

/** Har so'rovda DB'ga bormaslik uchun: blok ko'pi bilan shuncha kechikadi. */
const CACHE_TTL_MS = 30_000;
const DAY_MS = 86_400_000;

interface License {
  ownerName: string;
  paidUntil: string;
  agreedPrice: string | null;
  balance: string;
  lastPaidAt: string | null;
  manualBlock: boolean;
  graceUntil: string | null;
  payments: SiteLicensePaymentDto[];
}

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const dateOrNull = (date: Date | null) => (date ? dateOnly(date) : null);

/** Yengillik bo'lsa — qaysi sana kechroq bo'lsa, shu kungacha ishlaydi. */
const activeUntil = (license: License) =>
  license.graceUntil && license.graceUntil > license.paidUntil
    ? license.graceUntil
    : license.paidUntil;

/**
 * Saytning to'lov muddati (egasining qarori, 2026-11-07). Blok shu saytning o'zida sanadan
 * hisoblanadi: superadmin paneli ishlamasa ham muddat o'tganda sayt yopiladi. Yozuv yo'q — cheklov yo'q.
 */
@Injectable()
export class LicenseService {
  private cache: { value: License | null; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  private async read(): Promise<License | null> {
    const now = this.clock.now().getTime();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    const row = await this.prisma.siteLicense.findUnique({ where: { id: 1 } });
    const value: License | null = row
      ? {
          ownerName: row.ownerName,
          paidUntil: dateOnly(row.paidUntil),
          agreedPrice: row.agreedPrice ? row.agreedPrice.toFixed(2) : null,
          balance: row.balance.toFixed(2),
          lastPaidAt: dateOrNull(row.lastPaidAt),
          manualBlock: row.manualBlock,
          graceUntil: dateOrNull(row.graceUntil),
          payments: Array.isArray(row.payments)
            ? (row.payments as unknown as SiteLicensePaymentDto[])
            : [],
        }
      : null;
    this.cache = { value, at: now };
    return value;
  }

  /** Muddat o'tgan yoki qo'lda yopilgan bo'lsa — `403 LICENSE_EXPIRED`; oxirgi kun butunligicha ishlaydi. */
  async assertActive(): Promise<void> {
    const license = await this.read();
    if (!license) return;
    if (license.manualBlock || tashkentToday(this.clock.now()) > activeUntil(license)) {
      throw new AppError(ErrorCode.LICENSE_EXPIRED);
    }
  }

  async current(): Promise<SiteLicenseDto | null> {
    const license = await this.read();
    if (!license) return null;
    const today = Date.parse(tashkentToday(this.clock.now()));
    return {
      ownerName: license.ownerName,
      paidUntil: license.paidUntil,
      daysLeft: Math.round((Date.parse(activeUntil(license)) - today) / DAY_MS),
      agreedPrice: license.agreedPrice,
      balance: license.balance,
      amountDue: license.agreedPrice ? amountDue(license.agreedPrice, license.balance) : null,
      lastPaidAt: license.lastPaidAt,
      graceUntil: license.graceUntil,
      payments: license.payments,
    };
  }

  async set(input: SiteLicenseInput): Promise<void> {
    const toDate = (value: string | null | undefined) =>
      value === undefined ? undefined : value === null ? null : new Date(value);
    const data = {
      ownerName: input.ownerName,
      paidUntil: new Date(input.paidUntil),
      agreedPrice: input.agreedPrice,
      balance: input.balance,
      lastPaidAt: toDate(input.lastPaidAt),
      manualBlock: input.manualBlock,
      graceUntil: toDate(input.graceUntil),
      payments: input.payments,
    };
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
      metadata: {
        ownerName: input.ownerName,
        paidUntil: input.paidUntil,
        manualBlock: input.manualBlock ?? false,
        graceUntil: input.graceUntil ?? null,
      },
      meta: { ip: null, userAgent: 'superadmin', requestId: null },
    });
  }
}
