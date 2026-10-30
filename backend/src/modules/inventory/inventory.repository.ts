import { Injectable } from '@nestjs/common';
import type {
  MovementDto,
  ProductUnit,
  ReconciliationMismatch,
  SortSpec,
  WarehouseStatus,
} from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { toPrismaPagination, toSqlOrderBy } from '../../common/query/prisma-query.js';
import { tashkentDateRangeToUtc } from '../../common/time/tashkent-time.js';
import { escapeLike } from '../product-groups/product-groups.repository.js';

export type MovementKind = 'INCOMING' | 'SALE';

/** Harakatlar filtri (service tayyorlaydi — ruxsatlar allaqachon qo'llangan). */
export interface MovementFilter {
  page: number;
  pageSize: number;
  sort: SortSpec<'createdAt'>;
  warehouseId?: string;
  productId?: string;
  userId?: string;
  movementType?: MovementKind;
  referenceType?: MovementKind;
  /** Mahsulot nomi (qisman) yoki shtrix-kod (aniq). */
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Userning ombor doirasi (`undefined` — barcha omborlar). */
  scope?: string[];
}

/** Ichki qator: `unitCost` doim bor — javobga faqat serializer (ruxsatga qarab) chiqaradi. */
export type MovementRow = Omit<MovementDto, 'unitCost' | 'createdAt'> & {
  unitCost: string | null;
  createdAt: Date;
};

type RawMovement = Omit<MovementRow, 'createdBy'> & {
  userId: string;
  userLogin: string;
  userFullName: string | null;
  total: bigint;
};

/** Qoldiqni o'zgartirish uchun bitta ledger yozuvi (hujjat qatori bilan aynan mos, INV-4). */
export interface LedgerEntry {
  warehouseId: string;
  productId: string;
  /** Musbat miqdor (ishora `movementType`dan). */
  quantity: string;
  unitCost: string;
  referenceType: MovementKind;
  referenceId: string;
  referenceItemId: string;
  actorId: string;
}

/**
 * Inventar — data access (DATABASE §5.3). Qoldiq faqat shu yerda o'zgaradi: avval `warehouse_stock`
 * (shartli UPDATE + `RETURNING`), keyin shu balans bilan ledger yozuvi — trigger'lar aynan shu tartibni
 * talab qiladi (INV-1, INV-3). Ledger yozuvlari o'zgarmaydi (UPDATE/DELETE trigger'da rad etiladi).
 */
