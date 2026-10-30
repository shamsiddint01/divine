import { Injectable } from '@nestjs/common';
import type {
  IncomingDto,
  IncomingItemDto,
  IncomingStatus,
  ProductStatus,
  ProductUnit,
  SortSpec,
  UserRefDto,
} from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { toPrismaPagination, toSqlOrderBy } from '../../common/query/prisma-query.js';
import { escapeLike } from '../product-groups/product-groups.repository.js';

export type IncomingSortField = 'date' | 'createdAt' | 'totalQuantity' | 'totalAmount';

export interface ListIncomingQuery {
  page: number;
  pageSize: number;
  sort: SortSpec<IncomingSortField>;
  /** Hujjat raqami (`K-000123` yoki `123`) yoki izoh bo'yicha. */
  search?: string;
  status?: IncomingStatus;
  warehouseId?: string;
  productId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Ichki ko'rinish: narx maydonlari doim bor — javobga faqat serializer (ruxsatga qarab) chiqaradi. */
export type IncomingItemRow = Required<IncomingItemDto>;
export type IncomingRow = Omit<
  IncomingDto,
  'totalAmount' | 'items' | 'confirmedAt' | 'cancelledAt' | 'createdAt' | 'updatedAt'
> & {
  totalAmount: string;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Hujjat qatorini qulflash natijasi (holat mashinasi va ombor tekshiruvi uchun). */
export interface LockedIncoming {
  id: string;
  number: bigint;
  status: IncomingStatus;
  warehouseId: string;
  incomingDate: string;
  notes: string | null;
}

export interface ProductForIncoming {
  id: string;
  name: string;
  barcode: string | null;
  status: ProductStatus;
  allowDecimal: boolean;
}

export interface NewItem {
  productId: string;
  productName: string;
  barcode: string | null;
  quantity: string;
  costPrice: string;
}

type RawIncoming = Omit<IncomingRow, 'createdBy' | 'confirmedBy' | 'cancelledBy'> & {
  createdById: string;
  createdLogin: string;
  createdName: string | null;
  confirmedById: string | null;
  confirmedLogin: string | null;
  confirmedName: string | null;
  cancelledById: string | null;
  cancelledLogin: string | null;
  cancelledName: string | null;
  total?: bigint;
};

const SELECT = Prisma.sql`
  SELECT d.id, 'K-' || lpad(d.number::text, 6, '0') AS number, d.incoming_date::text AS date,
         d.warehouse_id AS "warehouseId", w.name AS "warehouseName", d.notes, d.status::text AS status,
         (SELECT count(*)::int FROM incoming_items i WHERE i.incoming_id = d.id) AS "itemsCount",
         d.total_quantity::text AS "totalQuantity", d.total_amount::text AS "totalAmount",
         cu.id AS "createdById", cu.login AS "createdLogin", cu.full_name AS "createdName",
         fu.id AS "confirmedById", fu.login AS "confirmedLogin", fu.full_name AS "confirmedName",
         d.confirmed_at AS "confirmedAt",
         xu.id AS "cancelledById", xu.login AS "cancelledLogin", xu.full_name AS "cancelledName",
         d.cancelled_at AS "cancelledAt",
         d.created_at AS "createdAt", d.updated_at AS "updatedAt"`;

const FROM = Prisma.sql`
  FROM incoming d
  JOIN warehouses w ON w.id = d.warehouse_id
  JOIN users cu ON cu.id = d.created_by
  LEFT JOIN users fu ON fu.id = d.confirmed_by
  LEFT JOIN users xu ON xu.id = d.cancelled_by`;

const SORT_COLUMNS: Readonly<Record<IncomingSortField, Prisma.Sql>> = {
  date: Prisma.sql`d.incoming_date`,
  createdAt: Prisma.sql`d.created_at`,
  totalQuantity: Prisma.sql`d.total_quantity`,
  totalAmount: Prisma.sql`d.total_amount`,
};

/**
 * Kirim — data access (DATABASE §4.9–4.10). Qatorlar hujjat bilan birga yoziladi; totallar har safar
 * DB'dagi qatorlardan qayta hisoblanadi (`line_total` GENERATED — yaxlitlash bitta joyda, REQ-063/065).
 * Holat o'tishlari va qator o'zgarishlarini trigger'lar ham himoyalaydi (`incoming_guard`, BR-16/17).
 */
@Injectable()
export class IncomingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListIncomingQuery,
    scope: string[] | undefined,
  ): Promise<{ rows: IncomingRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (scope) conditions.push(Prisma.sql`d.warehouse_id = ANY(${scope}::uuid[])`);
    if (query.status) conditions.push(Prisma.sql`d.status = ${query.status}::incoming_status`);
    if (query.warehouseId) conditions.push(Prisma.sql`d.warehouse_id = ${query.warehouseId}::uuid`);
    if (query.createdBy) conditions.push(Prisma.sql`d.created_by = ${query.createdBy}::uuid`);
    if (query.productId) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM incoming_items i
        WHERE i.incoming_id = d.id AND i.product_id = ${query.productId}::uuid)`);
    }
    if (query.dateFrom) conditions.push(Prisma.sql`d.incoming_date >= ${query.dateFrom}::date`);
    if (query.dateTo) conditions.push(Prisma.sql`d.incoming_date <= ${query.dateTo}::date`);
    if (query.search) {
      const digits = /^(?:k-?)?0*(\d{1,18})$/i.exec(query.search)?.[1];
      const pattern = `%${escapeLike(query.search)}%`;
      conditions.push(
        digits
          ? Prisma.sql`(d.number = ${BigInt(digits)} OR d.notes ILIKE ${pattern} ESCAPE '\\')`
          : Prisma.sql`d.notes ILIKE ${pattern} ESCAPE '\\'`,
      );
    }
    const orderBy = toSqlOrderBy(query.sort, SORT_COLUMNS, Prisma.sql`d.number`);
    const { skip, take } = toPrismaPagination(query);
    const raw = await this.prisma.$queryRaw<RawIncoming[]>`
      ${SELECT}, count(*) OVER () AS total ${FROM}
       WHERE ${Prisma.join(conditions, ' AND ')}
       ${orderBy} LIMIT ${take} OFFSET ${skip}`;
    return { rows: raw.map(toRow), total: raw[0] ? Number(raw[0].total) : 0 };
  }

  async find(id: string, client: Tx | PrismaService = this.prisma): Promise<IncomingRow | null> {
    const raw = await client.$queryRaw<RawIncoming[]>`${SELECT} ${FROM} WHERE d.id = ${id}::uuid`;
    return raw[0] ? toRow(raw[0]) : null;
  }

  async items(id: string, client: Tx | PrismaService = this.prisma): Promise<IncomingItemRow[]> {
    const rows = await client.$queryRaw<IncomingItemRow[]>`
      SELECT i.id, i.product_id AS "productId", i.product_name AS "productName", g.name AS "groupName",
             i.barcode, p.unit::text AS unit, i.quantity::text AS quantity,
             i.cost_price::text AS "costPrice", i.line_total::text AS "lineTotal"
        FROM incoming_items i
        JOIN products p ON p.id = i.product_id
        JOIN product_groups g ON g.id = p.group_id
       WHERE i.incoming_id = ${id}::uuid
       ORDER BY i.created_at, i.id`;
    return rows.map((row) => ({ ...row, unit: row.unit as ProductUnit }));
  }

  /** `FOR UPDATE`: parallel tahrirlash/tasdiqlash/bekor qilish navbat bilan o'tadi. */
  async lock(tx: Tx, id: string): Promise<LockedIncoming | null> {
    const rows = await tx.$queryRaw<LockedIncoming[]>`
      SELECT id, number, status::text AS status, warehouse_id AS "warehouseId",
             incoming_date::text AS "incomingDate", notes
        FROM incoming WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Qatorlardagi mahsulotlar `FOR SHARE` bilan: tasdiqlash davomida mahsulot nofaol qilinmaydi va
   * butun/kasr siyosati o'zgarmaydi. ID tartibida — deadlock yo'q.
   */
  async lockProducts(tx: Tx, ids: string[]): Promise<Map<string, ProductForIncoming>> {
    const rows = await tx.$queryRaw<ProductForIncoming[]>`
      SELECT id, name, barcode, status::text AS status, allow_decimal AS "allowDecimal"
        FROM products WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`;
    return new Map(rows.map((row) => [row.id, row]));
  }

