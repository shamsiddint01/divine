import { Injectable } from '@nestjs/common';
import type { ProductUnit, SortSpec, StockRowDto, WarehouseStatus } from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { toPrismaPagination, toSqlOrderBy } from '../../common/query/prisma-query.js';
import { escapeLike } from '../product-groups/product-groups.repository.js';

export type WarehouseSortField = 'name' | 'createdAt';
export type StockSortField = 'productName' | 'quantity' | 'stockValue' | 'updatedAt';

export interface ListWarehousesQuery {
  page: number;
  pageSize: number;
  sort: SortSpec<WarehouseSortField>;
  search?: string;
  status?: WarehouseStatus;
}

export interface StockQuery {
  page: number;
  pageSize: number;
  sort: SortSpec<StockSortField>;
  search?: string;
  groupId?: string;
  stock?: 'low' | 'out';
}

export interface StockSummaryRow {
  positions: number;
  lowStockCount: number;
  quantities: { unit: ProductUnit; quantity: string }[];
  stockValue: string;
}

export interface WarehouseRow {
  id: string;
  name: string;
  address: string | null;
  status: WarehouseStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Ichki ko'rsatkichlar: `stockValue` doim bor — javobga faqat serializer (ruxsatga qarab) chiqaradi. */
export interface WarehouseStatsRow extends WarehouseRow {
  productCount: number;
  totalQuantity: string;
  stockValue: string;
  lowStockCount: number;
}

/** Ichki qator: `costPrice`/`stockValue` doim bor — javobga faqat serializer chiqaradi. */
export type StockRow = Omit<StockRowDto, 'costPrice' | 'stockValue' | 'updatedAt'> & {
  costPrice: string;
  stockValue: string;
  updatedAt: Date;
};

const BASE = Prisma.sql`w.id, w.name, w.address, w.status::text AS status,
  w.created_at AS "createdAt", w.updated_at AS "updatedAt"`;

/** Global kam qoldiq chegarasi (mahsulotda `min_stock` bo'lmasa, BUSINESS-RULES §4). */
const THRESHOLD = Prisma.sql`th AS (
  SELECT coalesce((SELECT (value #>> '{}')::numeric FROM settings
                    WHERE key = 'low_stock_default_threshold'), 0) AS v
)`;

/** Ombor ko'rsatkichlari `warehouse_stock`dan (joriy qoldiq — yagona manba, REQ-031). */
const STATS = Prisma.sql`agg AS (
  SELECT ws.warehouse_id,
         count(*) FILTER (WHERE ws.quantity > 0)::int AS "productCount",
         sum(ws.quantity) AS qty,
         sum(round(ws.quantity * p.cost_price, 2)) AS value,
         count(*) FILTER (WHERE p.status = 'ACTIVE' AND ws.quantity <= coalesce(p.min_stock, th.v))::int AS low
    FROM warehouse_stock ws JOIN products p ON p.id = ws.product_id CROSS JOIN th
   GROUP BY ws.warehouse_id
)`;

const STATS_COLUMNS = Prisma.sql`coalesce(agg."productCount", 0) AS "productCount",
  coalesce(agg.qty, 0)::numeric(14, 3)::text AS "totalQuantity",
  coalesce(agg.value, 0)::numeric(18, 2)::text AS "stockValue",
  coalesce(agg.low, 0) AS "lowStockCount"`;

const STOCK_SORT: Readonly<Record<StockSortField, Prisma.Sql>> = {
  productName: Prisma.sql`lower(p.name)`,
  quantity: Prisma.sql`ws.quantity`,
  stockValue: Prisma.sql`round(ws.quantity * p.cost_price, 2)`,
  updatedAt: Prisma.sql`ws.updated_at`,
};

/** Omborlar — data access (ARCHITECTURE §4). Jadval va constraint'lar Phase 2'dan. */
@Injectable()
export class WarehousesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ro'yxat. `scope` — userning omborlari (`undefined` — hammasi); `withStats` — ko'rsatkichlar
   * (faqat `warehouses.read_all`).
   */
  async list(
    query: ListWarehousesQuery,
    options: { scope?: string[]; withStats: boolean },
  ): Promise<{ rows: (WarehouseRow | WarehouseStatsRow)[]; total: number }> {
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (options.scope) conditions.push(Prisma.sql`w.id = ANY(${options.scope}::uuid[])`);
    if (query.status) conditions.push(Prisma.sql`w.status = ${query.status}::warehouse_status`);
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      conditions.push(
        Prisma.sql`(w.name ILIKE ${pattern} ESCAPE '\\' OR w.address ILIKE ${pattern} ESCAPE '\\')`,
      );
    }
    const orderBy = toSqlOrderBy(
      query.sort,
      { name: Prisma.sql`lower(w.name)`, createdAt: Prisma.sql`w.created_at` },
      Prisma.sql`w.id`,
    );
    const { skip, take } = toPrismaPagination(query);
    const where = Prisma.join(conditions, ' AND ');
    const rows = options.withStats
      ? await this.prisma.$queryRaw<(WarehouseStatsRow & { total: bigint })[]>`
          WITH ${THRESHOLD}, ${STATS}
          SELECT ${BASE}, ${STATS_COLUMNS}, count(*) OVER () AS total
            FROM warehouses w LEFT JOIN agg ON agg.warehouse_id = w.id
           WHERE ${where} ${orderBy} LIMIT ${take} OFFSET ${skip}`
      : await this.prisma.$queryRaw<(WarehouseRow & { total: bigint })[]>`
          SELECT ${BASE}, count(*) OVER () AS total
            FROM warehouses w WHERE ${where} ${orderBy} LIMIT ${take} OFFSET ${skip}`;
    return {
      rows: rows.map(({ total: _total, ...row }) => row),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  }

