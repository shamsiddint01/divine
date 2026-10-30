import {
  ErrorCode,
  VALIDATION_MESSAGES_UZ,
  warehouseCreateSchema,
  warehouseStatusSchema,
  warehouseUpdateSchema,
} from '@divine/shared';
import { compareQty, lineTotal, sumQty } from '@/shared/lib/decimal';
import type { StockRowDto, WarehouseDetailDto } from '@/shared/types/api';
import { db } from '../db';
import { diffChanges, hasChanges, recordAudit } from '../audit';
import { getStock } from '../inventory';
import { fail, includesText, notFound, num, paginate, route, sortBy, validate } from '../lib/http';
import { mockUuid } from '../lib/random';
import { addDays, inDateRange, tashkentDate } from '../lib/time';
import {
  currentCan,
  thresholdOf,
  toMovementDto,
  toWarehouseBaseDto,
  toWarehouseDto,
} from '../mappers';
import { mockToday, nowIso } from '../lib/clock';

const now = nowIso;
const lower = (s: string) => s.toLocaleLowerCase('uz');

// Backend shartnomasi (API §7): sxemalar shared'dan; USER — faqat biriktirilgan ACTIVE omborlar
// asosiy maydonlar bilan (OWN-01); detal, qoldiq, harakatlar — `warehouses.read_all`.

function assertReadAll() {
  if (!currentCan(db(), 'warehouses.read_all')) fail(403, ErrorCode.FORBIDDEN);
}

route('GET', '/warehouses', ({ query }) => {
  const s = db();
  const readAll = currentCan(s, 'warehouses.read_all');
  const me = s.users.find((u) => u.id === s.currentUserId);
  const list = s.warehouses
    .filter((w) => readAll || (w.status === 'ACTIVE' && Boolean(me?.warehouseIds.includes(w.id))))
    .filter((w) => includesText([w.name, w.address], query.search))
    .filter((w) => !readAll || !query.status || w.status === query.status)
    .map((w) => (readAll ? toWarehouseDto(s, w) : toWarehouseBaseDto(w)));
  return paginate(
    sortBy(
      list,
      query.sort,
      { name: (w) => w.name, createdAt: (w) => w.createdAt },
      'createdAt:asc',
    ),
    query,
  );
});

route('GET', '/warehouses/:id', ({ params }): WarehouseDetailDto => {
  assertReadAll();
  const s = db();
  const w = s.warehouses.find((x) => x.id === params.id) ?? notFound();
  const since = addDays(mockToday(), -29);
  const recent = s.movements.filter(
    (m) => m.warehouseId === w.id && tashkentDate(m.createdAt) >= since,
  );
  return {
    ...toWarehouseDto(s, w),
    incoming30: sumQty(recent.filter((m) => m.type === 'INCOMING').map((m) => m.quantity)),
    outgoing30: sumQty(
      recent.filter((m) => m.type === 'SALE').map((m) => m.quantity.replace('-', '')),
    ),
  };
});

route('POST', '/warehouses', ({ body }) => {
  const input = validate(warehouseCreateSchema, body);
  const s = db();
  if (s.warehouses.some((w) => lower(w.name) === lower(input.name)))
    fail(409, 'NAME_TAKEN', [{ field: 'name', message: 'Bu nom allaqachon mavjud' }]);
  const at = now();
  const row = {
    id: mockUuid(),
    name: input.name,
    address: input.address ?? null,
    status: 'ACTIVE' as const,
    createdAt: at,
    updatedAt: at,
  };
  s.warehouses.push(row);
  recordAudit({
    action: 'WAREHOUSE_CREATED',
    entityType: 'WAREHOUSE',
    entityId: row.id,
    metadata: { name: row.name, address: row.address },
  });
  return toWarehouseBaseDto(row);
});

route('PATCH', '/warehouses/:id', ({ params, body }) => {
  const input = validate(warehouseUpdateSchema, body);
  const s = db();
  const w = s.warehouses.find((x) => x.id === params.id) ?? notFound();
  if (
    input.name &&
    s.warehouses.some((x) => x.id !== w.id && lower(x.name) === lower(input.name ?? ''))
  ) {
    fail(409, 'NAME_TAKEN', [{ field: 'name', message: 'Bu nom allaqachon mavjud' }]);
  }
  const before = { ...w };
  if (input.name !== undefined) w.name = input.name;
  if (input.address !== undefined) w.address = input.address;
  const changes = diffChanges(before, w, ['name', 'address']);
  if (hasChanges(changes)) {
    recordAudit({
      action: 'WAREHOUSE_UPDATED',
      entityType: 'WAREHOUSE',
      entityId: w.id,
      metadata: { name: w.name, changes },
    });
  }
  w.updatedAt = now();
  return toWarehouseBaseDto(w);
});