@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Omborni `FOR SHARE` bilan qulflaydi: parallel holat o'zgarishi (`FOR UPDATE`) shu tranzaksiya
   * tugaguncha kutadi — "tekshirildi, keyin nofaol bo'ldi" poygasi yo'q (BR-21).
   */
  async lockWarehouseShared(
    tx: Tx,
    warehouseId: string,
  ): Promise<{ status: WarehouseStatus } | null> {
    const rows = await tx.$queryRaw<{ status: WarehouseStatus }[]>`
      SELECT status::text AS status FROM warehouses WHERE id = ${warehouseId}::uuid FOR SHARE`;
    return rows[0] ?? null;
  }

  /** Qoldiqni oshiradi (qator bo'lmasa yaratadi) va yangi qoldiqni qaytaradi. */
  async addStock(
    tx: Tx,
    warehouseId: string,
    productId: string,
    quantity: string,
  ): Promise<string> {
    const [row] = await tx.$queryRaw<{ quantity: string }[]>`
      INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
      VALUES (${warehouseId}::uuid, ${productId}::uuid, ${quantity}::numeric)
      ON CONFLICT (warehouse_id, product_id)
      DO UPDATE SET quantity = warehouse_stock.quantity + EXCLUDED.quantity, updated_at = now()
      RETURNING quantity::text AS quantity`;
    if (!row) throw new Error('warehouse_stock upsert qator qaytarmadi');
    return row.quantity;
  }

  /**
   * Shartli kamaytirish (REQ-077, REQ-161): qoldiq yetarli bo'lsagina; aks holda `null`.
   * Row lock shu UPDATE'ning o'zida — parallel sotuvlar navbat bilan o'tadi.
   */
  async takeStock(
    tx: Tx,
    warehouseId: string,
    productId: string,
    quantity: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<{ quantity: string }[]>`
      UPDATE warehouse_stock SET quantity = quantity - ${quantity}::numeric, updated_at = now()
       WHERE warehouse_id = ${warehouseId}::uuid AND product_id = ${productId}::uuid
         AND quantity >= ${quantity}::numeric
      RETURNING quantity::text AS quantity`;
    return rows[0]?.quantity ?? null;
  }

  async currentStock(tx: Tx, warehouseId: string, productId: string): Promise<string> {
    const [row] = await tx.$queryRaw<{ quantity: string }[]>`
      SELECT coalesce((SELECT quantity FROM warehouse_stock
                        WHERE warehouse_id = ${warehouseId}::uuid AND product_id = ${productId}::uuid), 0)::text
             AS quantity`;
    return row?.quantity ?? '0';
  }

  async insertMovement(
    tx: Tx,
    entry: LedgerEntry,
    signedQuantity: string,
    balanceAfter: string,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO inventory_movements (warehouse_id, product_id, movement_type, quantity, balance_after,
        unit_cost, reference_type, reference_id, reference_item_id, created_by)
      VALUES (${entry.warehouseId}::uuid, ${entry.productId}::uuid,
              ${entry.referenceType}::movement_type, ${signedQuantity}::numeric, ${balanceAfter}::numeric,
              ${entry.unitCost}::numeric, ${entry.referenceType}::movement_reference_type,
              ${entry.referenceId}::uuid, ${entry.referenceItemId}::uuid, ${entry.actorId}::uuid)`;
  }

  async listMovements(filter: MovementFilter): Promise<{ rows: MovementRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filter.scope) conditions.push(Prisma.sql`m.warehouse_id = ANY(${filter.scope}::uuid[])`);
    if (filter.warehouseId) {
      conditions.push(Prisma.sql`m.warehouse_id = ${filter.warehouseId}::uuid`);
    }
    if (filter.productId) conditions.push(Prisma.sql`m.product_id = ${filter.productId}::uuid`);
    if (filter.userId) conditions.push(Prisma.sql`m.created_by = ${filter.userId}::uuid`);
    if (filter.movementType) {
      conditions.push(Prisma.sql`m.movement_type = ${filter.movementType}::movement_type`);
    }
    if (filter.referenceType) {
      conditions.push(
        Prisma.sql`m.reference_type = ${filter.referenceType}::movement_reference_type`,
      );
    }
    if (filter.search) {
      const pattern = `%${escapeLike(filter.search)}%`;
      conditions.push(
        Prisma.sql`(p.name ILIKE ${pattern} ESCAPE '\\' OR p.barcode = ${filter.search})`,
      );
    }
    const { from, to } = tashkentDateRangeToUtc(filter);
    if (from) conditions.push(Prisma.sql`m.created_at >= ${from}`);
    if (to) conditions.push(Prisma.sql`m.created_at < ${to}`);

    const orderBy = toSqlOrderBy(
      filter.sort,
      { createdAt: Prisma.sql`m.created_at` },
      Prisma.sql`m.id`,
    );
    const { skip, take } = toPrismaPagination(filter);
    const raw = await this.prisma.$queryRaw<RawMovement[]>`
      SELECT m.id::text AS id, m.warehouse_id AS "warehouseId", w.name AS "warehouseName",
             m.product_id AS "productId", p.name AS "productName", p.unit::text AS unit,
             m.movement_type::text AS "movementType", m.quantity::text AS quantity,
             m.balance_after::text AS "balanceAfter", m.unit_cost::text AS "unitCost",
             m.reference_type::text AS "referenceType", m.reference_id AS "referenceId",
             CASE m.reference_type
               WHEN 'INCOMING' THEN 'K-' || lpad(i.number::text, 6, '0')
               ELSE 'S-' || lpad(s.number::text, 6, '0')
             END AS "referenceNumber",
             u.id AS "userId", u.login AS "userLogin", u.full_name AS "userFullName",
             m.created_at AS "createdAt", count(*) OVER () AS total
        FROM inventory_movements m
        JOIN warehouses w ON w.id = m.warehouse_id
        JOIN products p ON p.id = m.product_id
        JOIN users u ON u.id = m.created_by
        LEFT JOIN incoming i ON m.reference_type = 'INCOMING' AND i.id = m.reference_id
        LEFT JOIN sales s ON m.reference_type = 'SALE' AND s.id = m.reference_id
       WHERE ${Prisma.join(conditions, ' AND ')}
       ${orderBy} LIMIT ${take} OFFSET ${skip}`;
    return {
      rows: raw.map(({ total: _total, userId, userLogin, userFullName, ...row }) => ({
        ...row,
        unit: row.unit as ProductUnit,
        createdBy: { id: userId, login: userLogin, fullName: userFullName },
      })),
      total: raw[0] ? Number(raw[0].total) : 0,
    };
  }

  /** Reconciliation view'lari (DATABASE §5.4): bo'sh natija — hammasi mos. */
  async reconcile(limit: number): Promise<{
    pairsChecked: number;
    mismatchCount: number;
    mismatches: ReconciliationMismatch[];
    documentIssueCount: number;
    customerIssueCount: number;
  }> {
    const [counts] = await this.prisma.$queryRaw<
      {
        pairs: number;
        mismatches: number;
        documentMovements: number;
        documentTotals: number;
        customers: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM (SELECT warehouse_id, product_id FROM warehouse_stock
                                     UNION SELECT warehouse_id, product_id FROM inventory_movements) x) AS pairs,
        (SELECT count(*)::int FROM reconcile_inventory_stock) AS mismatches,
        (SELECT count(*)::int FROM reconcile_document_movements) AS "documentMovements",
        (SELECT count(*)::int FROM reconcile_document_totals) AS "documentTotals",
        (SELECT count(*)::int FROM reconcile_customer_aggregates) AS customers`;
    const mismatches = await this.prisma.$queryRaw<ReconciliationMismatch[]>`
      SELECT r.warehouse_id AS "warehouseId", w.name AS "warehouseName",
             r.product_id AS "productId", p.name AS "productName",
             r.stock_quantity::text AS "stockQuantity", r.ledger_quantity::text AS "ledgerQuantity",
             r.last_balance_after::text AS "lastBalanceAfter"
        FROM reconcile_inventory_stock r
        JOIN warehouses w ON w.id = r.warehouse_id
        JOIN products p ON p.id = r.product_id
       ORDER BY lower(w.name), lower(p.name)
       LIMIT ${limit}`;
    return {
      pairsChecked: counts?.pairs ?? 0,
      mismatchCount: counts?.mismatches ?? 0,
      mismatches,
      documentIssueCount: (counts?.documentMovements ?? 0) + (counts?.documentTotals ?? 0),
      customerIssueCount: counts?.customers ?? 0,
    };
  }
}
