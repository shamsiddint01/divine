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
  amountDue,
  applyPayment,
  type ControlDashboardDto,
  type ControlEventDto,
  type ControlSiteHealthDto,
  LICENSE_WARNING_DAYS,
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
const HEALTH_TIMEOUT_MS = 8_000;
const LICENSE_PAYMENTS = 12;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const dateOrNull = (date: Date | null) => (date ? dateOnly(date) : null);

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
    const graceUntil = dateOrNull(site.graceUntil);
    const until = graceUntil && graceUntil > paidUntil ? graceUntil : paidUntil;
    const today = Date.parse(tashkentToday(this.clock.now()));
    const daysLeft = Math.round((Date.parse(until) - today) / DAY_MS);
    const status: ControlSiteStatus =
      site.manualBlock || daysLeft < 0
        ? 'EXPIRED'
        : daysLeft <= LICENSE_WARNING_DAYS
          ? 'EXPIRING'
          : 'ACTIVE';
    const agreedPrice = site.agreedPrice.toFixed(2);
    const balance = site.balance.toFixed(2);
    return {
      id: site.id,
      name: site.name,
      siteUrl: site.siteUrl,
      apiUrl: site.apiUrl,
      ownerName: site.ownerName,
      ownerPhone: site.ownerPhone,
      agreedPrice,
      paidUntil,
      lastPaidAt: lastPaidAt ? dateOnly(lastPaidAt) : null,
      notes: site.notes,
      status,
      daysLeft,
      synced: site.licenseSyncedAt !== null && site.licenseSyncedAt >= site.updatedAt,
      balance,
      amountDue: amountDue(agreedPrice, balance),
      manualBlock: site.manualBlock,
      graceUntil,
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
    const site =
      (await this.prisma.controlSite.findUnique({
        where: { id },
        include: { payments: { orderBy: { paidAt: 'desc' }, take: LICENSE_PAYMENTS } },
      })) ?? notFound();
    try {
      await this.sites.setLicense(site, {
        ownerName: site.ownerName,
        paidUntil: dateOnly(site.paidUntil),
        agreedPrice: site.agreedPrice.toFixed(2),
        balance: site.balance.toFixed(2),
        lastPaidAt: site.payments[0] ? dateOnly(site.payments[0].paidAt) : null,
        manualBlock: site.manualBlock,
        graceUntil: dateOrNull(site.graceUntil),
        payments: site.payments.map((payment) => ({
          amount: payment.amount.toFixed(2),
          paidAt: dateOnly(payment.paidAt),
          paidUntil: dateOnly(payment.paidUntil),
        })),
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
    await this.event(site.id, 'SITE_CREATED', { name: input.name, ownerName: input.ownerName });
    return this.sync(site.id);
  }

  async update(id: string, input: ControlSiteUpdateInput): Promise<ControlSiteDetailDto> {
    await this.get(id);
    const { graceUntil, ...rest } = input;
    await this.prisma.controlSite.update({
      where: { id },
      data: {
        ...rest,
        ...(input.paidUntil ? { paidUntil: new Date(input.paidUntil) } : {}),
        ...(graceUntil !== undefined
          ? { graceUntil: graceUntil ? new Date(graceUntil) : null }
          : {}),
      },
    });
    await this.event(id, 'SITE_UPDATED', { ...input });
    return this.sync(id);
  }

  async addPayment(id: string, input: ControlPaymentInput): Promise<ControlSiteDetailDto> {
    const site = await this.get(id);
    const result = applyPayment({
      paidUntil: site.paidUntil,
      balance: site.balance,
      agreedPrice: site.agreedPrice,
      paidAt: input.paidAt,
      amount: input.amount,
    });
    await this.prisma.$transaction([
      this.prisma.controlPayment.create({
        data: {
          siteId: id,
          amount: input.amount,
          paidAt: new Date(input.paidAt),
          paidUntil: new Date(result.paidUntil),
          note: input.note ?? null,
        },
      }),
      this.prisma.controlSite.update({
        where: { id },
        data: { paidUntil: new Date(result.paidUntil), balance: result.balance },
      }),
    ]);
    await this.event(id, 'PAYMENT_ADDED', {
      amount: input.amount,
      paidAt: input.paidAt,
      paidUntil: result.paidUntil,
      months: result.months,
      balance: result.balance,
    });
    return this.sync(id);
  }

  /** Adashib yozilgan to'lov tarixdan olinadi; muddat alohida "Tahrirlash"da to'g'rilanadi. */
  async deletePayment(id: string, paymentId: string): Promise<ControlSiteDetailDto> {
    const { count } = await this.prisma.controlPayment.deleteMany({
      where: { id: paymentId, siteId: id },
    });
    if (count > 0) await this.event(id, 'PAYMENT_DELETED', { paymentId });
    return this.sync(id);
  }

  async requestView(id: string): Promise<{ id: string; expiresAt: string }> {
    const site = (await this.prisma.controlSite.findUnique({ where: { id } })) ?? notFound();
    const request = await this.sites.requestView(site);
    await this.event(id, 'VIEW_REQUESTED', {});
    return request;
  }

  async viewStatus(id: string, requestId: string) {
    const site = (await this.prisma.controlSite.findUnique({ where: { id } })) ?? notFound();
    return this.sites.viewStatus(site, requestId);
  }

  /** To'g'ri koddan keyin ko'rish havolasi: token URL fragmentida, serverga va loglarga bormaydi. */
  async verifyView(id: string, requestId: string, code: string): Promise<{ viewUrl: string }> {
    const site = (await this.prisma.controlSite.findUnique({ where: { id } })) ?? notFound();
    const { token } = await this.sites.verifyView(site, requestId, code);
    await this.event(id, 'VIEW_OPENED', {});
    return { viewUrl: `${site.siteUrl}/view#token=${token}` };
  }

  private async event(siteId: string | null, action: string, details: object): Promise<void> {
    await this.prisma.controlEvent.create({
      data: { siteId, action, details: JSON.parse(JSON.stringify(details)) },
    });
  }

  async events(siteId?: string): Promise<ControlEventDto[]> {
    const rows = await this.prisma.controlEvent.findMany({
      where: siteId ? { siteId } : {},
      orderBy: { occurredAt: 'desc' },
      take: 100,
      include: { site: { select: { name: true } } },
    });
    return rows.map((row) => ({
      id: row.id.toString(),
      occurredAt: row.occurredAt.toISOString(),
      siteId: row.siteId,
      siteName: row.site?.name ?? null,
      action: row.action,
      details: row.details as Record<string, unknown>,
    }));
  }

  async dashboard(): Promise<ControlDashboardDto> {
    const sites = await this.list();
    const today = tashkentToday(this.clock.now());
    const month = today.slice(0, 7);
    const payments = await this.prisma.controlPayment.findMany({
      where: { paidAt: { gte: new Date(`${month}-01`) } },
      select: { amount: true, paidAt: true },
    });
    const cents = (value: string) => Math.round(Number(value) * 100);
    const revenue = payments
      .filter((payment) => dateOnly(payment.paidAt).startsWith(month))
      .reduce((sum, payment) => sum + cents(payment.amount.toFixed(2)), 0);
    const expected = sites
      .filter((site) => !site.manualBlock && site.paidUntil.slice(0, 7) <= month)
      .reduce((sum, site) => sum + cents(site.amountDue), 0);
    return {
      sites: {
        total: sites.length,
        active: sites.filter((site) => site.status === 'ACTIVE').length,
        expiring: sites.filter((site) => site.status === 'EXPIRING').length,
        expired: sites.filter((site) => site.status === 'EXPIRED').length,
      },
      revenueThisMonth: (revenue / 100).toFixed(2),
      expectedThisMonth: (expected / 100).toFixed(2),
    };
  }

  /** Sayt ishlayaptimi: `/health` javob beradimi. Uxlayotgan bepul server uyg'onguncha javobsiz. */
  async health(): Promise<ControlSiteHealthDto[]> {
    const sites = await this.prisma.controlSite.findMany({ select: { id: true, apiUrl: true } });
    return Promise.all(
      sites.map(async (site) => {
        const started = Date.now();
        try {
          const response = await fetch(`${site.apiUrl}/api/v1/health`, {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
          });
          return { id: site.id, ok: response.ok, ms: response.ok ? Date.now() - started : null };
        } catch {
          return { id: site.id, ok: false, ms: null };
        }
      }),
    );
  }
}
