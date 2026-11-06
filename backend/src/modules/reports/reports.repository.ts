import { Injectable } from '@nestjs/common';
import type {
  IncomingReportDetailDto,
  IncomingReportItemDto,
  ReportColumn,
  ReportGroupItem,
  ReportSummaryDef,
  ReportType,
} from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { tashkentDateRangeToUtc } from '../../common/time/tashkent-time.js';
import { escapeLike } from '../product-groups/product-groups.repository.js';

export interface ReportQuery {
  page: number;
  pageSize: number;
  sort: { field: string; direction: 'asc' | 'desc' };
  dateFrom?: string;
  dateTo?: string;
  productId?: string;
  userId?: string;
  warehouseId?: string;
  groupId?: string;
  customerId?: string;
  categoryId?: string;
  status?: string;
  search?: string;
}

/**
 * Hisobot SQL'i: `cte` — `WITH … r AS (…)` (ustun nomlari = `ReportDefinition` kalitlari, `_k` — barqaror
 * saralash uchun noyob kalit); `where` — `r` ustidagi qo'shimcha shart (holat filtri); `summary` — yig'ma
 * ifodalari (`r` ustida, butun filtr bo'yicha).
 */
interface ReportSql {
  cte: Prisma.Sql;
  where?: Prisma.Sql;
  summary: Record<string, Prisma.Sql>;
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const iso = (column: Prisma.Sql) =>
  Prisma.sql`to_char(${column} AT TIME ZONE 'UTC', ${Prisma.raw(ISO)})`;

const THRESHOLD = Prisma.sql`coalesce((SELECT (value #>> '{}')::numeric FROM settings
                                       WHERE key = 'low_stock_default_threshold'), 0)`;

/** Sotuvlar bo'yicha umumiy filtr (`s` — `sales`): sana (Toshkent kunlari), user, ombor, mijoz, mahsulot. */
function salesWhere(q: ReportQuery, opts: { productLines?: boolean } = {}): Prisma.Sql {
  const { from, to } = tashkentDateRangeToUtc(q);
  const c: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (from) c.push(Prisma.sql`s.sold_at >= ${from}`);
  if (to) c.push(Prisma.sql`s.sold_at < ${to}`);
  if (q.userId) c.push(Prisma.sql`s.user_id = ${q.userId}::uuid`);
  if (q.warehouseId) c.push(Prisma.sql`s.warehouse_id = ${q.warehouseId}::uuid`);
  if (q.customerId) c.push(Prisma.sql`s.customer_id = ${q.customerId}::uuid`);
  // Sotuv darajasidagi hisobotlarda — mahsulot qatnashgan sotuvlar; qator darajasida — shu mahsulot qatorlari.
  if (q.productId && !opts.productLines) {
    c.push(
      Prisma.sql`EXISTS (SELECT 1 FROM sale_items fi WHERE fi.sale_id = s.id AND fi.product_id = ${q.productId}::uuid)`,
    );
  }
  return Prisma.join(c, ' AND ');
}

const coalesceSum = (expr: Prisma.Sql) => Prisma.sql`coalesce(sum(${expr}), 0)`;

const BUILDERS: Record<ReportType, (q: ReportQuery) => ReportSql> = {
  sales: (q) => ({
    cte: Prisma.sql`WITH r AS (
      SELECT s.id::text AS _k, s.sold_at AS "soldAt",
             'S-' || lpad(s.number::text, 6, '0') AS number, s.customer_name_snapshot AS customer,
             coalesce(u.full_name, u.login) AS seller, w.name AS warehouse,
             s.total_quantity AS quantity, s.total_amount AS revenue, s.total_cost AS cost,
             s.total_amount - s.total_cost AS profit
        FROM sales s JOIN users u ON u.id = s.user_id JOIN warehouses w ON w.id = s.warehouse_id
       WHERE ${salesWhere(q)})`,
    summary: {
      count: Prisma.sql`count(*)`,
      revenue: coalesceSum(Prisma.sql`revenue`),
      cost: coalesceSum(Prisma.sql`cost`),
      profit: coalesceSum(Prisma.sql`profit`),
    },
  }),

  products: (q) => {
    const { from, to } = tashkentDateRangeToUtc(q);
    const product: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (q.productId) product.push(Prisma.sql`p.id = ${q.productId}::uuid`);
    if (q.groupId) product.push(Prisma.sql`p.group_id = ${q.groupId}::uuid`);
    const stockWarehouse = q.warehouseId
      ? Prisma.sql`WHERE ws.warehouse_id = ${q.warehouseId}::uuid`
      : Prisma.empty;
    const receivedWarehouse = q.warehouseId
      ? Prisma.sql`AND m.warehouse_id = ${q.warehouseId}::uuid`
      : Prisma.empty;
    return {
      cte: Prisma.sql`WITH sd AS (
          SELECT si.product_id, sum(si.quantity) AS q, sum(si.line_total) AS rev, sum(si.line_cost) AS cst
            FROM sale_items si JOIN sales s ON s.id = si.sale_id
           WHERE ${salesWhere({ ...q, productId: undefined })}
           GROUP BY si.product_id
        ), rc AS (
          SELECT m.product_id, sum(m.quantity) AS q FROM inventory_movements m
           WHERE m.movement_type = 'INCOMING' AND m.created_at >= ${from!} AND m.created_at < ${to!}
                 ${receivedWarehouse}
           GROUP BY m.product_id
        ), st AS (
          SELECT ws.product_id, sum(ws.quantity) AS q FROM warehouse_stock ws ${stockWarehouse}
           GROUP BY ws.product_id
        ), r AS (
          SELECT p.id::text AS _k, p.name AS product, g.name AS "group",
                 coalesce(rc.q, 0) AS received, coalesce(sd.q, 0) AS sold, coalesce(st.q, 0) AS stock,
                 coalesce(sd.rev, 0) AS revenue, coalesce(sd.rev, 0) - coalesce(sd.cst, 0) AS profit
            FROM products p JOIN product_groups g ON g.id = p.group_id
            LEFT JOIN sd ON sd.product_id = p.id LEFT JOIN rc ON rc.product_id = p.id
            LEFT JOIN st ON st.product_id = p.id
           WHERE ${Prisma.join(product, ' AND ')})`,
      where:
        q.status === 'sold'
          ? Prisma.sql`WHERE r.sold > 0`
          : q.status === 'unsold'
            ? Prisma.sql`WHERE r.sold = 0`
            : undefined,
      summary: {
        count: Prisma.sql`count(*)`,
        quantity: coalesceSum(Prisma.sql`sold`),
        revenue: coalesceSum(Prisma.sql`revenue`),
        profit: coalesceSum(Prisma.sql`profit`),
      },
    };
  },

  warehouse: (q) => {
    const c: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (q.warehouseId) c.push(Prisma.sql`ws.warehouse_id = ${q.warehouseId}::uuid`);
    if (q.productId) c.push(Prisma.sql`ws.product_id = ${q.productId}::uuid`);
    if (q.groupId) c.push(Prisma.sql`p.group_id = ${q.groupId}::uuid`);
    return {
      // Holat — shu ombordagi qoldiq mahsulot chegarasi bilan (min_stock yoki global sozlama, A-15).
      cte: Prisma.sql`WITH r AS (
        SELECT ws.warehouse_id::text || ws.product_id::text AS _k, w.name AS warehouse, p.name AS product,
               g.name AS "group", ws.quantity AS stock,
               round(ws.quantity * p.cost_price, 2) AS "stockValue",
               round(ws.quantity * coalesce(p.sale_price, p.wholesale_price), 2) AS "saleValue",
               CASE WHEN ws.quantity <= 0 THEN 'outOfStock'
                    WHEN ws.quantity <= coalesce(p.min_stock, ${THRESHOLD}) THEN 'lowStock'
                    ELSE 'inStock' END AS status
          FROM warehouse_stock ws JOIN warehouses w ON w.id = ws.warehouse_id
          JOIN products p ON p.id = ws.product_id JOIN product_groups g ON g.id = p.group_id
         WHERE ${Prisma.join(c, ' AND ')})`,
      where: q.status ? Prisma.sql`WHERE r.status = ${q.status}` : undefined,
      summary: {
        count: Prisma.sql`count(*)`,
        quantity: coalesceSum(Prisma.sql`stock`),
        stockValue: coalesceSum(Prisma.sql`"stockValue"`),
      },
    };
  },

  incoming: (q) => {
    const c: Prisma.Sql[] = [
      Prisma.sql`i.incoming_date >= ${q.dateFrom!}::date`,
      Prisma.sql`i.incoming_date <= ${q.dateTo!}::date`,
    ];
    if (q.warehouseId) c.push(Prisma.sql`i.warehouse_id = ${q.warehouseId}::uuid`);
    if (q.userId) c.push(Prisma.sql`i.created_by = ${q.userId}::uuid`);
    if (q.status) c.push(Prisma.sql`i.status = ${q.status}::incoming_status`);
    if (q.productId) {
      c.push(
        Prisma.sql`EXISTS (SELECT 1 FROM incoming_items fi WHERE fi.incoming_id = i.id AND fi.product_id = ${q.productId}::uuid)`,
      );
    }
    return {
      cte: Prisma.sql`WITH r AS (
        SELECT i.id::text AS _k, to_char(i.incoming_date, 'YYYY-MM-DD') AS date,
               'K-' || lpad(i.number::text, 6, '0') AS number, w.name AS warehouse,
               (SELECT count(*) FROM incoming_items ii WHERE ii.incoming_id = i.id) AS "itemsCount",
               i.total_quantity AS quantity, i.total_amount AS amount, i.status::text AS status
          FROM incoming i JOIN warehouses w ON w.id = i.warehouse_id
         WHERE ${Prisma.join(c, ' AND ')})`,
      // Kirim jami (miqdor, summa) — faqat tasdiqlangan hujjatlar (BUSINESS-RULES §4).
      summary: {
        count: Prisma.sql`count(*)`,
        quantity: Prisma.sql`coalesce(sum(quantity) FILTER (WHERE status = 'CONFIRMED'), 0)`,
        amount: Prisma.sql`coalesce(sum(amount) FILTER (WHERE status = 'CONFIRMED'), 0)`,
      },
    };
  },

  expenses: (q) => {
    const c: Prisma.Sql[] = [
      Prisma.sql`e.deleted_at IS NULL`,
      Prisma.sql`e.expense_date >= ${q.dateFrom!}::date`,
      Prisma.sql`e.expense_date <= ${q.dateTo!}::date`,
    ];
    if (q.categoryId) c.push(Prisma.sql`e.category_id = ${q.categoryId}::uuid`);
    if (q.userId) c.push(Prisma.sql`e.created_by = ${q.userId}::uuid`);
    return {
      cte: Prisma.sql`WITH r AS (
        SELECT e.id::text AS _k, to_char(e.expense_date, 'YYYY-MM-DD') AS date, c.name AS category,
               e.note, e.amount
          FROM expenses e JOIN expense_categories c ON c.id = e.category_id
         WHERE ${Prisma.join(c, ' AND ')})`,
      summary: { count: Prisma.sql`count(*)`, expenses: coalesceSum(Prisma.sql`amount`) },
    };
  },

  userSales: (q) => ({
    cte: Prisma.sql`WITH f AS (
        SELECT s.* FROM sales s WHERE ${salesWhere(q)}
      ), r AS (
        SELECT u.id::text AS _k, coalesce(u.full_name, u.login) AS seller,
               count(f.id) AS "salesCount", coalesce(sum(f.total_quantity), 0) AS quantity,
               coalesce(sum(f.total_amount), 0) AS revenue,
               CASE WHEN count(f.id) = 0 THEN 0 ELSE round(sum(f.total_amount) / count(f.id), 2) END
                 AS "averageCheck",
               coalesce(sum(f.total_amount - f.total_cost), 0) AS profit
          FROM users u LEFT JOIN f ON f.user_id = u.id
         WHERE ${q.userId ? Prisma.sql`u.id = ${q.userId}::uuid` : Prisma.sql`TRUE`}
         GROUP BY u.id
        HAVING count(f.id) > 0 OR ${Boolean(q.userId)})`,
    summary: {
      count: coalesceSum(Prisma.sql`"salesCount"`),
      revenue: coalesceSum(Prisma.sql`revenue`),
      profit: coalesceSum(Prisma.sql`profit`),
    },
  }),

  productSales: (q) => {
    const c: Prisma.Sql[] = [salesWhere(q, { productLines: true })];
    if (q.productId) c.push(Prisma.sql`si.product_id = ${q.productId}::uuid`);
    if (q.groupId) c.push(Prisma.sql`p.group_id = ${q.groupId}::uuid`);
    return {
      cte: Prisma.sql`WITH r AS (
        SELECT p.id::text AS _k, p.name AS product, g.name AS "group",
               sum(si.quantity) AS quantity, sum(si.line_total) AS revenue, sum(si.line_cost) AS cost,
               sum(si.line_total) - sum(si.line_cost) AS profit
          FROM sale_items si JOIN sales s ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id JOIN product_groups g ON g.id = p.group_id
         WHERE ${Prisma.join(c, ' AND ')}
         GROUP BY p.id, p.name, g.name)`,
      summary: {
        count: Prisma.sql`count(*)`,
        revenue: coalesceSum(Prisma.sql`revenue`),
        profit: coalesceSum(Prisma.sql`profit`),
      },
    };
  },

  customerPurchases: (q) => {
    const c: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (q.search) {
      const digits = q.search.replace(/\D/g, '');
      const pattern = `%${escapeLike(q.search)}%`;
      c.push(
        digits.length >= 3
          ? Prisma.sql`(c.name ILIKE ${pattern} ESCAPE '\\' OR c.phone LIKE ${`%${digits}%`})`
          : Prisma.sql`c.name ILIKE ${pattern} ESCAPE '\\'`,
      );
    }
    return {
      cte: Prisma.sql`WITH f AS (
          SELECT s.* FROM sales s WHERE ${salesWhere(q)}
        ), r AS (
          SELECT c.id::text AS _k, c.name AS customer, c.phone, count(*) AS purchases,
                 sum(f.total_amount) AS amount, round(sum(f.total_amount) / count(*), 2) AS "averageCheck",
                 max(f.sold_at) AS "lastPurchase"
            FROM f JOIN customers c ON c.id = f.customer_id
           WHERE ${Prisma.join(c, ' AND ')}
           GROUP BY c.id, c.name, c.phone)`,
      summary: { count: Prisma.sql`count(*)`, amount: coalesceSum(Prisma.sql`amount`) },
    };
  },
};

/** Ustun turi bo'yicha JSON qiymat: pul — 2, miqdor — 3 kasr (string), butun son — number. */
function cell(column: ReportColumn): Prisma.Sql {
  const ref = Prisma.raw(`r."${column.key}"`);
  switch (column.kind) {
    case 'money':
      return Prisma.sql`${ref}::numeric(20, 2)::text`;
    case 'quantity':
      return Prisma.sql`${ref}::numeric(20, 3)::text`;
    case 'integer':
      return Prisma.sql`${ref}::int`;
    case 'datetime':
      // CTE'da xom `timestamptz` (saralash indeks bilan, formatlash faqat sahifa qatorlariga).
      return iso(ref);
    default:
      return ref;
  }
}

function summaryValue(def: ReportSummaryDef, expr: Prisma.Sql): Prisma.Sql {
  switch (def.kind) {
    case 'money':
      return Prisma.sql`(${expr})::numeric(20, 2)::text`;
    case 'quantity':
      return Prisma.sql`(${expr})::numeric(20, 3)::text`;
    default:
      return Prisma.sql`(${expr})::bigint::text`;
  }
}

/**
 * Hisobotning SQL so'rovlari: sahifa, yig'ma (jami qatorlar soni bilan) va kategoriya guruhlari.
 * Repository va performance benchmark'i (`EXPLAIN ANALYZE`) aynan shu so'rovlarni ishlatadi.
 */
export function reportStatements(
  type: ReportType,
  q: ReportQuery,
  columns: readonly ReportColumn[],
  summaryDefs: readonly ReportSummaryDef[],
): { page: Prisma.Sql; summary: Prisma.Sql; groups: Prisma.Sql } {
  const sql = BUILDERS[type](q);
  const where = sql.where ?? Prisma.empty;
  const select = Prisma.join(
    columns.map((c) => Prisma.sql`${cell(c)} AS ${Prisma.raw(`"${c.key}"`)}`),
    ', ',
  );
  const direction = Prisma.raw(q.sort.direction === 'desc' ? 'DESC' : 'ASC');
  const sortKey = Prisma.raw(`r."${q.sort.field}"`);
  const summarySelect = Prisma.join(
    summaryDefs.map(
      (d) =>
        Prisma.sql`${summaryValue(d, sql.summary[d.labelKey]!)} AS ${Prisma.raw(`"${d.labelKey}"`)}`,
    ),
    ', ',
  );
  const skip = (q.page - 1) * q.pageSize;
  return {
    page: Prisma.sql`
      ${sql.cte}
      SELECT ${select} FROM r ${where}
       ORDER BY ${sortKey} ${direction} NULLS LAST, r._k ${direction}
       LIMIT ${q.pageSize} OFFSET ${skip}`,
    // Jami qatorlar soni — yig'ma bilan bitta skanda (sahifada `count(*) OVER ()` LIMIT'ni to'xtatib,
    // butun natijani formatlab saralashga majbur qilardi — 1 mln sotuvda REQ-167 dan oshardi).
    summary: Prisma.sql`${sql.cte} SELECT ${summarySelect}, count(*) AS _total FROM r ${where}`,
    groups: Prisma.sql`
      ${sql.cte}
      SELECT r.category AS label, count(*)::int AS count,
             sum(r.amount)::numeric(20, 2)::text AS amount
        FROM r GROUP BY r.category ORDER BY sum(r.amount) DESC, r.category`,
  };
}

/** Moliyaviy xulosa so'rovi (repository va benchmark uchun). */
export function financeStatement(q: {
  dateFrom: string;
  dateTo: string;
  warehouseId?: string;
}): Prisma.Sql {
  const { from, to } = tashkentDateRangeToUtc(q);
  const w = q.warehouseId ?? null;
  return Prisma.sql`
    WITH s AS (
      SELECT count(*)::int AS n, coalesce(sum(total_amount), 0) AS revenue,
             coalesce(sum(total_cost), 0) AS cost
        FROM sales
       WHERE sold_at >= ${from!} AND sold_at < ${to!}
         AND (${w}::uuid IS NULL OR warehouse_id = ${w}::uuid)
    ), e AS (
      SELECT coalesce(sum(amount), 0) AS amount FROM expenses
       WHERE deleted_at IS NULL AND expense_date >= ${q.dateFrom}::date
         AND expense_date <= ${q.dateTo}::date
    ), i AS (
      SELECT coalesce(sum(total_amount), 0) AS amount FROM incoming
       WHERE status = 'CONFIRMED' AND incoming_date >= ${q.dateFrom}::date
         AND incoming_date <= ${q.dateTo}::date
         AND (${w}::uuid IS NULL OR warehouse_id = ${w}::uuid)
    ), v AS (
      SELECT coalesce(sum(round(ws.quantity * p.cost_price, 2)), 0) AS amount
        FROM warehouse_stock ws JOIN products p ON p.id = ws.product_id
       WHERE ${w}::uuid IS NULL OR ws.warehouse_id = ${w}::uuid
    )
    SELECT s.n AS "salesCount", s.revenue::numeric(20, 2)::text AS revenue,
           s.cost::numeric(20, 2)::text AS "costOfGoodsSold",
           (s.revenue - s.cost)::numeric(20, 2)::text AS "grossProfit",
           e.amount::numeric(20, 2)::text AS expenses,
           (s.revenue - s.cost - e.amount)::numeric(20, 2)::text AS "netProfit",
           i.amount::numeric(20, 2)::text AS "incomingPurchases",
           v.amount::numeric(20, 2)::text AS "inventoryValueAtCost"
      FROM s, e, i, v`;
}

export interface FinanceRow {
  salesCount: number;
  revenue: string;
  costOfGoodsSold: string;
  grossProfit: string;
  expenses: string;
  netProfit: string;
  incomingPurchases: string;
  inventoryValueAtCost: string;
}

/**
 * Hisobotlar — faqat o'qish (ARCHITECTURE §4). Sahifa va yig'ma bitta REPEATABLE READ tranzaksiyada
 * o'qiladi — parallel sotuv ular orasida farq keltirmaydi.
 */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    type: ReportType,
    q: ReportQuery,
    columns: readonly ReportColumn[],
    summaryDefs: readonly ReportSummaryDef[],
    withGroups: boolean,
  ): Promise<{
    rows: Record<string, string | number | null>[];
    total: number;
    summary: Record<string, string>;
    groups?: ReportGroupItem[];
  }> {
    const sql = reportStatements(type, q, columns, summaryDefs);
    return this.prisma.$transaction(
      async (tx: Tx) => {
        const rows = await tx.$queryRaw<Record<string, string | number | null>[]>(sql.page);
        const [{ _total, ...summary }] = await tx.$queryRaw<
          [Record<string, string> & { _total: bigint }]
        >(sql.summary);
        const groups = withGroups ? await tx.$queryRaw<ReportGroupItem[]>(sql.groups) : undefined;
        return {
          rows,
          total: Number(_total),
          summary,
          ...(groups ? { groups } : {}),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * Moliyaviy xulosa (REQ-103, BUSINESS-RULES §4): har bir tushuncha alohida manbadan, bitta so'rovda
   * (bitta snapshot). Xarajatlar omborga bog'lanmagan — ombor filtrida service ularni chiqarmaydi (D-21).
   */
  async finance(q: {
    dateFrom: string;
    dateTo: string;
    warehouseId?: string;
  }): Promise<FinanceRow> {
    const [row] = await this.prisma.$queryRaw<FinanceRow[]>(financeStatement(q));
    return row!;
  }
}