  async create(
    tx: Tx,
    data: { date: string; warehouseId: string; notes: string | null; createdById: string },
  ): Promise<string> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO incoming (incoming_date, warehouse_id, notes, created_by)
      VALUES (${data.date}::date, ${data.warehouseId}::uuid, ${data.notes}, ${data.createdById}::uuid)
      RETURNING id`;
    if (!row) throw new Error('incoming INSERT qator qaytarmadi');
    return row.id;
  }

  async updateHeader(
    tx: Tx,
    id: string,
    data: { date: string; warehouseId: string; notes: string | null },
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE incoming SET incoming_date = ${data.date}::date, warehouse_id = ${data.warehouseId}::uuid,
             notes = ${data.notes}, updated_at = now()
       WHERE id = ${id}::uuid`;
  }

  /** Qatorlarni to'liq almashtiradi (DRAFT; snapshot'lar shu paytdagi mahsulot ma'lumotidan). */
  async replaceItems(tx: Tx, id: string, items: NewItem[]): Promise<void> {
    await tx.$executeRaw`DELETE FROM incoming_items WHERE incoming_id = ${id}::uuid`;
    await tx.incomingItem.createMany({
      data: items.map((item) => ({ incomingId: id, ...item })),
    });
  }

  /** Totallar — DB'dagi qatorlardan (`line_total` GENERATED); client qiymati hech qachon ishlatilmaydi. */
  async recalculateTotals(tx: Tx, id: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE incoming d SET
        total_quantity = t.qty, total_amount = t.amount, updated_at = now()
        FROM (SELECT coalesce(sum(quantity), 0) AS qty, coalesce(sum(line_total), 0) AS amount
                FROM incoming_items WHERE incoming_id = ${id}::uuid) t
       WHERE d.id = ${id}::uuid`;
  }

  /**
   * DRAFT → CONFIRMED (shartli UPDATE, BR-17). Totallar shu UPDATE'ning o'zida qatorlardan qayta
   * hisoblanadi — `incoming_guard` ularni yana tekshiradi. 0 qator — hujjat allaqachon DRAFT emas.
   */
  async markConfirmed(tx: Tx, id: string, actorId: string, at: Date): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE incoming d SET
        status = 'CONFIRMED', confirmed_by = ${actorId}::uuid, confirmed_at = ${at},
        total_quantity = t.qty, total_amount = t.amount, updated_at = now()
        FROM (SELECT coalesce(sum(quantity), 0) AS qty, coalesce(sum(line_total), 0) AS amount
                FROM incoming_items WHERE incoming_id = ${id}::uuid) t
       WHERE d.id = ${id}::uuid AND d.status = 'DRAFT'`;
    return updated === 1;
  }

  async markCancelled(tx: Tx, id: string, actorId: string, at: Date): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE incoming SET status = 'CANCELLED', cancelled_by = ${actorId}::uuid, cancelled_at = ${at},
             updated_at = now()
       WHERE id = ${id}::uuid AND status = 'DRAFT'`;
    return updated === 1;
  }
}

function ref(id: string | null, login: string | null, fullName: string | null): UserRefDto | null {
  return id && login ? { id, login, fullName } : null;
}

function toRow(raw: RawIncoming): IncomingRow {
  const {
    createdById,
    createdLogin,
    createdName,
    confirmedById,
    confirmedLogin,
    confirmedName,
    cancelledById,
    cancelledLogin,
    cancelledName,
    total: _total,
    ...rest
  } = raw;
  return {
    ...rest,
    createdBy: { id: createdById, login: createdLogin, fullName: createdName },
    confirmedBy: ref(confirmedById, confirmedLogin, confirmedName),
    cancelledBy: ref(cancelledById, cancelledLogin, cancelledName),
  };
}
