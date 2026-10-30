import { Injectable } from '@nestjs/common';
import type { ProductGroupDto, SortSpec } from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { toPrismaPagination, toSqlOrderBy } from '../../common/query/prisma-query.js';

export type GroupSortField = 'name' | 'productCount' | 'createdAt';

export interface ListGroupsQuery {
  page: number;
  pageSize: number;
  sort: SortSpec<GroupSortField>;
  search?: string;
  isActive?: boolean;
}

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
  total?: bigint;
}

/** LIKE maxsus belgilari (`%`, `_`, `\`) oddiy belgi sifatida qidirilsin. */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

const SELECT = Prisma.sql`
  SELECT g.id, g.name, g.description, g.is_active AS "isActive",
         (SELECT count(*)::int FROM products p WHERE p.group_id = g.id) AS "productCount",
         g.created_at AS "createdAt", g.updated_at AS "updatedAt"`;

/** Mahsulot guruhlari — data access (ARCHITECTURE §4). */
@Injectable()
export class ProductGroupsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListGroupsQuery): Promise<{ rows: ProductGroupDto[]; total: number }> {
    const conditions: Prisma.Sql[] = [];
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      conditions.push(
        Prisma.sql`(g.name ILIKE ${pattern} ESCAPE '\\' OR g.description ILIKE ${pattern} ESCAPE '\\')`,
      );
    }
    if (query.isActive !== undefined) conditions.push(Prisma.sql`g.is_active = ${query.isActive}`);
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
    const orderBy = toSqlOrderBy(
      query.sort,
      {
        name: Prisma.sql`lower(g.name)`,
        productCount: Prisma.sql`"productCount"`,
        createdAt: Prisma.sql`g.created_at`,
      },
      Prisma.sql`g.id`,
    );
    const { skip, take } = toPrismaPagination(query);
    const rows = await this.prisma.$queryRaw<GroupRow[]>`
      ${SELECT}, count(*) OVER () AS total
        FROM product_groups g ${where} ${orderBy} LIMIT ${take} OFFSET ${skip}`;
    const total = rows[0] ? Number(rows[0].total) : await this.count(where);
    return { rows: rows.map(toGroupDto), total };
  }

  private async count(where: Prisma.Sql): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM product_groups g ${where}`;
    return row?.n ?? 0;
  }

  async findDto(
    id: string,
    client: Tx | PrismaService = this.prisma,
  ): Promise<ProductGroupDto | null> {
    const rows = await client.$queryRaw<
      GroupRow[]
    >`${SELECT} FROM product_groups g WHERE g.id = ${id}::uuid`;
    return rows[0] ? toGroupDto(rows[0]) : null;
  }

  async lock(
    tx: Tx,
    id: string,
  ): Promise<{ id: string; name: string; description: string | null; isActive: boolean } | null> {
    const rows = await tx.$queryRaw<
      { id: string; name: string; description: string | null; isActive: boolean }[]
    >`SELECT id, name, description, is_active AS "isActive" FROM product_groups
       WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  async nameTaken(tx: Tx, name: string, exceptId?: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM product_groups
       WHERE lower(name) = lower(${name}) AND (${exceptId ?? null}::uuid IS NULL OR id <> ${exceptId ?? null}::uuid)`;
    return rows.length > 0;
  }

  async productCount(tx: Tx, id: string): Promise<number> {
    return tx.product.count({ where: { groupId: id } });
  }

  async create(
    tx: Tx,
    data: { name: string; description: string | null; createdById: string },
  ): Promise<string> {
    return (await tx.productGroup.create({ data, select: { id: true } })).id;
  }

  async update(tx: Tx, id: string, data: Prisma.ProductGroupUncheckedUpdateInput): Promise<void> {
    await tx.productGroup.update({ where: { id }, data, select: { id: true } });
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.productGroup.delete({ where: { id } });
  }
}

function toGroupDto(row: GroupRow): ProductGroupDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    productCount: row.productCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