route('PATCH', '/warehouses/:id/status', ({ params, body }) => {
  const input = validate(warehouseStatusSchema, body);
  const s = db();
  const w = s.warehouses.find((x) => x.id === params.id) ?? notFound();
  if (w.status !== input.status) {
    recordAudit({
      action: 'WAREHOUSE_STATUS_CHANGED',
      entityType: 'WAREHOUSE',
      entityId: w.id,
      metadata: {
        name: w.name,
        from: w.status,
        to: input.status,
        assignedUsers: s.users.filter((u) => u.warehouseIds.includes(w.id)).length,
        productsInStock: Object.entries(s.stock).filter(
          ([key, qty]) => key.startsWith(`${w.id}|`) && Number(qty) > 0,
        ).length,
      },
    });
    w.status = input.status;
    w.updatedAt = now();
  }
  return toWarehouseBaseDto(w);
});

route('GET', '/warehouses/:id/stock', ({ params, query }) => {
  assertReadAll();
  const s = db();
  const canReadCost = currentCan(s, 'products.read_cost');
  if (!canReadCost && query.sort?.startsWith('stockValue')) {
    fail(400, ErrorCode.VALIDATION_ERROR, [
      { field: 'sort', message: VALIDATION_MESSAGES_UZ.invalidSort },
    ]);
  }
  const w = s.warehouses.find((x) => x.id === params.id) ?? notFound();
  let rows: StockRowDto[] = s.products
    .filter((p) => s.stock[`${w.id}|${p.id}`] !== undefined)
    .filter((p) => includesText([p.name, p.barcode], query.search))
    .filter((p) => !query.groupId || p.groupId === query.groupId)
    .map((p) => {
      const quantity = getStock(s, w.id, p.id);
      const threshold = thresholdOf(s, p);
      const lastMove = s.movements.findLast((m) => m.warehouseId === w.id && m.productId === p.id);
      return {
        productId: p.id,
        productName: p.name,
        groupName: s.groups.find((g) => g.id === p.groupId)?.name ?? '—',
        barcode: p.barcode,
        unit: p.unit,
        quantity,
        minStock: threshold,
        ...(canReadCost
          ? { costPrice: p.costPrice, stockValue: lineTotal(quantity, p.costPrice) }
          : {}),
        salePrice: p.salePrice,
        isLowStock: p.status === 'ACTIVE' && compareQty(quantity, threshold) <= 0,
        updatedAt: lastMove?.createdAt ?? p.updatedAt,
      };
    });
  if (query.stock === 'low') rows = rows.filter((r) => r.isLowStock);
  if (query.stock === 'out') rows = rows.filter((r) => compareQty(r.quantity, '0') <= 0);
  const sorted = sortBy(
    rows,
    query.sort,
    {
      productName: (r) => r.productName,
      quantity: (r) => num(r.quantity),
      stockValue: (r) => num(r.stockValue ?? '0'),
      updatedAt: (r) => r.updatedAt,
    },
    'productName:asc',
  );
  return paginate(sorted, query);
});

route('GET', '/warehouses/:id/movements', ({ params, query }) => {
  assertReadAll();
  const s = db();
  const w = s.warehouses.find((x) => x.id === params.id) ?? notFound();
  const productIds = query.search
    ? new Set(
        s.products.filter((p) => includesText([p.name, p.barcode], query.search)).map((p) => p.id),
      )
    : null;
  const list = s.movements
    .filter((m) => m.warehouseId === w.id)
    .filter((m) => !query.movementType || m.type === query.movementType)
    .filter((m) => !productIds || productIds.has(m.productId))
    .filter((m) => inDateRange(m.createdAt, query.dateFrom, query.dateTo))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const page = paginate(list, query);
  return { ...page, data: page.data.map((m) => toMovementDto(s, m)) };
});
