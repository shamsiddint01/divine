import { Injectable } from '@nestjs/common';
import {
  type ControlLoginInput,
  type ControlPaymentInput,
  type ControlSiteCreateInput,
  type ControlSiteDetailDto,
  type ControlSiteDto,
  type ControlSiteStatus,
  type ControlSiteUpdateInput,
  ErrorCode,
  LICENSE_WARNING_DAYS,
  nextPaidUntil,
} from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { tashkentToday } from '../../common/time/tashkent-time.js';
import type { ControlSite } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { PasswordHasher } from '../auth/password/password-hasher.js';
import { TokenService } from '../auth/token.service.js';
import { SiteClient } from './site-client.js';

const DAY_MS = 86_400_000;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

const notFound = (): never => {
  throw new AppError(ErrorCode.NOT_FOUND);
};

/** Superadmin paneli: mijoz saytlari, kelishuv va to'lovlar. O'zgarish saytga darhol yuboriladi. */
@Injectable()
export class ControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly sites: SiteClient,
  ) {}

  async login(input: ControlLoginInput): Promise<string> {
    const admin = await this.prisma.controlAdmin.findUnique({
      where: { login: input.login.toLowerCase() },
    });
    const valid = admin
      ? await this.hasher.verify(admin.passwordHash, input.password)
      : await this.hasher.verifyAgainstDummy(input.password);
    if (!admin || !valid) throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    return this.tokens.signControlToken(admin.id, this.clock.now());
  }

  private toDto(site: ControlSite, lastPaidAt: Date | null): ControlSiteDto {
    const paidUntil = dateOnly(site.paidUntil);
    const today = Date.parse(tashkentToday(this.clock.now()));
    const daysLeft = Math.round((Date.parse(paidUntil) - today) / DAY_MS);
    const status: ControlSiteStatus =
      daysLeft < 0 ? 'EXPIRED' : daysLeft <= LICENSE_WARNING_DAYS ? 'EXPIRING' : 'ACTIVE';
    return {
      id: site.id,
      name: site.name,
      siteUrl: site.siteUrl,
      apiUrl: site.apiUrl,
      ownerName: site.ownerName,
      ownerPhone: site.ownerPhone,
      agreedPrice: site.agreedPrice.toFixed(2),
      paidUntil,
      lastPaidAt: lastPaidAt ? dateOnly(lastPaidAt) : null,
      notes: site.notes,
      status,
      daysLeft,
      synced: site.licenseSyncedAt !== null && site.licenseSyncedAt >= site.updatedAt,
    };
  }

  async list(): Promise<ControlSiteDto[]> {
    const sites = await this.prisma.controlSite.findMany({
      orderBy: { paidUntil: 'asc' },
      include: { payments: { orderBy: { paidAt: 'desc' }, take: 1 } },
    });
    return sites.map((site) => this.toDto(site, site.payments[0]?.paidAt ?? null));
  }

  async get(id: string): Promise<ControlSiteDetailDto> {
    const site =
      (await this.prisma.controlSite.findUnique({
        where: { id },
        include: { payments: { orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] } },
      })) ?? notFound();
    return {
      ...this.toDto(site, site.payments[0]?.paidAt ?? null),
      payments: site.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toFixed(2),
        paidAt: dateOnly(payment.paidAt),
        paidUntil: dateOnly(payment.paidUntil),
        note: payment.note,
      })),
    };
  }

  /** Sayt uxlab yotsa ham o'zgarish yo'qolmaydi: `synced: false`, keyin qayta yuboriladi. */
  async sync(id: string): Promise<ControlSiteDetailDto> {
    const site = (await this.prisma.controlSite.findUnique({ where: { id } })) ?? notFound();
    try {
      await this.sites.setLicense(site, {
        ownerName: site.ownerName,
        paidUntil: dateOnly(site.paidUntil),
      });
      await this.prisma.$executeRaw`
        UPDATE control_sites SET license_synced_at = updated_at WHERE id = ${id}::uuid`;
    } catch {
      // Holat `synced: false` bo'lib ko'rinadi; panel "Qayta yuborish"ni taklif qiladi.
    }
    return this.get(id);
  }

  async create(input: ControlSiteCreateInput): Promise<ControlSiteDetailDto> {
    const site = await this.prisma.controlSite.create({
      data: { ...input, paidUntil: new Date(input.paidUntil) },
    });
    return this.sync(site.id);
  }

  async update(id: string, input: ControlSiteUpdateInput): Promise<ControlSiteDetailDto> {
    await this.get(id);
    await this.prisma.controlSite.update({
      where: { id },
      data: { ...input, ...(input.paidUntil ? { paidUntil: new Date(input.paidUntil) } : {}) },
    });
    return this.sync(id);
  }

  async addPayment(id: string, input: ControlPaymentInput): Promise<ControlSiteDetailDto> {
    const site = await this.get(id);
    const paidUntil = new Date(nextPaidUntil(site.paidUntil, input.paidAt));
    await this.prisma.$transaction([
      this.prisma.controlPayment.create({
        data: {
          siteId: id,
          amount: input.amount,
          paidAt: new Date(input.paidAt),
          paidUntil,
          note: input.note ?? null,
        },
      }),
      this.prisma.controlSite.update({ where: { id }, data: { paidUntil } }),
    ]);
    return this.sync(id);
  }

  /** Adashib yozilgan to'lov tarixdan olinadi; muddat alohida "Tahrirlash"da to'g'rilanadi. */
  async deletePayment(id: string, paymentId: string): Promise<ControlSiteDetailDto> {
    await this.prisma.controlPayment.deleteMany({ where: { id: paymentId, siteId: id } });
    return this.get(id);
  }

  async requestView(id: string): Promise<{ id: string; expiresAt: string }> {
    const site = (await this.prisma.controlSite.findUnique({ where: { id } })) ?? notFound();
    return this.sites.requestView(site);
  }

  async viewStatus(id: string, requestId: string) {
    const site = (await this.prisma.controlSite.findUnique({ where: { id } })) ?? notFound();
    return this.sites.viewStatus(site, requestId);
  }

  /** To'g'ri koddan keyin ko'rish havolasi: token URL fragmentida, serverga va loglarga bormaydi. */
  async verifyView(id: string, requestId: string, code: string): Promise<{ viewUrl: string }> {
    const site = (await this.prisma.controlSite.findUnique({ where: { id } })) ?? notFound();
    const { token } = await this.sites.verifyView(site, requestId, code);
    return { viewUrl: `${site.siteUrl}/view#token=${token}` };
  }
}
