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

// ─── Kirim ──────────────────────────────────────────────────────────────────

// Backend shartnomasi (API §9): sxemalar shared'dan; client totallari — noma'lum maydon (400);
// narx maydonlari faqat `products.read_cost` bilan (mapper); begona yoki nofaol ombor — backend kabi.

type IncomingItemsInput = { productId: string; quantity: string; costPrice: string }[];

function assertWarehouse(warehouseId: string) {
  const s = db();
  const warehouse = s.warehouses.find((w) => w.id === warehouseId) ?? notFound();
  const me = s.users.find((u) => u.id === s.currentUserId);
  if (!currentCan(s, 'warehouses.read_all') && !me?.warehouseIds.includes(warehouseId)) {
    fail(403, 'WAREHOUSE_ACCESS_DENIED');
  }
  if (warehouse.status !== 'ACTIVE') fail(422, 'WAREHOUSE_INACTIVE');
}

/** Qatorlar: mahsulot mavjud, ACTIVE va butun/kasr siyosatiga mos; nom va shtrix-kod snapshot. */
function prepareItems(items: IncomingItemsInput) {
  const s = db();
  return items.map((item, index) => {
    const p = s.products.find((x) => x.id === item.productId);
    const field = (name: string) => formatIssuePath(['items', index, name]);
    if (!p) fail(404, 'NOT_FOUND', [{ field: field('productId'), message: 'Ma’lumot topilmadi' }]);
    if (p.status !== 'ACTIVE') {
      fail(422, 'PRODUCT_INACTIVE', [{ field: field('productId'), message: 'Mahsulot faol emas' }]);
    }
    if (!quantityAllowed(p.allowDecimal, item.quantity)) {
      fail(422, 'INVALID_QUANTITY', [
        { field: field('quantity'), message: VALIDATION_MESSAGES_UZ.wholeQuantity },
      ]);
    }
    return { id: mockUuid(), ...item, productName: p.name, barcode: p.barcode };
  });
}

const totalQuantityOf = (doc: IncomingRow) => sumQty(doc.items.map((i) => i.quantity));

function findAccessible(id: string | undefined) {
  const s = db();
  const doc = s.incoming.find((d) => d.id === id);
  const me = s.users.find((u) => u.id === s.currentUserId);
  const visible =
    doc && (currentCan(s, 'warehouses.read_all') || me?.warehouseIds.includes(doc.warehouseId));
  return visible ? doc : notFound();
}

function requireCan(permission: Parameters<typeof currentCan>[1]) {
  if (!currentCan(db(), permission)) fail(403, 'FORBIDDEN');
}

route('GET', '/incoming', ({ query }) => {
  requireCan('incoming.read');
  const s = db();
  if (!currentCan(s, 'products.read_cost') && query.sort?.startsWith('totalAmount')) {
    fail(400, 'VALIDATION_ERROR', [{ field: 'sort', message: VALIDATION_MESSAGES_UZ.invalidSort }]);
  }
  const me = s.users.find((u) => u.id === s.currentUserId);
  const readAll = currentCan(s, 'warehouses.read_all');
  const list = s.incoming
    .filter((d) => readAll || Boolean(me?.warehouseIds.includes(d.warehouseId)))
    .filter((d) => !query.status || d.status === query.status)
    .filter((d) => !query.productId || d.items.some((i) => i.productId === query.productId))
    .filter((d) => !query.warehouseId || d.warehouseId === query.warehouseId)
    .filter((d) => dateOnlyInRange(d.date, query.dateFrom, query.dateTo))
    .filter((d) => includesText([formatDocNumber('K', d.number), d.notes], query.search))
    .map((d) => toIncomingDto(s, d));
  const sorted = sortBy(
    list,
    query.sort,
    {
      date: (d) => `${d.date}|${d.number}`,
      totalAmount: (d) => num(d.totalAmount ?? '0'),
      totalQuantity: (d) => num(d.totalQuantity),
    },
    'date:desc',
  );
  return paginate(sorted, query);
});

route('GET', '/incoming/:id', ({ params }) => {
  requireCan('incoming.read');
  return toIncomingDto(db(), findAccessible(params.id), true);
});