  async find(id: string, client: Tx | PrismaService = this.prisma): Promise<WarehouseRow | null> {
    const rows = await client.$queryRaw<WarehouseRow[]>`
      SELECT ${BASE} FROM warehouses w WHERE w.id = ${id}::uuid`;
    return rows[0] ?? null;
  }

  async findWithStats(id: string): Promise<WarehouseStatsRow | null> {
    const rows = await this.prisma.$queryRaw<WarehouseStatsRow[]>`
      WITH ${THRESHOLD}, ${STATS}
      SELECT ${BASE}, ${STATS_COLUMNS}
        FROM warehouses w LEFT JOIN agg ON agg.warehouse_id = w.id
       WHERE w.id = ${id}::uuid`;
    return rows[0] ?? null;
  }

  /** `since`dan beri kirim (+) va sotuv (−, musbat ko'rinishda) miqdorlari — ledger'dan. */
  async flowSince(id: string, since: Date): Promise<{ incoming: string; outgoing: string }> {
    const [row] = await this.prisma.$queryRaw<{ incoming: string; outgoing: string }[]>`
      SELECT coalesce(sum(quantity) FILTER (WHERE movement_type = 'INCOMING'), 0)::numeric(14, 3)::text AS incoming,
             coalesce(-sum(quantity) FILTER (WHERE movement_type = 'SALE'), 0)::numeric(14, 3)::text AS outgoing
        FROM inventory_movements
       WHERE warehouse_id = ${id}::uuid AND created_at >= ${since}`;
    return row ?? { incoming: '0.000', outgoing: '0.000' };
  }

  /** `FOR UPDATE`: davom etayotgan kirim/sotuv (`FOR SHARE`) tugashini kutadi (BR-21). */
  async lock(tx: Tx, id: string): Promise<WarehouseRow | null> {
    const rows = await tx.$queryRaw<WarehouseRow[]>`
      SELECT ${BASE} FROM warehouses w WHERE w.id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  async nameTaken(tx: Tx, name: string, exceptId?: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM warehouses
       WHERE lower(name) = lower(${name}) AND (${exceptId ?? null}::uuid IS NULL OR id <> ${exceptId ?? null}::uuid)`;
    return rows.length > 0;
  }

  async create(
    tx: Tx,
    data: { name: string; address: string | null; createdById: string },
  ): Promise<string> {
    return (await tx.warehouse.create({ data, select: { id: true } })).id;
  }

  async update(
    tx: Tx,
    id: string,
    data: { name?: string; address?: string | null; status?: WarehouseStatus },
  ): Promise<void> {
    await tx.warehouse.update({ where: { id }, data, select: { id: true } });
  }

