import { Injectable } from '@nestjs/common';
import type { SiteStatsDto, SiteVersionDto } from '@divine/shared';
import { Clock } from '../../common/time/clock.js';
import { tashkentToday } from '../../common/time/tashkent-time.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

const DAY_MS = 86_400_000;
/** Tashkent UTC+5: kun boshi UTC'da 19:00 (oldingi kun). */
const TASHKENT_OFFSET_MS = 5 * 3_600_000;

/**
 * Superadmin uchun sayt ishlatilyaptimi: nechta mahsulot, sotuv va kim oxirgi marta qachon kirgan.
 * Faqat sonlar va loginlar: mijoz va sotuv tafsilotlari panelga bormaydi.
 */
@Injectable()
export class SiteStatsService {
  private readonly startedAt: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {
    this.startedAt = clock.now().toISOString();
  }

  version(): SiteVersionDto {
    return {
      commit: this.config.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
      startedAt: this.startedAt,
    };
  }

  async stats(): Promise<SiteStatsDto> {
    const todayStart = new Date(Date.parse(tashkentToday(this.clock.now())) - TASHKENT_OFFSET_MS);
    const monthStart = new Date(todayStart.getTime() - 29 * DAY_MS);
    const [products, customers, warehouses, total, today, last30Days, lastSale, users] =
      await Promise.all([
        this.prisma.product.count({ where: { status: 'ACTIVE' } }),
        this.prisma.customer.count(),
        this.prisma.warehouse.count({ where: { status: 'ACTIVE' } }),
        this.prisma.sale.count(),
        this.prisma.sale.count({ where: { soldAt: { gte: todayStart } } }),
        this.prisma.sale.count({ where: { soldAt: { gte: monthStart } } }),
        this.prisma.sale.findFirst({ orderBy: { soldAt: 'desc' }, select: { soldAt: true } }),
        this.prisma.user.findMany({
          orderBy: { login: 'asc' },
          select: {
            login: true,
            fullName: true,
            status: true,
            lastLoginAt: true,
            role: { select: { code: true } },
            sessions: {
              orderBy: { lastUsedAt: { sort: 'desc', nulls: 'last' } },
              take: 1,
              select: { lastUsedAt: true, createdAt: true },
            },
          },
        }),
      ]);
    return {
      products,
      customers,
      warehouses,
      sales: { today, last30Days, total, lastAt: lastSale?.soldAt.toISOString() ?? null },
      users: users.map((user) => {
        const session = user.sessions[0];
        const seen = session ? (session.lastUsedAt ?? session.createdAt) : null;
        const lastSeen =
          seen && (!user.lastLoginAt || seen > user.lastLoginAt) ? seen : user.lastLoginAt;
        return {
          login: user.login,
          fullName: user.fullName,
          role: user.role.code,
          active: user.status === 'ACTIVE',
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          lastSeenAt: lastSeen?.toISOString() ?? null,
        };
      }),
    };
  }
}
