import { Injectable } from '@nestjs/common';
import {
  APP_TIMEZONE,
  type DashboardSummaryDto,
  type SalesTrendPoint,
  type TopProductDto,
} from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';

export interface Range {
  from: Date;
  to: Date;
}

interface Totals {
  count: number;
  quantity: string;
  amount: string;
}

/** Dashboard kam qoldiq ro'yxatidagi qatorlar soni (UI karta). */
export const LOW_STOCK_ITEMS = 6;

const THRESHOLD = Prisma.sql`coalesce((SELECT (value #>> '{}')::numeric FROM settings
                                       WHERE key = 'low_stock_default_threshold'), 0)`;

/**
 * Dashboard — tranzaksion jadvallardan, so'rov paytida (kesh yo'q — REQ-031). Bir nechta so'rov bitta
 * REPEATABLE READ tranzaksiyada: ko'rsatkichlar bitta snapshot'dan.
 */
@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  private totals(tx: Tx, range?: Range, userId?: string): Promise<Totals> {
    const c: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (range) c.push(Prisma.sql`sold_at >= ${range.from} AND sold_at < ${range.to}`);
    if (userId) c.push(Prisma.sql`user_id = ${userId}::uuid`);
    return tx.$queryRaw<Totals[]>`
      SELECT count(*)::int AS count, coalesce(sum(total_quantity), 0)::numeric(20, 3)::text AS quantity,
             coalesce(sum(total_amount), 0)::numeric(20, 2)::text AS amount
        FROM sales WHERE ${Prisma.join(c, ' AND ')}`.then((rows) => rows[0]!);
  }

  async summary(
    today: Range,
    yesterday: Range,
  ): Promise<Omit<DashboardSummaryDto, 'asOf' | 'businessDate'>> {
    return this.prisma.$transaction(
      async (tx: Tx) => {
        const t = await this.totals(tx, today);
        const y = await this.totals(tx, yesterday);
        const all = await this.totals(tx);
        const byUnit = await tx.$queryRaw<
          { unit: DashboardSummaryDto['warehouse']['byUnit'][number]['unit']; quantity: string }[]
        >`
          SELECT p.unit::text AS unit, sum(ws.quantity)::numeric(20, 3)::text AS quantity
            FROM warehouse_stock ws JOIN products p ON p.id = ws.product_id
           GROUP BY p.unit ORDER BY p.unit`;
        const [stock] = await tx.$queryRaw<{ total: string; products: number }[]>`
          WITH st AS (SELECT product_id, sum(quantity) AS q FROM warehouse_stock GROUP BY product_id)
          SELECT coalesce(sum(q), 0)::numeric(20, 3)::text AS total,
                 count(*) FILTER (WHERE q > 0)::int AS products
            FROM st`;
        // Kam qoldiq (BUSINESS-RULES §4, A-15): ACTIVE mahsulot, barcha omborlardagi jami qoldiq ≤ chegara.
        const low = await tx.$queryRaw<
          (DashboardSummaryDto['lowStock']['items'][number] & { total: number })[]
        >`
          WITH st AS (SELECT product_id, sum(quantity) AS q FROM warehouse_stock GROUP BY product_id),
               x AS (
                 SELECT p.id, p.name, p.unit, coalesce(st.q, 0) AS stock,
                        coalesce(p.min_stock, ${THRESHOLD}) AS threshold
                   FROM products p LEFT JOIN st ON st.product_id = p.id
                  WHERE p.status = 'ACTIVE'
               )
          SELECT x.id AS "productId", x.name, x.unit::text AS unit,
                 x.stock::numeric(20, 3)::text AS stock, x.threshold::numeric(20, 3)::text AS threshold,
                 count(*) OVER ()::int AS total
            FROM x WHERE x.stock <= x.threshold
           ORDER BY x.stock / greatest(x.threshold, 1), x.name, x.id
           LIMIT ${LOW_STOCK_ITEMS}`;
        const [users] = await tx.$queryRaw<{ active: number; total: number; soldToday: number }[]>`
          SELECT count(*) FILTER (WHERE status = 'ACTIVE')::int AS active, count(*)::int AS total,
                 (SELECT count(DISTINCT user_id)::int FROM sales
                   WHERE sold_at >= ${today.from} AND sold_at < ${today.to}) AS "soldToday"
            FROM users`;
        return {
          today: { soldQuantity: t.quantity, salesAmount: t.amount, salesCount: t.count },
          yesterday: { salesAmount: y.amount },
          allTime: { soldQuantity: all.quantity, salesAmount: all.amount, salesCount: all.count },
          warehouse: { totalQuantity: stock!.total, byUnit, productCount: stock!.products },
          lowStock: {
            count: low[0]?.total ?? 0,
            items: low.map(({ total: _total, ...item }) => item),
          },
          users: users!,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Kunlik savdo (Toshkent kunlari), bo'sh kunlar — 0. */
  trend(firstDay: string, lastDay: string, range: Range): Promise<SalesTrendPoint[]> {
    return this.prisma.$queryRaw<SalesTrendPoint[]>`
      WITH d AS (SELECT generate_series(${firstDay}::date, ${lastDay}::date, interval '1 day')::date AS day),
           a AS (
             SELECT (sold_at AT TIME ZONE ${APP_TIMEZONE})::date AS day, count(*) AS n, sum(total_amount) AS amount
               FROM sales WHERE sold_at >= ${range.from} AND sold_at < ${range.to}
              GROUP BY 1
           )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date, coalesce(a.amount, 0)::numeric(20, 2)::text AS amount,
             coalesce(a.n, 0)::int AS count
        FROM d LEFT JOIN a ON a.day = d.day ORDER BY d.day`;
  }

  /** Eng ko'p sotilgan mahsulotlar — summa bo'yicha (D-21). */
  top(range: Range, limit: number): Promise<TopProductDto[]> {
    return this.prisma.$queryRaw<TopProductDto[]>`
      SELECT p.id AS "productId", p.name, p.unit::text AS unit,
             sum(si.quantity)::numeric(20, 3)::text AS quantity,
             sum(si.line_total)::numeric(20, 2)::text AS amount
        FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
       WHERE s.sold_at >= ${range.from} AND s.sold_at < ${range.to}
       GROUP BY p.id, p.name, p.unit
       ORDER BY sum(si.line_total) DESC, sum(si.quantity) DESC, p.name, p.id
       LIMIT ${limit}`;
  }

  /** Sotuvchining bugungi ko'rsatkichlari (OWN-08) va unga ruxsat etilgan faol omborlar. */
  async mySummary(
    today: Range,
    userId: string,
    warehouseIds: string[] | undefined,
  ): Promise<{ totals: Totals; warehouses: { id: string; name: string }[] }> {
    return this.prisma.$transaction(
      async (tx: Tx) => {
        const totals = await this.totals(tx, today, userId);
        const scope =
          warehouseIds === undefined
            ? Prisma.empty
            : Prisma.sql`AND id = ANY(${warehouseIds}::uuid[])`;
        const warehouses = await tx.$queryRaw<{ id: string; name: string }[]>`
          SELECT id, name FROM warehouses WHERE status = 'ACTIVE' ${scope} ORDER BY lower(name), id`;
        return { totals, warehouses };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
