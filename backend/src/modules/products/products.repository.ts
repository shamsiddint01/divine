import { Injectable } from '@nestjs/common';
import type {
  ProductDto,
  ProductSaleRow,
  ProductStatus,
  ProductUnit,
  SortSpec,
} from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { toPrismaPagination, toSqlOrderBy } from '../../common/query/prisma-query.js';
import { escapeLike } from '../product-groups/product-groups.repository.js';

export type ProductSortField =
  'name' | 'group' | 'stock' | 'received' | 'sold' | 'costPrice' | 'salePrice' | 'createdAt';

/**
 * Ro'yxat/qidiruv filtrlari (service tayyorlaydi — ruxsatlar allaqachon qo'llangan).
 * `scope` — userning ombor doirasi (`undefined` — barcha omborlar); `warehouseId` — tanlangan ombor.
 */
export interface ProductFilter {
  ids?: string[];
  search?: string;
  barcode?: string;
  groupId?: string;
  status?: ProductStatus;
  stock?: 'low' | 'out';
  warehouseId?: string;
  /** Ro'yxat: faqat `warehouseId` omborida qoldiq qatori bor mahsulotlar (lookup'da — yo'q). */
  onlyInWarehouse?: boolean;
  scope?: string[];
}

export interface ListProductsQuery extends Omit<
  ProductFilter,
  'ids' | 'barcode' | 'scope' | 'onlyInWarehouse'
> {
  page: number;
  pageSize: number;
  sort: SortSpec<ProductSortField>;
}

/** Ichki qator: `costPrice` doim bor — javobga faqat serializer (ruxsatga qarab) chiqaradi. */
export interface ProductRow {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  barcode: string | null;
  salePrice: string;
  wholesalePrice: string | null;
  costPrice: string;
  unit: ProductUnit;
  allowDecimal: boolean;
  minStock: string | null;
  status: ProductStatus;
  stock: string;
  received: string;
  sold: string;
  isLowStock: boolean;
  warehouses: ProductDto['warehouses'];
  createdAt: Date;
  updatedAt: Date;
}

type RawRow = Omit<ProductRow, 'warehouses'> & { total: bigint };

/** Raqamli ustunlar — matn ko'rinishida (pul/miqdor hech qachon float bo'lmaydi, BR-35). */
/** Yig'ma ustunlar bo'yicha saralash — butun doira bo'yicha hisob kerak. */
const AGGREGATE_SORTS: ReadonlySet<ProductSortField> = new Set(['stock', 'received', 'sold']);

const SORT_COLUMNS: Readonly<Record<ProductSortField, Prisma.Sql>> = {
  name: Prisma.sql`lower(p.name)`,
  group: Prisma.sql`lower(g.name)`,
  stock: Prisma.sql`coalesce(st.qty, 0)`,
  received: Prisma.sql`coalesce(rc.qty, 0)`,
  sold: Prisma.sql`coalesce(sd.qty, 0)`,
  costPrice: Prisma.sql`p.cost_price`,
  salePrice: Prisma.sql`p.sale_price`,
  createdAt: Prisma.sql`p.created_at`,
};

/**
 * Mahsulotlar — data access. Qoldiq `warehouse_stock`dan, kirim — tasdiqlangan `incoming_items`dan,
 * sotilgan — `sale_items`dan, hammasi userning ombor doirasida (OWN-03). Kam qoldiq: faol mahsulot va
 * qoldiq ≤ `min_stock` (yo'q bo'lsa — `settings.low_stock_default_threshold`, BUSINESS-RULES §4).
 */
