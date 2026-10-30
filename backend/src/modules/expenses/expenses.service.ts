import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  type ExpenseCategoryCreateInput,
  type ExpenseCategoryDto,
  type ExpenseCategoryUpdateInput,
  type ExpenseCreateInput,
  type ExpenseDto,
  type ExpensesListResponse,
  type ExpenseUpdateInput,
  isExpenseDateAllowed,
  Permission,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import { type AccessContext, hasPermission } from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { Clock } from '../../common/time/clock.js';
import { tashkentToday } from '../../common/time/tashkent-time.js';
import { TransactionRunner, type Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import {
  type ExpenseCategoryRow,
  type ExpenseRow,
  ExpensesRepository,
  type ListExpensesQuery,
} from './expenses.repository.js';

export function toExpenseDto(row: ExpenseRow): ExpenseDto {
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    category: { id: row.categoryId, name: row.categoryName },
    note: row.note,
    createdBy: { id: row.createdById, login: row.createdByLogin, fullName: row.createdByFullName },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Kategoriya serializeri (D-19): ro'yxatni ko'rmaydigan sotuvchi (`expenses.create`) faqat `id, name`
 * ni oladi — holat, xarajatlar soni va sanalar kaliti umuman yo'q.
 */
export function toExpenseCategoryDto(row: ExpenseCategoryRow, full: boolean): ExpenseCategoryDto {
  if (!full) return { id: row.id, name: row.name };
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    expenseCount: row.expenseCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type Change = { from: unknown; to: unknown };

/**
 * Xarajatlar (Phase 11, API §12; D-01, D-11, D-12, D-19; BR-31, BR-32).
 * - Kategoriya majburiy va yangi biriktirilganda faol bo'lishi shart; sana Toshkent bo'yicha bugundan keyin emas.
 * - Holat yo'q (D-11). O'chirish — soft delete: moliyaviy qator bazada qoladi, ro'yxat va yig'madan chiqadi.
 * - Audit'da izoh matni yozilmaydi (shaxsiy ma'lumot bo'lishi mumkin) — faqat `hasNote`/maydon nomi.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly repository: ExpensesRepository,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(query: ListExpensesQuery): Promise<ExpensesListResponse> {
    const { rows, total, totalAmount } = await this.repository.list(query);
    return {
      ...toPaginated(rows.map(toExpenseDto), total, query),
      summary: { count: total, totalAmount },
    };
  }

  async get(id: string): Promise<ExpenseDto> {
    return toExpenseDto((await this.repository.find(id)) ?? notFound());
  }

  async create(
    ctx: AccessContext,
    input: ExpenseCreateInput,
    meta: RequestMeta,
  ): Promise<ExpenseDto> {
    this.assertDateAllowed(input.date);
    return this.transactions.run(async (tx) => {
      await this.assertCategoryUsable(tx, input.categoryId);
      const note = input.note ?? null;
      const id = await this.repository.create(tx, {
        date: input.date,
        amount: input.amount,
        categoryId: input.categoryId,
        note,
        actorId: ctx.userId,
      });
      const row = (await this.repository.find(id, tx)) ?? notFound();
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.EXPENSE_CREATED,
          entityType: AuditEntityType.EXPENSE,
          entityId: id,
          metadata: {
            date: row.date,
            amount: row.amount,
            categoryId: row.categoryId,
            hasNote: note !== null,
          },
          meta,
        },
        tx,
      );
      return toExpenseDto(row);
    });
  }

  /** Qisman tahrirlash: faqat yuborilgan va haqiqatan o'zgargan maydonlar yoziladi va audit'ga tushadi. */
  async update(
    ctx: AccessContext,
    id: string,
    input: ExpenseUpdateInput,
    meta: RequestMeta,
  ): Promise<ExpenseDto> {
    return this.transactions.run(async (tx) => {
      const current = (await this.repository.lock(tx, id)) ?? notFound();
      const changes: { date?: string; amount?: string; categoryId?: string; note?: string | null } =
        {};
      const audited: Record<string, Change> = {};
      if (input.date !== undefined && input.date !== current.date) {
        this.assertDateAllowed(input.date);
        changes.date = input.date;
        audited.date = { from: current.date, to: input.date };
      }
      if (input.amount !== undefined && !sameMoney(input.amount, current.amount)) {
        changes.amount = input.amount;
      }
      if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
        await this.assertCategoryUsable(tx, input.categoryId);
        changes.categoryId = input.categoryId;
        audited.categoryId = { from: current.categoryId, to: input.categoryId };
      }
      if (input.note !== undefined && input.note !== current.note) changes.note = input.note;
      const fields = Object.keys(changes);
      if (fields.length > 0) {
        await this.repository.update(tx, id, changes, ctx.userId);
        const row = (await this.repository.find(id, tx)) ?? notFound();
        if (changes.amount !== undefined) audited.amount = { from: current.amount, to: row.amount };
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.EXPENSE_UPDATED,
            entityType: AuditEntityType.EXPENSE,
            entityId: id,
            metadata: { fields, changes: audited },
            meta,
          },
          tx,
        );
        return toExpenseDto(row);
      }
      return toExpenseDto((await this.repository.find(id, tx)) ?? notFound());
    });
  }

  async delete(ctx: AccessContext, id: string, meta: RequestMeta): Promise<void> {
    await this.transactions.run(async (tx) => {
      const current = (await this.repository.lock(tx, id)) ?? notFound();
      await this.repository.softDelete(tx, id, ctx.userId);
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.EXPENSE_DELETED,
          entityType: AuditEntityType.EXPENSE,
          entityId: id,
          metadata: { date: current.date, amount: current.amount, categoryId: current.categoryId },
          meta,
        },
        tx,
      );
    });
  }

  // ─── Kategoriyalar ────────────────────────────────────────────────────────

  /** Ro'yxat ko'ruvchi/boshqaruvchi — hammasi (filtr bilan); faqat qo'shuvchi — faqat faollari, minimal. */
  async listCategories(
    ctx: AccessContext,
    filter: { isActive?: boolean },
  ): Promise<ExpenseCategoryDto[]> {
    const full =
      hasPermission(ctx, Permission.EXPENSES_READ) ||
      hasPermission(ctx, Permission.EXPENSES_MANAGE);
    const rows = await this.repository.listCategories(full ? filter : { isActive: true });
    return rows.map((row) => toExpenseCategoryDto(row, full));
  }

  async createCategory(
    ctx: AccessContext,
    input: ExpenseCategoryCreateInput,
    meta: RequestMeta,
  ): Promise<ExpenseCategoryDto> {
    return this.transactions.run(async (tx) => {
      if (await this.repository.categoryNameTaken(tx, input.name)) throw nameTaken();
      const id = await this.repository.createCategory(tx, {
        name: input.name,
        createdById: ctx.userId,
      });
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.EXPENSE_CATEGORY_CREATED,
          entityType: AuditEntityType.EXPENSE_CATEGORY,
          entityId: id,
          metadata: { name: input.name },
          meta,
        },
        tx,
      );
      return toExpenseCategoryDto((await this.repository.findCategory(id, tx)) ?? notFound(), true);
    });
  }

  async updateCategory(
    ctx: AccessContext,
    id: string,
    input: ExpenseCategoryUpdateInput,
    meta: RequestMeta,
  ): Promise<ExpenseCategoryDto> {
    return this.transactions.run(async (tx) => {
      const category = (await this.repository.lockCategory(tx, id)) ?? notFound();
      const changes: Record<string, Change> = {};
      if (input.name !== undefined && input.name !== category.name) {
        if (await this.repository.categoryNameTaken(tx, input.name, id)) throw nameTaken();
        changes.name = { from: category.name, to: input.name };
      }
      if (input.isActive !== undefined && input.isActive !== category.isActive) {
        changes.isActive = { from: category.isActive, to: input.isActive };
      }
      if (Object.keys(changes).length > 0) {
        await this.repository.updateCategory(
          tx,
          id,
          Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.to])),
        );
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.EXPENSE_CATEGORY_UPDATED,
            entityType: AuditEntityType.EXPENSE_CATEGORY,
            entityId: id,
            metadata: { name: input.name ?? category.name, changes },
            meta,
          },
          tx,
        );
      }
      return toExpenseCategoryDto((await this.repository.findCategory(id, tx)) ?? notFound(), true);
    });
  }

  /** BR-31: faqat hech bir xarajatga (soft-delete qilinganlari ham) bog'lanmagan kategoriya o'chiriladi. */
  async deleteCategory(ctx: AccessContext, id: string, meta: RequestMeta): Promise<void> {
    await this.transactions.run(async (tx) => {
      const category = (await this.repository.lockCategory(tx, id)) ?? notFound();
      if ((await this.repository.categoryUsage(tx, id)) > 0) {
        throw new AppError(ErrorCode.ENTITY_IN_USE);
      }
      await this.repository.deleteCategory(tx, id);
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.EXPENSE_CATEGORY_DELETED,
          entityType: AuditEntityType.EXPENSE_CATEGORY,
          entityId: id,
          metadata: { name: category.name },
          meta,
        },
        tx,
      );
    });
  }

  private assertDateAllowed(date: string): void {
    if (!isExpenseDateAllowed(date, tashkentToday(this.clock.now()))) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'date', message: VALIDATION_MESSAGES_UZ.expenseDateInFuture }],
      });
    }
  }

  /** Kategoriya mavjud (`404`) va faol (`422 EXPENSE_CATEGORY_INACTIVE`) bo'lishi shart (D-19). */
  private async assertCategoryUsable(tx: Tx, categoryId: string): Promise<void> {
    const category = await this.repository.shareCategory(tx, categoryId);
    if (!category) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        details: [{ field: 'categoryId', message: ERROR_MESSAGES_UZ.NOT_FOUND }],
      });
    }
    if (!category.isActive) {
      throw new AppError(ErrorCode.EXPENSE_CATEGORY_INACTIVE, {
        details: [{ field: 'categoryId', message: ERROR_MESSAGES_UZ.EXPENSE_CATEGORY_INACTIVE }],
      });
    }
  }
}

/** `"100"` va `"100.00"` — bir xil summa (o'zgarish emas). */
function sameMoney(a: string, b: string): boolean {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  return BigInt(ai) === BigInt(bi) && af.padEnd(2, '0') === bf.padEnd(2, '0');
}

function notFound(): never {
  throw new AppError(ErrorCode.NOT_FOUND);
}

function nameTaken(): AppError {
  return new AppError(ErrorCode.NAME_TAKEN, {
    details: [{ field: 'name', message: ERROR_MESSAGES_UZ.NAME_TAKEN }],
  });
}
