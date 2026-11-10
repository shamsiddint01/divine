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
  type AnnouncementInput,
  type ControlDashboardDto,
  type ControlTicketDto,
  type SupportStatus,
  type ControlEventDto,
  type ControlSiteHealthDto,
  type ControlLeadDto,
  type ControlLeadStatus,
  type ControlLeadUpdateInput,
  type ControlLoginDto,
  type ControlLoginOutcome,
  type ControlRevenueMonthDto,
  type SiteMaintenanceInput,
  describeDevice,
  LICENSE_WARNING_DAYS,
} from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { tashkentToday } from '../../common/time/tashkent-time.js';
import type { ControlLead, ControlSite } from '../../generated/prisma/client.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { PasswordHasher } from '../auth/password/password-hasher.js';
import { TokenService } from '../auth/token.service.js';
import { ControlTwoFactor } from './control-two-factor.js';
import { SiteClient } from './site-client.js';
import { TelegramService } from '../telegram/telegram.service.js';

const DAY_MS = 86_400_000;
const HEALTH_TIMEOUT_MS = 8_000;
/** Ishlayaptimi tekshiruvi: uxlayotgan bepul server uyg'onishiga vaqt. */
const UPTIME_TIMEOUT_MS = 60_000;
/** Ketma-ket shuncha muvaffaqiyatsiz tekshiruvdan keyin "ishlamayapti" xabari (bir martalik uzilish emas). */
const UPTIME_FAILURES = 2;
/** Saytlar ro'yxati xotirada: har 10 daqiqalik tekshiruv bazani (Neon) uyg'otmasin. */
const UPTIME_SITES_TTL_MS = 6 * 3_600_000;
const uptimeKey = (id: string) => `divine:control:uptime:${id}`;
/** Noto'g'ri parol xabari ko'pi bilan shuncha vaqtda bir marta (hujumda Telegram to'lib ketmasin). */
const BAD_PASSWORD_ALERT_KEY = 'divine:control:alert:bad-password';
const BAD_PASSWORD_ALERT_SECONDS = 15 * 60;
const REVENUE_MONTHS = 12;
const LOGINS_LIMIT = 100;
const LEADS_LIMIT = 200;
const money = (value: string) => `${Number(value).toLocaleString('ru-RU')} so‘m`;
const dotted = (date: string) => date.split('-').reverse().join('.');

export interface LoginMeta {
  ip: string | null;
  userAgent: string | null;
}