@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListProductsQuery, scope: string[] | undefined) {
    const { skip, take } = toPrismaPagination(query);
    const order = toSqlOrderBy(query.sort, SORT_COLUMNS, Prisma.sql`p.id`);
    return this.select(
      { ...query, scope, onlyInWarehouse: Boolean(query.warehouseId) },
      order,
      Prisma.sql`LIMIT ${take} OFFSET ${skip}`,
      this.prisma,
      AGGREGATE_SORTS.has(query.sort.field),
    );
  }

  async findOne(filter: ProductFilter, client: Tx | PrismaService = this.prisma) {
    const { rows } = await this.select(
      filter,
      Prisma.sql`ORDER BY p.id`,
      Prisma.sql`LIMIT 1`,
      client,
    );
    return rows[0] ?? null;
  }

  private async select(
    filter: ProductFilter,
    orderBy: Prisma.Sql,
    limit: Prisma.Sql,
    client: Tx | PrismaService = this.prisma,
    aggregateOrder = false,
  ): Promise<{ rows: ProductRow[]; total: number }> {
    // Miqdorlar hisoblanadigan omborlar: tanlangan ombor, aks holda userning doirasi.
    const amountScope = filter.warehouseId ? [filter.warehouseId] : filter.scope;
    const inScope = (column: Prisma.Sql) =>
      amountScope ? Prisma.sql`AND ${column} = ANY(${amountScope}::uuid[])` : Prisma.empty;

    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filter.ids) conditions.push(Prisma.sql`p.id = ANY(${filter.ids}::uuid[])`);
    if (filter.barcode !== undefined) conditions.push(Prisma.sql`p.barcode = ${filter.barcode}`);
    if (filter.search) {
      // Nom bo'yicha qisman (trgm index) yoki shtrix-kod bo'yicha aniq (REQ-054).
      const pattern = `%${escapeLike(filter.search)}%`;
      conditions.push(
        Prisma.sql`(p.name ILIKE ${pattern} ESCAPE '\\' OR p.barcode = ${filter.search})`,
      );
    }
    if (filter.groupId) conditions.push(Prisma.sql`p.group_id = ${filter.groupId}::uuid`);
    if (filter.status) conditions.push(Prisma.sql`p.status = ${filter.status}::product_status`);
    if (filter.warehouseId && filter.onlyInWarehouse) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM warehouse_stock w
        WHERE w.product_id = p.id AND w.warehouse_id = ${filter.warehouseId}::uuid)`);
    }
    if (filter.stock === 'low') {
      conditions.push(
        Prisma.sql`p.status = 'ACTIVE' AND coalesce(st.qty, 0) <= coalesce(p.min_stock, th.v)`,
      );
    }
    if (filter.stock === 'out') conditions.push(Prisma.sql`coalesce(st.qty, 0) <= 0`);

    // Saralash yoki filtr yig'malarga (qoldiq, kirim, sotilgan) bog'liq bo'lmasa — avval sahifadagi
    // mahsulotlar tanlanadi, yig'malar faqat ular uchun hisoblanadi. Aks holda doiradagi barcha
    // sotuv qatorlari har so'rovda yig'ilardi (1 mln sotuvda ~1,5 s, Phase 15 yuklama testi).
    const pageFirst = !aggregateOrder && !filter.stock;
    // ANY(ARRAY(...)) — (product_id, ...) index bo'yicha qidiruv; IN (SELECT ...) esa sale_items'ni
    // to'liq skanerlab hash semi-join qiladi (1 mln sotuvda ~200 ms o'rniga ~35 ms).
    const onPage = (column: Prisma.Sql) =>
      pageFirst ? Prisma.sql`AND ${column} = ANY(ARRAY(SELECT id FROM pg))` : Prisma.empty;
    const pageCte = pageFirst
      ? Prisma.sql`pg AS (
          SELECT p.id, count(*) OVER () AS total
            FROM products p JOIN product_groups g ON g.id = p.group_id
           WHERE ${Prisma.join(conditions, ' AND ')}
           ${orderBy} ${limit}
        ),`
      : Prisma.empty;

    const raw = await client.$queryRaw<RawRow[]>`
      WITH ${pageCte} st AS (
        SELECT ws.product_id, sum(ws.quantity) AS qty FROM warehouse_stock ws
         WHERE TRUE ${inScope(Prisma.sql`ws.warehouse_id`)} ${onPage(Prisma.sql`ws.product_id`)}
         GROUP BY ws.product_id
      ), rc AS (
        SELECT ii.product_id, sum(ii.quantity) AS qty
          FROM incoming_items ii JOIN incoming i ON i.id = ii.incoming_id
         WHERE i.status = 'CONFIRMED' ${inScope(Prisma.sql`i.warehouse_id`)}
               ${onPage(Prisma.sql`ii.product_id`)}
         GROUP BY ii.product_id
      ), sd AS (
        -- Sotilgan miqdor — ledger SALE harakatlarining yig'masidan (warehouse_sales_totals, trigger bilan
        -- yangilanadi; Phase 17): sotuv qatorlari skanerlanmaydi (tarixli omborda kassa saralashi ~1,5 s edi).
        SELECT t.product_id, sum(t.quantity) AS qty FROM warehouse_sales_totals t
         WHERE TRUE ${inScope(Prisma.sql`t.warehouse_id`)} ${onPage(Prisma.sql`t.product_id`)}
         GROUP BY t.product_id
      ), th AS (
        SELECT coalesce((SELECT (value #>> '{}')::numeric FROM settings
                          WHERE key = 'low_stock_default_threshold'), 0) AS v
      )
      SELECT p.id, p.name, p.group_id AS "groupId", g.name AS "groupName", p.barcode,
             p.sale_price::text AS "salePrice", p.wholesale_price::text AS "wholesalePrice",
             p.cost_price::text AS "costPrice",
             p.unit::text AS unit, p.allow_decimal AS "allowDecimal", p.min_stock::text AS "minStock",
             p.status::text AS status,
             coalesce(st.qty, 0)::numeric(14, 3)::text AS stock,
             coalesce(rc.qty, 0)::numeric(14, 3)::text AS received,
             coalesce(sd.qty, 0)::numeric(14, 3)::text AS sold,
             (p.status = 'ACTIVE' AND coalesce(st.qty, 0) <= coalesce(p.min_stock, th.v)) AS "isLowStock",
             p.created_at AS "createdAt", p.updated_at AS "updatedAt",
             ${pageFirst ? Prisma.sql`pg.total` : Prisma.sql`count(*) OVER ()`} AS total
        FROM ${pageFirst ? Prisma.sql`pg JOIN products p ON p.id = pg.id` : Prisma.sql`products p`}
        JOIN product_groups g ON g.id = p.group_id
        LEFT JOIN st ON st.product_id = p.id
        LEFT JOIN rc ON rc.product_id = p.id
        LEFT JOIN sd ON sd.product_id = p.id
        CROSS JOIN th
       ${pageFirst ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`}
       ${orderBy} ${pageFirst ? Prisma.empty : limit}`;

    const byProduct = await this.warehouseBreakdown(
      raw.map((row) => row.id),
      filter.scope,
      client,
    );
    const rows = raw.map(({ total: _total, ...row }) => ({
      ...row,
      warehouses: byProduct.get(row.id) ?? [],
    }));
    return { rows, total: raw[0] ? Number(raw[0].total) : 0 };
  }

  /** Har bir mahsulot bo'yicha omborlardagi qoldiq (userning doirasida, nom bo'yicha). */
  private async warehouseBreakdown(
    ids: string[],
    scope: string[] | undefined,
    client: Tx | PrismaService,
  ): Promise<Map<string, ProductDto['warehouses']>> {
    const map = new Map<string, ProductDto['warehouses']>();
    if (ids.length === 0) return map;
    const rows = await client.$queryRaw<
      { productId: string; warehouseId: string; warehouseName: string; quantity: string }[]
    >`
      SELECT ws.product_id AS "productId", ws.warehouse_id AS "warehouseId",
             w.name AS "warehouseName", ws.quantity::text AS quantity
        FROM warehouse_stock ws JOIN warehouses w ON w.id = ws.warehouse_id
       WHERE ws.product_id = ANY(${ids}::uuid[])
         ${scope ? Prisma.sql`AND ws.warehouse_id = ANY(${scope}::uuid[])` : Prisma.empty}
       ORDER BY lower(w.name), w.id`;
    for (const { productId, ...stock } of rows) {
      map.set(productId, [...(map.get(productId) ?? []), stock]);
    }
    return map;
  }

  /** Mahsulot bo'yicha sotuvlar yig'indisi va oxirgi sotuvlar (snapshot narxlari — D-02). */
  async salesSummary(
    productId: string,
  ): Promise<{ revenue: string; cost: string; profit: string; recent: ProductSaleRow[] }> {
    const [totals] = await this.prisma.$queryRaw<
      { revenue: string; cost: string; profit: string }[]
    >`
      SELECT coalesce(sum(line_total), 0)::numeric(18, 2)::text AS revenue,
             coalesce(sum(line_cost), 0)::numeric(18, 2)::text AS cost,
             coalesce(sum(line_total - line_cost), 0)::numeric(18, 2)::text AS profit
        FROM sale_items WHERE product_id = ${productId}::uuid`;
    const recent = await this.prisma.$queryRaw<
      (Omit<ProductSaleRow, 'soldAt'> & { soldAt: Date })[]
    >`
      SELECT s.id AS "saleId", 'S-' || lpad(s.number::text, 6, '0') AS "saleNumber", s.sold_at AS "soldAt",
             s.customer_name_snapshot AS "customerName", w.name AS "warehouseName",
             si.quantity::text AS quantity, si.unit_price::text AS "unitPrice",
             si.line_total::text AS "lineTotal"
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN warehouses w ON w.id = s.warehouse_id
       WHERE si.product_id = ${productId}::uuid
       ORDER BY s.sold_at DESC, s.number DESC
       LIMIT 8`;
    return {
      revenue: totals?.revenue ?? '0.00',
      cost: totals?.cost ?? '0.00',
      profit: totals?.profit ?? '0.00',
      recent: recent.map((row) => ({ ...row, soldAt: row.soldAt.toISOString() })),
    };
  }

  async lock(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<
      {
        id: string;
        name: string;
        groupId: string;
        barcode: string | null;
        costPrice: string;
        salePrice: string;
        wholesalePrice: string | null;
        unit: ProductUnit;
        allowDecimal: boolean;
        minStock: string | null;
        status: ProductStatus;
      }[]
    >`
      SELECT id, name, group_id AS "groupId", barcode, cost_price::text AS "costPrice",
             sale_price::text AS "salePrice", wholesale_price::text AS "wholesalePrice",
             unit::text AS unit, allow_decimal AS "allowDecimal",
             min_stock::text AS "minStock", status::text AS status
        FROM products WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  async group(tx: Tx, id: string): Promise<{ id: string; isActive: boolean } | null> {
    return tx.productGroup.findUnique({ where: { id }, select: { id: true, isActive: true } });
  }

  async barcodeOwner(tx: Tx, barcode: string): Promise<string | null> {
    const row = await tx.product.findUnique({ where: { barcode }, select: { id: true } });
    return row?.id ?? null;
  }

  async create(tx: Tx, data: Prisma.ProductUncheckedCreateInput): Promise<string> {
    return (await tx.product.create({ data, select: { id: true } })).id;
  }

  async update(tx: Tx, id: string, data: Prisma.ProductUncheckedUpdateInput): Promise<void> {
    await tx.product.update({ where: { id }, data, select: { id: true } });
  }
}
