import {
  VALIDATION_MESSAGES_UZ,
  expenseCategoryCreateSchema,
  expenseCategoryUpdateSchema,
  expenseCreateSchema,
  expenseUpdateSchema,
  formatIssuePath,
  incomingCreateSchema,
  incomingUpdateSchema,
  isExpenseDateAllowed,
} from '@divine/shared';
import { lineTotal, sumMoney, sumQty } from '@/shared/lib/decimal';
import type { ExpensesListResponse } from '@/shared/types/api';
import { diffChanges, hasChanges, recordAudit } from '../audit';
import { db } from '../db';
import { formatDocNumber, postMovement } from '../inventory';
import { fail, includesText, notFound, num, paginate, route, sortBy, validate } from '../lib/http';
import { mockUuid } from '../lib/random';
import { dateOnlyInRange } from '../lib/time';
import { currentCan, toExpenseCategoryDto, toExpenseDto, toIncomingDto } from '../mappers';
import type { IncomingRow } from '../state';
import { quantityAllowed } from './catalog';
import { mockToday, nowIso } from '../lib/clock';

const now = nowIso;

  return toIncomingDto(s, doc, true);
});

// ─── Xarajatlar ─────────────────────────────────────────────────────────────

// Backend shartnomasi (API §12; D-11, D-12, D-19): sxemalar shared'dan; kategoriya majburiy va faol;
// sana Toshkent bo'yicha bugundan keyin emas; holat yo'q; o'chirish — soft delete.

const EXPENSE_SORTS = new Set(['date', 'amount']);

function expenseOrFail(id: string | undefined) {
  return db().expenses.find((x) => x.id === id && !x.deletedAt) ?? notFound();
}

function assertExpenseDate(date: string) {
  if (!isExpenseDateAllowed(date, mockToday())) {
    fail(400, 'VALIDATION_ERROR', [
      { field: 'date', message: VALIDATION_MESSAGES_UZ.expenseDateInFuture },
    ]);
  }
}

function assertCategoryUsable(categoryId: string) {
  const c = db().expenseCategories.find((x) => x.id === categoryId);
  if (!c) fail(404, 'NOT_FOUND', [{ field: 'categoryId', message: 'Ma’lumot topilmadi' }]);
  if (!c.isActive) {
    fail(422, 'EXPENSE_CATEGORY_INACTIVE', [
      { field: 'categoryId', message: 'Xarajat kategoriyasi faol emas' },
    ]);
  }
}

function categoryNameTaken(name: string, exceptId?: string) {
  const lower = name.toLocaleLowerCase('uz');
  return db().expenseCategories.some(
    (c) => c.id !== exceptId && c.name.toLocaleLowerCase('uz') === lower,
  );
}

const nameTakenFail = () =>
  fail(409, 'NAME_TAKEN', [{ field: 'name', message: 'Bu nom allaqachon mavjud' }]);

route('GET', '/expense-categories', ({ query }) => {
  const s = db();
  if (
    !currentCan(s, 'expenses.read') &&
    !currentCan(s, 'expenses.create') &&
    !currentCan(s, 'expenses.manage')
  ) {
    fail(403, 'FORBIDDEN');
  }
  const full = currentCan(s, 'expenses.read') || currentCan(s, 'expenses.manage');
  const isActive = full
    ? query.isActive === 'true'
      ? true
      : query.isActive === 'false'
        ? false
        : undefined
    : true;
  return s.expenseCategories
    .filter((c) => isActive === undefined || c.isActive === isActive)
    .sort((a, b) => a.name.localeCompare(b.name, 'uz'))
    .map((c) => toExpenseCategoryDto(s, c, full));
});

route('POST', '/expense-categories', ({ body }) => {
  requireCan('expenses.manage');
  const input = validate(expenseCategoryCreateSchema, body);
  if (categoryNameTaken(input.name)) nameTakenFail();
  const s = db();
  const at = now();
  const row = { id: mockUuid(), name: input.name, isActive: true, createdAt: at, updatedAt: at };
  s.expenseCategories.push(row);
  recordAudit({
    action: 'EXPENSE_CATEGORY_CREATED',
    entityType: 'EXPENSE_CATEGORY',
    entityId: row.id,
    metadata: { name: row.name },
  });
  return toExpenseCategoryDto(s, row, true);
});

route('PATCH', '/expense-categories/:id', ({ params, body }) => {
  requireCan('expenses.manage');
  const input = validate(expenseCategoryUpdateSchema, body);
  const s = db();
  const c = s.expenseCategories.find((x) => x.id === params.id) ?? notFound();
  if (input.name !== undefined && input.name !== c.name && categoryNameTaken(input.name, c.id)) {
    nameTakenFail();
  }
  const changed =
    (input.name !== undefined && input.name !== c.name) ||
    (input.isActive !== undefined && input.isActive !== c.isActive);
  if (changed) {
    const before = { ...c };
    Object.assign(c, {
      name: input.name ?? c.name,
      isActive: input.isActive ?? c.isActive,
      updatedAt: now(),
    });
    recordAudit({
      action: 'EXPENSE_CATEGORY_UPDATED',
      entityType: 'EXPENSE_CATEGORY',
      entityId: c.id,
      metadata: { name: c.name, changes: diffChanges(before, c, ['name', 'isActive']) },
    });
  }
  return toExpenseCategoryDto(s, c, true);
});

