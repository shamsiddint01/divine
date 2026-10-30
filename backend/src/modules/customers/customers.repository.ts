import { Injectable } from '@nestjs/common';
import type { SortSpec } from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { toPrismaPagination, toSqlOrderBy } from '../../common/query/prisma-query.js';
import { escapeLike } from '../product-groups/product-groups.repository.js';

export type CustomerSortField =
  'name' | 'lastPurchaseAt' | 'totalSpent' | 'purchaseCount' | 'createdAt';

export interface ListCustomersQuery {
  page: number;
  pageSize: number;
  sort: SortSpec<CustomerSortField>;
  /** Ism (qisman) yoki telefon raqamlari (kamida 3 ta raqam, qisman). */
  search?: string;
}

export interface PurchasesQuery {
  page: number;
  pageSize: number;
  sort: SortSpec<'soldAt'>;
  dateFrom?: string;
  dateTo?: string;
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  purchaseCount: number;
  totalSpent: string;
  lastPurchaseAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = Prisma.sql`
  c.id, c.name, c.phone, c.notes, c.purchase_count AS "purchaseCount",
  c.total_spent::text AS "totalSpent", c.last_purchase_at AS "lastPurchaseAt",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;

/** "Oxirgi xarid" bo'yicha: xarid qilmaganlar kamayish tartibida oxirida (mock bilan bir xil). */
const SORT_COLUMNS: Readonly<Record<CustomerSortField, Prisma.Sql>> = {
  name: Prisma.sql`lower(c.name)`,
  lastPurchaseAt: Prisma.sql`coalesce(c.last_purchase_at, '-infinity'::timestamptz)`,
  totalSpent: Prisma.sql`c.total_spent`,
  purchaseCount: Prisma.sql`c.purchase_count`,
  createdAt: Prisma.sql`c.created_at`,
};

/**
 * Mijozlar — data access (DATABASE §4.14). Yig'ma ustunlar (`purchase_count`, `total_spent`,
 * `last_purchase_at`) sotuv tranzaksiyasida yangilanadi (Phase 10) va `reconcile_customer_aggregates`
 * bilan tekshiriladi — bu yerda faqat o'qiladi. Xarid tarixi — `SalesRepository` (sales moduli).
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCustomersQuery): Promise<{ rows: CustomerRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      const digits = query.search.replace(/\D/g, '');
      conditions.push(
        digits.length >= 3
          ? Prisma.sql`(c.name ILIKE ${pattern} ESCAPE '\\' OR c.phone LIKE ${`%${digits}%`})`
          : Prisma.sql`c.name ILIKE ${pattern} ESCAPE '\\'`,
      );
    }
    const orderBy = toSqlOrderBy(query.sort, SORT_COLUMNS, Prisma.sql`c.id`);
    const { skip, take } = toPrismaPagination(query);
    const rows = await this.prisma.$queryRaw<(CustomerRow & { total: bigint })[]>`
      SELECT ${COLUMNS}, count(*) OVER () AS total FROM customers c
       WHERE ${Prisma.join(conditions, ' AND ')}
       ${orderBy} LIMIT ${take} OFFSET ${skip}`;
    return {
      rows: rows.map(({ total: _total, ...row }) => row),
      total: rows[0] ? Number(rows[0].total) : 0,
    };
  }

  async find(id: string, client: Tx | PrismaService = this.prisma): Promise<CustomerRow | null> {
    const rows = await client.$queryRaw<CustomerRow[]>`
      SELECT ${COLUMNS} FROM customers c WHERE c.id = ${id}::uuid`;
    return rows[0] ?? null;
  }

  async lock(tx: Tx, id: string): Promise<CustomerRow | null> {
    const rows = await tx.$queryRaw<CustomerRow[]>`
      SELECT ${COLUMNS} FROM customers c WHERE c.id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  async create(
    tx: Tx,
    data: { name: string; phone: string | null; notes: string | null; createdById: string },
  ): Promise<string> {
    return (await tx.customer.create({ data, select: { id: true } })).id;
  }

  async update(
    tx: Tx,
    id: string,
    data: { name?: string; phone?: string | null; notes?: string | null },
  ): Promise<void> {
    await tx.customer.update({ where: { id }, data, select: { id: true } });
  }
}