export const LEAD_STATUS_LABEL: Record<ControlLeadStatus, string> = {
  NEW: 'yangi',
  CALLED: 'qo‘ng‘iroq qilindi',
  CLIENT: 'mijoz bo‘ldi',
  REJECTED: 'rad etildi',
};
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
    private readonly twoFactor: ControlTwoFactor,
    private readonly telegram: TelegramService,
    private readonly redis: RedisService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  /** Parol to'g'ri bo'lsa: Telegram sozlangan — kod yuboriladi, aks holda darhol sessiya. */
  async login(
    input: ControlLoginInput,
    meta: LoginMeta,
  ): Promise<{ token: string; twoFactorPaused: boolean } | { challengeId: string }> {
    let adminId: string;
    try {
      adminId = await this.checkPassword(input);
    } catch (error) {
      await this.recordLogin(null, 'BAD_PASSWORD', meta);
      throw error;
    }
    if (this.twoFactor.enabled) {
      const challengeId = await this.twoFactor.start(adminId);
      await this.recordLogin(adminId, 'CODE_SENT', meta);
      return { challengeId };
    }
    await this.recordLogin(adminId, 'SUCCESS', meta);
    return {
      token: await this.tokens.signControlToken(adminId, this.clock.now()),
      twoFactorPaused: !this.config.CONTROL_TWO_FACTOR,
    };
  }

  async verifyCode(challengeId: string, code: string, meta: LoginMeta): Promise<string> {
    let adminId: string;
    try {
      adminId = await this.twoFactor.verify(challengeId, code);
    } catch (error) {
      await this.recordLogin(null, 'BAD_CODE', meta);
      throw error;
    }
    await this.recordLogin(adminId, 'SUCCESS', meta);
    return this.tokens.signControlToken(adminId, this.clock.now());
  }

  /**
   * Kirishlar tarixi (egasining qarori, 2026-11-10). Ogohlantirish Telegram'ga: yangi qurilmadan kirildi,
   * kod noto'g'ri (demak parol kimgadir ma'lum) yoki noto'g'ri parol (15 daqiqada bir marta).
   */
  private async recordLogin(
    adminId: string | null,
    outcome: ControlLoginOutcome,
    meta: LoginMeta,
  ): Promise<void> {
    const userAgent = meta.userAgent?.slice(0, 300) ?? null;
    const ip = meta.ip?.slice(0, 64) ?? null;
    const newDevice =
      outcome === 'SUCCESS' &&
      (await this.prisma.controlLogin.count({
        where: { outcome: 'SUCCESS', userAgent, ...(adminId ? { adminId } : {}) },
      })) === 0;
    await this.prisma.controlLogin.create({ data: { adminId, outcome, ip, userAgent, newDevice } });
    const where = `${describeDevice(userAgent)}, IP ${ip ?? '—'}`;
    let alert: string | null = null;
    if (newDevice) {
      alert =
        `⚠️ Superadmin'ga yangi qurilmadan kirildi: ${where}.\n` +
        'Siz bo‘lmasangiz, darhol parolni almashtiring.';
    } else if (outcome === 'BAD_CODE') {
      alert =
        `⚠️ Superadmin: parol to‘g‘ri, lekin kod noto‘g‘ri kiritildi (${where}).\n` +
        'Siz bo‘lmasangiz, parolni almashtiring.';
    } else if (outcome === 'BAD_PASSWORD') {
      const first = await this.redis.client.set(
        BAD_PASSWORD_ALERT_KEY,
        '1',
        'EX',
        BAD_PASSWORD_ALERT_SECONDS,
        'NX',
      );
      if (first) alert = `⚠️ Superadmin'ga noto‘g‘ri parol bilan kirishga urinish: ${where}.`;
    }
    if (alert && this.telegram.enabled) await this.telegram.send(alert).catch(() => undefined);
  }

  async logins(): Promise<ControlLoginDto[]> {
    const rows = await this.prisma.controlLogin.findMany({
      orderBy: { occurredAt: 'desc' },
      take: LOGINS_LIMIT,
    });
    return rows.map((row) => ({
      id: row.id.toString(),
      occurredAt: row.occurredAt.toISOString(),
      outcome: row.outcome as ControlLoginOutcome,
      ip: row.ip,
      device: describeDevice(row.userAgent),
      newDevice: row.newDevice,
    }));
  }

  /**
   * Kunlik hisobot (09:00, GitHub Actions; `/bugun` buyrug'i ham shu): to'lovlar, muddati yaqinlashgan
   * va bloklangan saytlar, javob kutayotgan murojaatlar, yangi arizalar.
   */
  async report(kind: 'morning' | 'today'): Promise<string> {
    const sites = await this.list();
    const today = tashkentToday(this.clock.now());
    const day =
      kind === 'today' ? today : dateOnly(new Date(Date.parse(today) - DAY_MS));
    const payments = await this.prisma.controlPayment.findMany({
      where: { paidAt: new Date(day) },
      include: { site: { select: { name: true } } },
    });
    const dashboard = await this.dashboard();
    const tickets = await this.tickets().catch(() => ({ tickets: [], unreachable: [] }));
    const open = tickets.tickets.filter(
      (ticket) => ticket.kind === 'MANUAL' && ticket.status !== 'RESOLVED',
    );
    const leads = await this.prisma.controlLead.findMany({
      where: { status: 'NEW' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const line = (site: ControlSiteDto) =>
      `• ${site.name} — ${site.ownerName}${site.ownerPhone ? `, ${site.ownerPhone}` : ''}: ` +
      `${dotted(site.paidUntil)}, kerak ${money(site.amountDue)}`;
    const expiring = sites.filter((site) => site.status === 'EXPIRING');
    const expired = sites.filter((site) => site.status === 'EXPIRED');
    const total = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const parts = [
      `📊 Divine: ${kind === 'today' ? 'bugungi' : 'kunlik'} hisobot (${dotted(today)})`,
      '',
      `💰 ${kind === 'today' ? 'Bugun' : 'Kecha'} tushgan: ` +
        (payments.length === 0
          ? 'to‘lov yo‘q'
          : `${payments.length} ta, ${money(total.toFixed(2))}`),
      ...payments.map((payment) => `• ${payment.site.name}: ${money(payment.amount.toFixed(2))}`),
      `📅 Bu oy: tushgan ${money(dashboard.revenueThisMonth)}, kutilmoqda ${money(dashboard.expectedThisMonth)}`,
    ];
    if (expiring.length > 0) parts.push('', '⏰ Bugun yoki ertaga to‘lashi kerak:', ...expiring.map(line));
    if (expired.length > 0) parts.push('', '⛔ Bloklangan:', ...expired.map(line));
    parts.push('', `💬 Javob kutayotgan murojaatlar: ${open.length}${open.length ? ' (/murojaatlar)' : ''}`);
    parts.push(`📝 Yangi arizalar: ${leads.length}`);
    parts.push(...leads.map((lead) => `• #${lead.number} ${lead.name}, ${lead.phone}`));
    parts.push(`🖥 Saytlar: ${sites.length} ta, faol ${dashboard.sites.active}`);
    return parts.join('\n');
  }

  /** Kunlik hisobot har kuni yuboriladi (egasining qarori, 2026-11-10). */
  async dailyReminder(): Promise<{ sent: boolean }> {
    if (!this.telegram.enabled) return { sent: false };
    await this.telegram.send(await this.report('morning'));
    return { sent: true };
  }

  private uptimeSites: { at: number; sites: Pick<ControlSite, 'id' | 'name' | 'apiUrl'>[] } | null =
    null;

  /**
   * Saytlar ishlayaptimi (GitHub Actions har 10 daqiqada). Holat o'zgarganda Telegram'ga xabar:
   * ketma-ket ikki marta javob bo'lmasa — "ishlamayapti", qayta javob bersa — "yana ishlayapti".
   * Bazaga tegmaydigan `/health/live` so'raladi: Neon bepul limiti tejaladi.
   */
  async uptimeCheck(): Promise<{ checked: number; down: string[] }> {
    const now = Date.now();
    if (!this.uptimeSites || now - this.uptimeSites.at > UPTIME_SITES_TTL_MS) {
      this.uptimeSites = {
        at: now,
        sites: await this.prisma.controlSite.findMany({
          select: { id: true, name: true, apiUrl: true },
        }),
      };
    }
    const down: string[] = [];
    await Promise.all(
      this.uptimeSites.sites.map(async (site) => {
        const ok = await fetch(`${site.apiUrl}/api/v1/health/live`, {
          signal: AbortSignal.timeout(UPTIME_TIMEOUT_MS),
        }).then(
          (response) => response.ok,
          () => false,
        );
        const key = uptimeKey(site.id);
        if (ok) {
          const failures = Number(await this.redis.client.getdel(key));
          if (failures >= UPTIME_FAILURES) await this.alert(`✅ ${site.name} yana ishlayapti.`);
          return;
        }
        down.push(site.name);
        const failures = await this.redis.client.incr(key);
        if (failures === UPTIME_FAILURES) {
          await this.alert(`🔴 ${site.name} ishlamayapti: ${site.apiUrl} javob bermayapti.`);
        }
      }),
    );
    return { checked: this.uptimeSites.sites.length, down };
  }

  private async alert(text: string): Promise<void> {
    if (this.telegram.enabled) await this.telegram.send(text).catch(() => undefined);
  }

  async telegramTest(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.telegram.enabled) return { ok: false, reason: 'Telegram sozlanmagan' };
    try {
      await this.telegram.send('Divine: sinov xabari. Telegram ishlayapti.');
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'xato' };
    }
  }

  private async checkPassword(input: ControlLoginInput): Promise<string> {
    const admin = await this.prisma.controlAdmin.findUnique({
      where: { login: input.login.toLowerCase() },
    });
    const valid = admin
      ? await this.hasher.verify(admin.passwordHash, input.password)
      : await this.hasher.verifyAgainstDummy(input.password);
    if (!admin || !valid) throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    return admin.id;
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
        include: {
          payments: {
            orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
            take: LICENSE_PAYMENTS,
          },
        },
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
    this.uptimeSites = null;
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
    this.uptimeSites = null;
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
    const sites = await this.prisma.controlSite.findMany({
      select: { id: true, apiUrl: true, apiToken: true },
    });
    return Promise.all(
      sites.map(async (site) => {
        const started = Date.now();
        let ok = false;
        let ms: number | null = null;
        try {
          const response = await fetch(`${site.apiUrl}/api/v1/health`, {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
          });
          ok = response.ok;
          ms = ok ? Date.now() - started : null;
        } catch {
          // Javob yo'q: uxlayotgan yoki ishlamayotgan sayt.
        }
        const status = ok ? await this.sites.status(site).catch(() => null) : null;
        return {
          id: site.id,
          ok,
          ms,
          backup: status?.backup ?? null,
          version: status?.version ?? null,
          maintenance: status?.maintenance ?? null,
        };
      }),
    );
  }

  private async siteOf(id: string) {
    return (await this.prisma.controlSite.findUnique({ where: { id } })) ?? notFound();
  }

  /** Hamma saytdagi murojaatlar: javob bermagan sayt o'tkazib yuboriladi (uxlayotgan bo'lishi mumkin). */
  async tickets(): Promise<{ tickets: ControlTicketDto[]; unreachable: string[] }> {
    const sites = await this.prisma.controlSite.findMany({ orderBy: { name: 'asc' } });
    const unreachable: string[] = [];
    const lists = await Promise.all(
      sites.map(async (site) => {
        try {
          const items = await this.sites.tickets(site);
          return items.map((ticket) => ({ ...ticket, siteId: site.id, siteName: site.name }));
        } catch {
          unreachable.push(site.name);
          return [];
        }
      }),
    );
    const tickets = lists.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { tickets, unreachable };
  }

  async replyTicket(siteId: string, ticketId: string, body: string) {
    const site = await this.siteOf(siteId);
    const ticket = await this.sites.replyTicket(site, ticketId, body);
    await this.event(siteId, 'TICKET_REPLIED', { number: ticket.number });
    return ticket;
  }

  async ticketStatus(siteId: string, ticketId: string, status: SupportStatus) {
    const site = await this.siteOf(siteId);
    const ticket = await this.sites.ticketStatus(site, ticketId, status);
    await this.event(siteId, 'TICKET_STATUS', { number: ticket.number, status });
    return ticket;
  }

  async feedback(siteId: string) {
    return this.sites.feedback(await this.siteOf(siteId));
  }

  async setAnnouncement(siteId: string, input: AnnouncementInput | null): Promise<void> {
    await this.sites.setAnnouncement(await this.siteOf(siteId), input);
    await this.event(siteId, input ? 'ANNOUNCEMENT_SET' : 'ANNOUNCEMENT_CLEARED', input ?? {});
  }

  /** Oxirgi 12 oy tushumi (bo'sh oylar ham — grafik uzilmasin). */
  async revenue(): Promise<ControlRevenueMonthDto[]> {
    const month = tashkentToday(this.clock.now()).slice(0, 7);
    const [year, mon] = month.split('-').map(Number) as [number, number];
    const months = Array.from({ length: REVENUE_MONTHS }, (_, index) =>
      new Date(Date.UTC(year, mon - REVENUE_MONTHS + index, 1)).toISOString().slice(0, 7),
    );
    const rows = await this.prisma.$queryRaw<{ month: string; amount: string; payments: bigint }[]>`
      SELECT to_char(paid_at, 'YYYY-MM') AS month, sum(amount)::text AS amount, count(*) AS payments
        FROM control_payments
       WHERE paid_at >= ${new Date(`${months[0]}-01`)}
       GROUP BY 1`;
    const byMonth = new Map(rows.map((row) => [row.month, row]));
    return months.map((item) => {
      const row = byMonth.get(item);
      return {
        month: item,
        amount: row ? Number(row.amount).toFixed(2) : '0.00',
        payments: row ? Number(row.payments) : 0,
      };
    });
  }

  /** Hamma to'lovlar (Excel va kvitansiya uchun). */
  async allPayments() {
    const rows = await this.prisma.controlPayment.findMany({
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      include: { site: { select: { name: true, ownerName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      siteName: row.site.name,
      ownerName: row.site.ownerName,
      amount: row.amount.toFixed(2),
      paidAt: dateOnly(row.paidAt),
      paidUntil: dateOnly(row.paidUntil),
      note: row.note,
    }));
  }

  async stats(id: string) {
    return this.sites.stats(await this.siteOf(id));
  }

  async setMaintenance(id: string, input: SiteMaintenanceInput): Promise<void> {
    await this.sites.setMaintenance(await this.siteOf(id), input);
    await this.event(id, input.enabled ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF', {
      message: input.message ?? null,
    });
  }

  async revokeSessions(id: string): Promise<{ revoked: number }> {
    const result = await this.sites.revokeSessions(await this.siteOf(id));
    await this.event(id, 'SESSIONS_REVOKED', result);
    return result;
  }

  private toLeadDto(row: ControlLead): ControlLeadDto {
    return {
      id: row.id,
      number: row.number.toString(),
      name: row.name,
      phone: row.phone,
      username: row.username,
      status: row.status as ControlLeadStatus,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async leads(): Promise<ControlLeadDto[]> {
    const rows = await this.prisma.controlLead.findMany({
      orderBy: { createdAt: 'desc' },
      take: LEADS_LIMIT,
    });
    return rows.map((row) => this.toLeadDto(row));
  }

  async updateLead(id: string, input: ControlLeadUpdateInput): Promise<ControlLeadDto> {
    const { count } = await this.prisma.controlLead.updateMany({ where: { id }, data: input });
    if (count === 0) notFound();
    const row = await this.prisma.controlLead.findUniqueOrThrow({ where: { id } });
    if (input.status) {
      await this.event(null, 'LEAD_STATUS', { number: row.number.toString(), status: input.status });
    }
    return this.toLeadDto(row);
  }
}