route('DELETE', '/expense-categories/:id', ({ params }) => {
  requireCan('expenses.manage');
  const s = db();
  const c = s.expenseCategories.find((x) => x.id === params.id) ?? notFound();
  // BR-31: soft-delete qilingan xarajat ham kategoriyani band qiladi (backend'da FK RESTRICT).
  if (s.expenses.some((e) => e.categoryId === c.id)) fail(409, 'ENTITY_IN_USE');
  s.expenseCategories = s.expenseCategories.filter((x) => x.id !== c.id);
  recordAudit({
    action: 'EXPENSE_CATEGORY_DELETED',
    entityType: 'EXPENSE_CATEGORY',
    entityId: c.id,
    metadata: { name: c.name },
  });
  return undefined;
});

route('GET', '/expenses', ({ query }): ExpensesListResponse => {
  requireCan('expenses.read');
  const [sortField = ''] = (query.sort ?? '').split(':');
  if (query.sort && !EXPENSE_SORTS.has(sortField)) {
    fail(400, 'VALIDATION_ERROR', [{ field: 'sort', message: VALIDATION_MESSAGES_UZ.invalidSort }]);
  }
  const s = db();
  const list = s.expenses
    .filter((e) => !e.deletedAt)
    .filter((e) => !query.categoryId || e.categoryId === query.categoryId)
    .filter((e) => !query.createdBy || e.createdBy === query.createdBy)
    .filter((e) => dateOnlyInRange(e.date, query.dateFrom, query.dateTo))
    .filter((e) => includesText([e.note], query.search));
  const sorted = sortBy(
    list,
    query.sort,
    {
      date: (e) => `${e.date}|${e.createdAt}`,
      amount: (e) => num(e.amount),
    },
    'date:desc',
  );
  const page = paginate(sorted, query);
  return {
    data: page.data.map((e) => toExpenseDto(s, e)),
    meta: page.meta,
    summary: {
      count: list.length,
      totalAmount: sumMoney(list.map((e) => e.amount)),
    },
  };
});

route('GET', '/expenses/:id', ({ params }) => {
  requireCan('expenses.read');
  return toExpenseDto(db(), expenseOrFail(params.id));
});

route('POST', '/expenses', ({ body }) => {
  const s = db();
  if (!currentCan(s, 'expenses.create') && !currentCan(s, 'expenses.manage')) {
    fail(403, 'FORBIDDEN');
  }
  const input = validate(expenseCreateSchema, body);
  assertExpenseDate(input.date);
  assertCategoryUsable(input.categoryId);
  const at = now();
  const row = {
    id: mockUuid(),
    date: input.date,
    amount: sumMoney([input.amount]),
    categoryId: input.categoryId,
    note: input.note ?? null,
    createdBy: s.currentUserId,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  s.expenses.push(row);
  // Izoh matni audit'ga yozilmaydi (Phase 11) — faqat bor-yo'qligi.
  recordAudit({
    action: 'EXPENSE_CREATED',
    entityType: 'EXPENSE',
    entityId: row.id,
    metadata: {
      date: row.date,
      amount: row.amount,
      categoryId: row.categoryId,
      hasNote: row.note !== null,
    },
  });
  return toExpenseDto(s, row);
});

// Qisman: faqat yuborilgan va o'zgargan maydonlar yoziladi (backend kabi).
route('PATCH', '/expenses/:id', ({ params, body }) => {
  requireCan('expenses.manage');
  const input = validate(expenseUpdateSchema, body);
  const s = db();
  const e = expenseOrFail(params.id);
  const changes: Partial<typeof e> = {};
  if (input.date !== undefined && input.date !== e.date) {
    assertExpenseDate(input.date);
    changes.date = input.date;
  }
  if (input.amount !== undefined && sumMoney([input.amount]) !== sumMoney([e.amount])) {
    changes.amount = sumMoney([input.amount]);
  }
  if (input.categoryId !== undefined && input.categoryId !== e.categoryId) {
    assertCategoryUsable(input.categoryId);
    changes.categoryId = input.categoryId;
  }
  if (input.note !== undefined && input.note !== e.note) changes.note = input.note;
  if (Object.keys(changes).length > 0) {
    const before = { ...e };
    Object.assign(e, changes, { updatedAt: now(), updatedBy: s.currentUserId });
    recordAudit({
      action: 'EXPENSE_UPDATED',
      entityType: 'EXPENSE',
      entityId: e.id,
      // `note` — faqat maydon nomi `fields`da; matni yozilmaydi.
      metadata: {
        fields: Object.keys(changes),
        changes: diffChanges(before, e, ['date', 'categoryId', 'amount']),
      },
    });
  }
  return toExpenseDto(s, e);
});

route('DELETE', '/expenses/:id', ({ params }) => {
  requireCan('expenses.manage');
  const s = db();
  const e = expenseOrFail(params.id);
  e.deletedAt = now();
  e.deletedBy = s.currentUserId;
  recordAudit({
    action: 'EXPENSE_DELETED',
    entityType: 'EXPENSE',
    entityId: e.id,
    metadata: { date: e.date, amount: e.amount, categoryId: e.categoryId },
  });
  return undefined;
});
