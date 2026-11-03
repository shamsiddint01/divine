import { Injectable } from '@nestjs/common';
import type { SortSpec } from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { toPrismaPagination, toSqlOrderBy } from '../../common/query/prisma-query.js';
import { escapeLike } from '../product-groups/product-groups.repository.js';

export type ExpenseSortField = 'date' | 'amount';

export interface ExpenseFilter {
  /** Xarajat sanasi (`expense_date`, Toshkent kuni) — ikkala chegara ham kiradi. */
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  createdBy?: string;
  /** Izoh bo'yicha qisman qidiruv (registrsiz). */
  search?: string;
}

export interface ListExpensesQuery extends ExpenseFilter {
  page: number;
  pageSize: number;
  sort: SortSpec<ExpenseSortField>;
}

export interface ExpenseRow {
  id: string;
  date: string;
  amount: string;
  categoryId: string;
  categoryName: string;
  note: string | null;
  createdById: string;
  createdByLogin: string;
  createdByFullName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  isActive: boolean;
  createdById: string;
  createdByLogin: string;
  createdByFullName: string | null;
  expenseCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const EXPENSE_COLUMNS = Prisma.sql`
  e.id, to_char(e.expense_date, 'YYYY-MM-DD') AS date, e.amount::text AS amount,
  c.id AS "categoryId", c.name AS "categoryName", e.note,
  u.id AS "createdById", u.login AS "createdByLogin", u.full_name AS "createdByFullName",
  e.created_at AS "createdAt", e.updated_at AS "updatedAt"`;

const EXPENSE_FROM = Prisma.sql`
  FROM expenses e
  JOIN expense_categories c ON c.id = e.category_id
  JOIN users u ON u.id = e.created_by`;

/** Bir xil sanadagi xarajatlar kiritilish tartibida (`id` — uuidv7). */
const SORT_COLUMNS: Readonly<Record<ExpenseSortField, Prisma.Sql>> = {
  date: Prisma.sql`e.expense_date`,
  amount: Prisma.sql`e.amount`,
};

const CATEGORY_COLUMNS = Prisma.sql`
  c.id, c.name, c.is_active AS "isActive",
  (SELECT count(*)::int FROM expenses e WHERE e.category_id = c.id) AS "expenseCount",
  c.created_by AS "createdById", cu.login AS "createdByLogin", cu.full_name AS "createdByFullName",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;
const CATEGORY_FROM = Prisma.sql`expense_categories c JOIN users cu ON cu.id = c.created_by`;

/**
 * Xarajatlar va kategoriyalar — data access (DATABASE §4.15–4.16). Soft-delete qilingan xarajat
 * (`deleted_at IS NOT NULL`) ro'yxat, detal, yig'ma va tahrirlashda ko'rinmaydi, lekin bazada qoladi.
 */
@Injectable()
export class ExpensesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListExpensesQuery,
  ): Promise<{ rows: ExpenseRow[]; total: number; totalAmount: string }> {
    const where = whereClause(query);
    const orderBy = toSqlOrderBy(query.sort, SORT_COLUMNS, Prisma.sql`e.id`);
    const { skip, take } = toPrismaPagination(query);
    const rows = await this.prisma.$queryRaw<ExpenseRow[]>`
      SELECT ${EXPENSE_COLUMNS} ${EXPENSE_FROM} ${where} ${orderBy} LIMIT ${take} OFFSET ${skip}`;
    // Yig'ma — butun filtr bo'yicha (sahifadan qat'i nazar).
    const [summary] = await this.prisma.$queryRaw<{ count: number; totalAmount: string }[]>`
      SELECT count(*)::int AS count, coalesce(sum(e.amount), 0)::numeric(18, 2)::text AS "totalAmount"
        ${EXPENSE_FROM} ${where}`;
    return { rows, total: summary?.count ?? 0, totalAmount: summary?.totalAmount ?? '0.00' };
  }

  async find(id: string, client: Tx | PrismaService = this.prisma): Promise<ExpenseRow | null> {
    const rows = await client.$queryRaw<ExpenseRow[]>`
      SELECT ${EXPENSE_COLUMNS} ${EXPENSE_FROM} WHERE e.id = ${id}::uuid AND e.deleted_at IS NULL`;
    return rows[0] ?? null;
  }

  /** O'chirilmagan xarajat qatorini qulflaydi (tahrirlash/o'chirish poygasi). */
  async lock(
    tx: Tx,
    id: string,
  ): Promise<{
    id: string;
    date: string;
    amount: string;
    categoryId: string;
    note: string | null;
  } | null> {
    const rows = await tx.$queryRaw<
      { id: string; date: string; amount: string; categoryId: string; note: string | null }[]
    >`SELECT id, to_char(expense_date, 'YYYY-MM-DD') AS date, amount::text AS amount,
             category_id AS "categoryId", note
        FROM expenses WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
    return rows[0] ?? null;
  }

  async create(
    tx: Tx,
    data: {
      date: string;
      amount: string;
      categoryId: string;
      note: string | null;
      actorId: string;
    },
  ): Promise<string> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO expenses (expense_date, amount, category_id, note, created_by)
      VALUES (${data.date}::date, ${data.amount}::numeric, ${data.categoryId}::uuid, ${data.note},
              ${data.actorId}::uuid)
      RETURNING id`;
    return row!.id;
  }

  async update(
    tx: Tx,
    id: string,
    changes: { date?: string; amount?: string; categoryId?: string; note?: string | null },
    actorId: string,
  ): Promise<void> {
    const sets: Prisma.Sql[] = [
      Prisma.sql`updated_by = ${actorId}::uuid`,
      Prisma.sql`updated_at = now()`,
    ];
    if (changes.date !== undefined) sets.push(Prisma.sql`expense_date = ${changes.date}::date`);
    if (changes.amount !== undefined) sets.push(Prisma.sql`amount = ${changes.amount}::numeric`);
    if (changes.categoryId !== undefined) {
      sets.push(Prisma.sql`category_id = ${changes.categoryId}::uuid`);
    }
    if (changes.note !== undefined) sets.push(Prisma.sql`note = ${changes.note}`);
    await tx.$executeRaw`UPDATE expenses SET ${Prisma.join(sets, ', ')} WHERE id = ${id}::uuid`;
  }

  /** Soft delete (D-11, API §12): qator va uning moliyaviy qiymatlari bazada qoladi. */
  async softDelete(tx: Tx, id: string, actorId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE expenses
         SET deleted_at = now(), deleted_by = ${actorId}::uuid,
             updated_by = ${actorId}::uuid, updated_at = now()
       WHERE id = ${id}::uuid AND deleted_at IS NULL`;
  }

  // ─── Kategoriyalar ────────────────────────────────────────────────────────

  /** `ownerId` — faqat shu user qo'shgan kategoriyalar (sotuvchi doirasi). */
  async listCategories(filter: {
    isActive?: boolean;
    ownerId?: string;
  }): Promise<ExpenseCategoryRow[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filter.isActive !== undefined)
      conditions.push(Prisma.sql`c.is_active = ${filter.isActive}`);
    if (filter.ownerId) conditions.push(Prisma.sql`c.created_by = ${filter.ownerId}::uuid`);
    return this.prisma.$queryRaw<ExpenseCategoryRow[]>`
      SELECT ${CATEGORY_COLUMNS} FROM ${CATEGORY_FROM}
       WHERE ${Prisma.join(conditions, ' AND ')}
       ORDER BY lower(c.name), c.id`;
  }

  async findCategory(
    id: string,
    client: Tx | PrismaService = this.prisma,
  ): Promise<ExpenseCategoryRow | null> {
    const rows = await client.$queryRaw<ExpenseCategoryRow[]>`
      SELECT ${CATEGORY_COLUMNS} FROM ${CATEGORY_FROM} WHERE c.id = ${id}::uuid`;
    return rows[0] ?? null;
  }

  /**
   * Xarajatga biriktirishdan oldin: `FOR SHARE` — parallel nofaol qilish yoki o'chirish tranzaksiya
   * tugaguncha kutadi, shuning uchun nofaol kategoriyaga xarajat yozilib qolmaydi.
   */
  async shareCategory(
    tx: Tx,
    id: string,
  ): Promise<{ id: string; isActive: boolean; createdById: string } | null> {
    const rows = await tx.$queryRaw<{ id: string; isActive: boolean; createdById: string }[]>`
      SELECT id, is_active AS "isActive", created_by AS "createdById"
        FROM expense_categories WHERE id = ${id}::uuid FOR SHARE`;
    return rows[0] ?? null;
  }

  async lockCategory(
    tx: Tx,
    id: string,
  ): Promise<{ id: string; name: string; isActive: boolean; createdById: string } | null> {
    const rows = await tx.$queryRaw<
      { id: string; name: string; isActive: boolean; createdById: string }[]
    >`
      SELECT id, name, is_active AS "isActive", created_by AS "createdById" FROM expense_categories
       WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  /** Nom bitta egasi (kategoriyani qo'shgan user) ichida noyob — turli userlarda takrorlanishi mumkin. */
  async categoryNameTaken(
    tx: Tx,
    name: string,
    ownerId: string,
    exceptId?: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM expense_categories
       WHERE created_by = ${ownerId}::uuid AND lower(name) = lower(${name})
         AND (${exceptId ?? null}::uuid IS NULL OR id <> ${exceptId ?? null}::uuid)`;
    return rows.length > 0;
  }

  /** Bog'langan xarajatlar (soft-delete qilinganlari ham — FK RESTRICT ularni ham himoya qiladi). */
  async categoryUsage(tx: Tx, id: string): Promise<number> {
    return tx.expense.count({ where: { categoryId: id } });
  }

  async createCategory(tx: Tx, data: { name: string; createdById: string }): Promise<string> {
    return (await tx.expenseCategory.create({ data, select: { id: true } })).id;
  }

  async updateCategory(
    tx: Tx,
    id: string,
    data: { name?: string; isActive?: boolean },
  ): Promise<void> {
    await tx.expenseCategory.update({ where: { id }, data, select: { id: true } });
  }

  async deleteCategory(tx: Tx, id: string): Promise<void> {
    await tx.expenseCategory.delete({ where: { id } });
  }
}

function whereClause(filter: ExpenseFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`e.deleted_at IS NULL`];
  if (filter.dateFrom) conditions.push(Prisma.sql`e.expense_date >= ${filter.dateFrom}::date`);
  if (filter.dateTo) conditions.push(Prisma.sql`e.expense_date <= ${filter.dateTo}::date`);
  if (filter.categoryId) conditions.push(Prisma.sql`e.category_id = ${filter.categoryId}::uuid`);
  if (filter.createdBy) conditions.push(Prisma.sql`e.created_by = ${filter.createdBy}::uuid`);
  if (filter.search) {
    conditions.push(Prisma.sql`e.note ILIKE ${`%${escapeLike(filter.search)}%`} ESCAPE '\\'`);
  }
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}