route('POST', '/incoming', ({ body }) => {
  requireCan('incoming.manage');
  const input = validate(incomingCreateSchema, body);
  assertWarehouse(input.warehouseId);
  const items = prepareItems(input.items);
  const s = db();
  s.counters.incoming += 1;
  const at = now();
  const doc: IncomingRow = {
    id: mockUuid(),
    number: s.counters.incoming,
    date: input.date,
    warehouseId: input.warehouseId,
    notes: input.notes ?? null,
    status: 'DRAFT',
    items,
    createdBy: s.currentUserId,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  s.incoming.push(doc);
  recordAudit({
    action: 'INCOMING_CREATED',
    entityType: 'INCOMING',
    entityId: doc.id,
    metadata: {
      number: doc.number,
      warehouseId: doc.warehouseId,
      date: doc.date,
      itemsCount: items.length,
      totalQuantity: totalQuantityOf(doc),
    },
  });
  return toIncomingDto(s, doc, true);
});

route('PATCH', '/incoming/:id', ({ params, body }) => {
  requireCan('incoming.manage');
  const s = db();
  const doc = findAccessible(params.id);
  if (doc.status !== 'DRAFT') fail(409, 'INCOMING_NOT_DRAFT');
  const input = validate(incomingUpdateSchema, body);
  assertWarehouse(input.warehouseId ?? doc.warehouseId);
  const items = input.items ? prepareItems(input.items) : doc.items;
  const before = { ...doc };
  if (input.date !== undefined) doc.date = input.date;
  if (input.warehouseId !== undefined) doc.warehouseId = input.warehouseId;
  if (input.notes !== undefined) doc.notes = input.notes;
  doc.items = items;
  doc.updatedAt = now();
  const changes = diffChanges(before, doc, ['date', 'warehouseId', 'notes']);
  if (hasChanges(changes) || input.items !== undefined) {
    const from = { itemsCount: before.items.length, totalQuantity: totalQuantityOf(before) };
    const to = { itemsCount: doc.items.length, totalQuantity: totalQuantityOf(doc) };
    recordAudit({
      action: 'INCOMING_UPDATED',
      entityType: 'INCOMING',
      entityId: doc.id,
      metadata: {
        number: doc.number,
        changes,
        ...(input.items !== undefined
          ? {
              items: {
                replaced: true,
                totalsChanged: JSON.stringify(from) !== JSON.stringify(to),
                from,
                to,
              },
            }
          : {}),
      },
    });
  }
  return toIncomingDto(s, doc, true);
});

route('POST', '/incoming/:id/confirm', ({ params }) => {
  requireCan('incoming.confirm');
  const s = db();
  const doc = findAccessible(params.id);
  // Shartli holat o'tishi: takroriy tasdiqlash qoldiqni ikki marta oshirmaydi (idempotent).
  if (doc.status !== 'DRAFT') fail(409, 'INCOMING_NOT_DRAFT');
  if (doc.items.length === 0) fail(422, 'INCOMING_EMPTY');
  assertWarehouse(doc.warehouseId);
  // Mahsulotlar qoralamadan keyin o'zgargan bo'lishi mumkin — tasdiqlashda qayta tekshiriladi.
  prepareItems(doc.items);
  const at = now();
  for (const item of [...doc.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
    postMovement(s, {
      warehouseId: doc.warehouseId,
      productId: item.productId,
      type: 'INCOMING',
      quantity: item.quantity,
      referenceId: doc.id,
      referenceNumber: formatDocNumber('K', doc.number),
      userId: s.currentUserId,
      createdAt: at,
    });
  }
  doc.status = 'CONFIRMED';
  doc.confirmedBy = s.currentUserId;
  doc.confirmedAt = at;
  doc.updatedAt = at;
  recordAudit({
    action: 'INCOMING_CONFIRMED',
    entityType: 'INCOMING',
    entityId: doc.id,
    metadata: {
      number: doc.number,
      warehouseId: doc.warehouseId,
      itemsCount: doc.items.length,
      totalQuantity: totalQuantityOf(doc),
      totalAmount: sumMoney(doc.items.map((i) => lineTotal(i.quantity, i.costPrice))),
    },
  });
  return toIncomingDto(s, doc, true);
});

route('POST', '/incoming/:id/cancel', ({ params }) => {
  requireCan('incoming.manage');
  const s = db();
  const doc = findAccessible(params.id);
  if (doc.status !== 'DRAFT') fail(409, 'INCOMING_NOT_DRAFT');
  doc.status = 'CANCELLED';
  doc.cancelledBy = s.currentUserId;
  doc.cancelledAt = now();
  doc.updatedAt = now();
  recordAudit({
    action: 'INCOMING_CANCELLED',
    entityType: 'INCOMING',
    entityId: doc.id,
    metadata: { number: doc.number, warehouseId: doc.warehouseId },
  });
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