  /** Audit metadata uchun: biriktirilgan userlar va qoldig'i bor mahsulotlar soni. */
  async usage(tx: Tx, id: string): Promise<{ assignedUsers: number; productsInStock: number }> {
    const [row] = await tx.$queryRaw<{ assignedUsers: number; productsInStock: number }[]>`
      SELECT (SELECT count(*)::int FROM user_warehouses WHERE warehouse_id = ${id}::uuid) AS "assignedUsers",
             (SELECT count(*)::int FROM warehouse_stock
               WHERE warehouse_id = ${id}::uuid AND quantity > 0) AS "productsInStock"`;
    return row ?? { assignedUsers: 0, productsInStock: 0 };
  }

  private stockConditions(id: string, query: StockQuery): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [Prisma.sql`ws.warehouse_id = ${id}::uuid`];
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      conditions.push(
        Prisma.sql`(p.name ILIKE ${pattern} ESCAPE '\\' OR p.barcode = ${query.search})`,
      );
    }
    if (query.groupId) conditions.push(Prisma.sql`p.group_id = ${query.groupId}::uuid`);
    if (query.stock === 'low') {
      conditions.push(
        Prisma.sql`p.status = 'ACTIVE' AND ws.quantity <= coalesce(p.min_stock, th.v)`,
      );
    }
    if (query.stock === 'out') conditions.push(Prisma.sql`ws.quantity <= 0`);
    return conditions;
  }

  /** Qoldiq ro'yxatidagi bir xil filtrlar bo'yicha umumiy hisob (barcha sahifalar). */
  async stockSummary(id: string, query: StockQuery): Promise<StockSummaryRow> {
    const where = Prisma.join(this.stockConditions(id, query), ' AND ');
    const rows = await this.prisma.$queryRaw<
      { unit: string; positions: number; qty: string; value: string; low: number }[]
    >`
      WITH ${THRESHOLD}
      SELECT p.unit::text AS unit, count(*)::int AS positions,
             coalesce(sum(ws.quantity), 0)::numeric(14, 3)::text AS qty,
             coalesce(sum(round(ws.quantity * p.cost_price, 2)), 0)::numeric(18, 2)::text AS value,
             (count(*) FILTER (WHERE p.status = 'ACTIVE' AND ws.quantity <= coalesce(p.min_stock, th.v)))::int AS low
        FROM warehouse_stock ws
        JOIN products p ON p.id = ws.product_id
        CROSS JOIN th
       WHERE ${where}
       GROUP BY p.unit
       ORDER BY p.unit`;
    const value = rows.reduce((sum, row) => sum + Number(row.value) * 100, 0);
    return {
      positions: rows.reduce((sum, row) => sum + row.positions, 0),
      lowStockCount: rows.reduce((sum, row) => sum + row.low, 0),
      quantities: rows.map((row) => ({ unit: row.unit as ProductUnit, quantity: row.qty })),
      stockValue: (Math.round(value) / 100).toFixed(2),
    };
  }

  async stock(id: string, query: StockQuery): Promise<{ rows: StockRow[]; total: number }> {
    const conditions = this.stockConditions(id, query);
    const orderBy = toSqlOrderBy(query.sort, STOCK_SORT, Prisma.sql`p.id`);
    const { skip, take } = toPrismaPagination(query);
    const rows = await this.prisma.$queryRaw<(StockRow & { total: bigint })[]>`
      WITH ${THRESHOLD}
      SELECT p.id AS "productId", p.name AS "productName", g.name AS "groupName", p.barcode,
             p.unit::text AS unit, ws.quantity::text AS quantity,
             coalesce(p.min_stock, th.v)::numeric(14, 3)::text AS "minStock",
             p.cost_price::text AS "costPrice", p.sale_price::text AS "salePrice",
             round(ws.quantity * p.cost_price, 2)::numeric(18, 2)::text AS "stockValue",
             (p.status = 'ACTIVE' AND ws.quantity <= coalesce(p.min_stock, th.v)) AS "isLowStock",
             ws.updated_at AS "updatedAt", count(*) OVER () AS total
        FROM warehouse_stock ws
        JOIN products p ON p.id = ws.product_id
        JOIN product_groups g ON g.id = p.group_id
        CROSS JOIN th
       WHERE ${Prisma.join(conditions, ' AND ')}
       ${orderBy} LIMIT ${take} OFFSET ${skip}`;
    return {
      rows: rows.map(({ total: _total, ...row }) => ({ ...row, unit: row.unit as ProductUnit })),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  }
}
