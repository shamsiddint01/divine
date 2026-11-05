import { Injectable } from '@nestjs/common';
import {
  type ProductStatus,
  type ProductUnit,
  type SaleDto,
  type SaleItemDto,
  type SortSpec,
  WALK_IN_CUSTOMER_NAME,
} from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { toPrismaPagination, toSqlOrderBy } from '../../common/query/prisma-query.js';
import { tashkentDateRangeToUtc } from '../../common/time/tashkent-time.js';
import { escapeLike } from '../product-groups/product-groups.repository.js';

/** Umumiy (ismsiz) mijozni yaratishni ketma-ketlashtirish (`lockWalkInCustomer`). */
const WALK_IN_LOCK_KEY = 'divine.uz:walk-in-customer';

export type SaleSortField = 'soldAt' | 'totalAmount' | 'number';

/** O'qish filtri (service tayyorlaydi — ownership allaqachon qo'llangan, OWN-04). */
export interface SaleFilter {
  userId?: string;
  warehouseId?: string;
  customerId?: string;
  productId?: string;
  /** Sotuv raqami (`S-000123` / `123`) yoki mijoz ismi (snapshot). */
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface SalePage {
  page: number;
  pageSize: number;
  sort: SortSpec<SaleSortField>;
}

/** Ichki ko'rinish: tannarx maydonlari doim bor — javobga faqat serializer (ruxsatga qarab) chiqaradi. */
export type SaleRow = Omit<SaleDto, 'soldAt' | 'items' | 'totalCost' | 'grossProfit'> & {
  soldAt: Date;
  totalCost: string;
  grossProfit: string;
  /** Ro'yxatda yo'q (API §11), detal va mijoz xarid tarixida bor. */
  items?: Required<SaleItemDto>[];
};

export interface ProductForSale {
  id: string;
  name: string;
  barcode: string | null;
  unit: ProductUnit;
  status: ProductStatus;
  allowDecimal: boolean;
  salePrice: string | null;
  wholesalePrice: string | null;
  costPrice: string;
}

/** Birlashtirilgan sotuv qatori (bitta mahsulot — bitta qator, BR-19). */
export interface SaleLine {
  productId: string;
  quantity: string;
}

type RawSale = Omit<SaleRow, 'items' | 'user' | 'warehouse' | 'customer' | 'status'> & {
  userId: string;
  userLogin: string;
  userFullName: string | null;
  warehouseId: string;
  warehouseName: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
};

/** Qator narxi (D-25): narx turi bo'yicha kartochkadan; yo'q narx sotuvdan oldin rad etiladi. */
const unitPriceSql = (priceType: SalePriceType) =>
  priceType === 'WHOLESALE' ? Prisma.sql`p.wholesale_price` : Prisma.sql`p.sale_price`;

const SELECT = Prisma.sql`
  SELECT s.id, 'S-' || lpad(s.number::text, 6, '0') AS number, s.sold_at AS "soldAt",
         u.id AS "userId", u.login AS "userLogin", u.full_name AS "userFullName",
         w.id AS "warehouseId", w.name AS "warehouseName",
         s.customer_id AS "customerId", s.customer_name_snapshot AS "customerName",
         s.customer_phone_snapshot AS "customerPhone",
         (SELECT count(*)::int FROM sale_items i WHERE i.sale_id = s.id) AS "itemsCount",
         s.total_quantity::text AS "totalQuantity", s.total_amount::text AS "totalAmount",
         s.total_cost::text AS "totalCost", (s.total_amount - s.total_cost)::text AS "grossProfit",
         s.price_type::text AS "priceType"`;

const FROM = Prisma.sql`
  FROM sales s
  JOIN users u ON u.id = s.user_id
  JOIN warehouses w ON w.id = s.warehouse_id`;

const SORT_COLUMNS: Readonly<Record<SaleSortField, Prisma.Sql>> = {
  soldAt: Prisma.sql`s.sold_at`,
  totalAmount: Prisma.sql`s.total_amount`,
  number: Prisma.sql`s.number`,
};

/**
 * Sotuvlar — data access (DATABASE §4.12–4.13, §5.3). `sales` va `sale_items` o'zgarmaydi (trigger):
 * yozish — faqat INSERT; totallar INSERT paytidayoq DB yaxlitlashi bilan (`round(q × narx, 2)`) — keyin
 * `sales_consistency` trigger'i ularni qatorlarning GENERATED `line_total`/`line_cost` yig'indisi bilan solishtiradi.
 */
@Injectable()
export class SalesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private where(filter: SaleFilter): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filter.userId) conditions.push(Prisma.sql`s.user_id = ${filter.userId}::uuid`);
    if (filter.warehouseId)
      conditions.push(Prisma.sql`s.warehouse_id = ${filter.warehouseId}::uuid`);
    if (filter.customerId) conditions.push(Prisma.sql`s.customer_id = ${filter.customerId}::uuid`);
    if (filter.productId) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM sale_items i
        WHERE i.sale_id = s.id AND i.product_id = ${filter.productId}::uuid)`);
    }
    if (filter.search) {
      const digits = /^(?:s-?)?0*(\d{1,18})$/i.exec(filter.search)?.[1];
      const pattern = `%${escapeLike(filter.search)}%`;
      conditions.push(
        digits
          ? Prisma.sql`(s.number = ${BigInt(digits)} OR s.customer_name_snapshot ILIKE ${pattern} ESCAPE '\\')`
          : Prisma.sql`s.customer_name_snapshot ILIKE ${pattern} ESCAPE '\\'`,
      );
    }
    const { from, to } = tashkentDateRangeToUtc(filter);
    if (from) conditions.push(Prisma.sql`s.sold_at >= ${from}`);
    if (to) conditions.push(Prisma.sql`s.sold_at < ${to}`);
    return Prisma.join(conditions, ' AND ');
  }

  /**
   * Bitta sahifa. Jami son bu yerda hisoblanmaydi: `count(*) OVER ()` PostgreSQL'ni LIMIT'dan oldin
   * BUTUN natijani (har qatorga `itemsCount` subquery'si bilan) yig'ishga majbur qilardi — 1 mln sotuvda
   * ~2 s (Phase 15 yuklama testi, TESTING §5.2). Endi indeks bo'yicha faqat sahifa qatorlari o'qiladi.
   */
  async page(filter: SaleFilter, page: SalePage, withItems = false): Promise<SaleRow[]> {
    const orderBy = toSqlOrderBy(page.sort, SORT_COLUMNS, Prisma.sql`s.number`);
    const { skip, take } = toPrismaPagination(page);
    const raw = await this.prisma.$queryRaw<RawSale[]>`
      ${SELECT} ${FROM}
       WHERE ${this.where(filter)}
       ${orderBy} LIMIT ${take} OFFSET ${skip}`;
    return this.attachItems(raw, withItems, this.prisma);
  }

  /** Filtr bo'yicha jami son (JOIN'larsiz: `user_id`, `warehouse_id` — NOT NULL FK, son bir xil). */
  async count(filter: SaleFilter): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM sales s WHERE ${this.where(filter)}`;
    return row?.count ?? 0;
  }

  async list(
    filter: SaleFilter,
    page: SalePage,
    withItems = false,
  ): Promise<{ rows: SaleRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.page(filter, page, withItems),
      this.count(filter),
    ]);
    return { rows, total };
  }

  async summary(filter: SaleFilter): Promise<{
    count: number;
    totalQuantity: string;
    totalAmount: string;
    totalCost: string;
  }> {
    const [row] = await this.prisma.$queryRaw<
      { count: number; totalQuantity: string; totalAmount: string; totalCost: string }[]
    >`
      SELECT count(*)::int AS count,
             coalesce(sum(s.total_quantity), 0)::numeric(14, 3)::text AS "totalQuantity",
             coalesce(sum(s.total_amount), 0)::numeric(18, 2)::text AS "totalAmount",
             coalesce(sum(s.total_cost), 0)::numeric(18, 2)::text AS "totalCost"
        FROM sales s WHERE ${this.where(filter)}`;
    return row ?? { count: 0, totalQuantity: '0.000', totalAmount: '0.00', totalCost: '0.00' };
  }

  async find(id: string, client: Tx | PrismaService = this.prisma): Promise<SaleRow | null> {
    const raw = await client.$queryRaw<RawSale[]>`${SELECT} ${FROM} WHERE s.id = ${id}::uuid`;
    const [row] = await this.attachItems(raw, true, client);
    return row ?? null;
  }

  async findByIdempotencyKey(
    key: string,
  ): Promise<{ id: string; userId: string; requestHash: string } | null> {
    const rows = await this.prisma.$queryRaw<{ id: string; userId: string; requestHash: string }[]>`
      SELECT id, user_id AS "userId", request_hash AS "requestHash"
        FROM sales WHERE idempotency_key = ${key}::uuid`;
    return rows[0] ?? null;
  }

  /** Mahsulotlar `FOR SHARE`: sotuv davomida narx, tannarx, holat va butun/kasr siyosati o'zgarmaydi. */
  async lockProducts(tx: Tx, ids: string[]): Promise<Map<string, ProductForSale>> {
    const rows = await tx.$queryRaw<ProductForSale[]>`
      SELECT id, name, barcode, unit::text AS unit, status::text AS status,
             allow_decimal AS "allowDecimal", sale_price::text AS "salePrice",
             wholesale_price::text AS "wholesalePrice",
             cost_price::text AS "costPrice"
        FROM products WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`;
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Joriy qoldiqlar — oldindan tekshiruv (aniq xabar uchun); kafolat — `InventoryService` shartli UPDATE'i. */
  async stockLevels(tx: Tx, warehouseId: string, ids: string[]): Promise<Map<string, string>> {
    const rows = await tx.$queryRaw<{ productId: string; quantity: string }[]>`
      SELECT product_id AS "productId", quantity::text AS quantity FROM warehouse_stock
       WHERE warehouse_id = ${warehouseId}::uuid AND product_id = ANY(${ids}::uuid[])`;
    return new Map(rows.map((row) => [row.productId, row.quantity]));
  }

  /** Mavjud mijoz `FOR UPDATE` — yig'ma ustunlar shu tranzaksiyada yangilanadi. */
  async lockCustomer(
    tx: Tx,
    id: string,
  ): Promise<{ id: string; name: string; phone: string | null } | null> {
    const rows = await tx.$queryRaw<{ id: string; name: string; phone: string | null }[]>`
      SELECT id, name, phone FROM customers WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Ismsiz sotuv mijozi: telefon bo'lsa — shu raqamli eng so'nggi xaridor; bo'lmasa — yagona umumiy
   * yozuv (`WALK_IN_CUSTOMER_NAME`, telefonsiz). Parallel sotuvlar ikkita umumiy yozuv yaratmasin —
   * advisory lock. Topilmasa `null` (chaqiruvchi yangisini yaratadi).
   */
  async lockWalkInCustomer(
    tx: Tx,
    phone: string | null,
  ): Promise<{ id: string; name: string; phone: string | null } | null> {
    if (phone !== null) {
      const rows = await tx.$queryRaw<{ id: string; name: string; phone: string | null }[]>`
        SELECT id, name, phone FROM customers WHERE phone = ${phone}
        ORDER BY last_purchase_at DESC NULLS LAST, created_at DESC LIMIT 1 FOR UPDATE`;
      return rows[0] ?? null;
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${WALK_IN_LOCK_KEY}))`;
    const rows = await tx.$queryRaw<{ id: string; name: string; phone: string | null }[]>`
      SELECT id, name, phone FROM customers WHERE name = ${WALK_IN_CUSTOMER_NAME} AND phone IS NULL
      ORDER BY created_at LIMIT 1 FOR UPDATE`;
    return rows[0] ?? null;
  }

  async createCustomer(
    tx: Tx,
    data: { name: string; phone: string | null; createdById: string },
  ): Promise<string> {
    return (await tx.customer.create({ data, select: { id: true } })).id;
  }

  /**
   * Sotuv hujjati: narx va tannarx snapshot'i mahsulot kartochkasidan (dona yoki optom narx — D-25,
   * `cost_price` — D-02, D-16), totallar shu qatorlardan DB yaxlitlashi bilan. Client narxi hech qachon ishlatilmaydi (BR-15).
   */
  async insertSale(
    tx: Tx,
    data: {
      userId: string;
      warehouseId: string;
      customer: { id: string; name: string; phone: string | null };
      idempotencyKey: string;
      requestHash: string;
      priceType: SalePriceType;
      lines: SaleLine[];
    },
  ): Promise<{ id: string }> {
    const ids = data.lines.map((line) => line.productId);
    const quantities = data.lines.map((line) => line.quantity);
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      WITH lines AS (
        SELECT l.product_id, l.quantity FROM unnest(${ids}::uuid[], ${quantities}::numeric[]) AS l(product_id, quantity)
      )
      INSERT INTO sales (user_id, warehouse_id, customer_id, customer_name_snapshot, customer_phone_snapshot,
                         total_quantity, total_amount, total_cost, idempotency_key, request_hash,
                         price_type)
      SELECT ${data.userId}::uuid, ${data.warehouseId}::uuid, ${data.customer.id}::uuid,
             ${data.customer.name}, ${data.customer.phone},
             sum(l.quantity), sum(round(l.quantity * ${unitPriceSql(data.priceType)}, 2)),
             sum(round(l.quantity * p.cost_price, 2)),
             ${data.idempotencyKey}::uuid, ${data.requestHash}, ${data.priceType}::sale_price_type
        FROM lines l JOIN products p ON p.id = l.product_id
      RETURNING id`;
    if (!row) throw new Error('sales INSERT qator qaytarmadi');
    return row;
  }

  async insertItems(
    tx: Tx,
    saleId: string,
    lines: SaleLine[],
    priceType: SalePriceType,
  ): Promise<{ id: string; productId: string; quantity: string; unitCost: string }[]> {
    const ids = lines.map((line) => line.productId);
    const quantities = lines.map((line) => line.quantity);
    return tx.$queryRaw`
      INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost)
      SELECT ${saleId}::uuid, p.id, p.name, p.barcode, l.quantity, ${unitPriceSql(priceType)}, p.cost_price
        FROM unnest(${ids}::uuid[], ${quantities}::numeric[]) AS l(product_id, quantity)
        JOIN products p ON p.id = l.product_id
      RETURNING id, product_id AS "productId", quantity::text AS quantity, unit_cost::text AS "unitCost"`;
  }

  /** Mijoz yig'malari (cache, DATABASE §4.14) — sotuv bilan bitta tranzaksiyada; reconciliation tekshiradi. */
  async addToCustomerAggregates(tx: Tx, saleId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE customers c SET purchase_count = c.purchase_count + 1,
             total_spent = c.total_spent + s.total_amount,
             last_purchase_at = greatest(c.last_purchase_at, s.sold_at),
             updated_at = now()
        FROM sales s WHERE s.id = ${saleId}::uuid AND c.id = s.customer_id`;
  }

  private async attachItems(
    raw: RawSale[],
    withItems: boolean,
    client: Tx | PrismaService,
  ): Promise<SaleRow[]> {
    const ids = raw.map((sale) => sale.id);
    const items =
      withItems && ids.length
        ? await client.$queryRaw<(Required<SaleItemDto> & { saleId: string })[]>`
            SELECT i.sale_id AS "saleId", i.product_id AS "productId", i.product_name AS "productName",
                   i.barcode, p.unit::text AS unit, i.quantity::text AS quantity,
                   i.unit_price::text AS "unitPrice", i.line_total::text AS "lineTotal",
                   i.unit_cost::text AS "unitCost", (i.line_total - i.line_cost)::text AS "lineProfit"
              FROM sale_items i JOIN products p ON p.id = i.product_id
             WHERE i.sale_id = ANY(${ids}::uuid[])
             ORDER BY i.id`
        : [];
    return raw.map(
      ({
        userId,
        userLogin,
        userFullName,
        warehouseId,
        warehouseName,
        customerId,
        customerName,
        customerPhone,
        ...sale
      }): SaleRow => ({
        ...sale,
        user: { id: userId, login: userLogin, fullName: userFullName },
        warehouse: { id: warehouseId, name: warehouseName },
        customer: { id: customerId, name: customerName, phone: customerPhone },
        status: 'COMPLETED',
        ...(withItems
          ? {
              items: items
                .filter((item) => item.saleId === sale.id)
                .map(({ saleId: _saleId, ...item }) => ({
                  ...item,
                  unit: item.unit as ProductUnit,
                })),
            }
          : {}),
      }),
    );
  }
}
