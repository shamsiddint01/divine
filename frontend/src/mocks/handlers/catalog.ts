import {
  isWholeQuantity,
  productCreateSchema,
  productGroupCreateSchema,
  productGroupUpdateSchema,
  productStatusSchema,
  productUpdateSchema,
} from '@divine/shared';
import { compareQty, lineTotal, subMoney, sumMoney } from '@/shared/lib/decimal';
import type { ProductGroupDto, ProductSummaryDto } from '@/shared/types/api';
import { db } from '../db';
import { formatDocNumber } from '../inventory';
import { fail, includesText, notFound, num, paginate, route, sortBy, validate } from '../lib/http';
import { mockUuid } from '../lib/random';
import { diffChanges, hasChanges, recordAudit } from '../audit';
import { currentCan, productTotals, toProductDto } from '../mappers';
import { nowIso } from '../lib/clock';
import { assertReceivable, receiveStock, requireReceivePermission } from '../stock-receipt';

const now = nowIso;
const lower = (s: string) => s.toLocaleLowerCase('uz');

// ─── Mahsulot guruhlari ─────────────────────────────────────────────────────

function groupDto(id: string): ProductGroupDto {
  const s = db();
  const g = s.groups.find((x) => x.id === id) ?? notFound();
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    isActive: g.isActive,
    productCount: s.products.filter((p) => p.groupId === g.id).length,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

route('GET', '/product-groups', ({ query }) => {
  const s = db();
  // Backend kabi: boshqarish huquqi yo'q user (sotuvchi) faqat faol guruhlarni ko'radi.
  const isActive = currentCan(s, 'product_groups.manage')
    ? query.isActive
      ? query.isActive === 'true'
      : undefined
    : true;
  const list = s.groups
    .filter((g) => includesText([g.name, g.description], query.search))
    .filter((g) => isActive === undefined || g.isActive === isActive)
    .map((g) => groupDto(g.id));
  const sorted = sortBy(
    list,
    query.sort,
    {
      name: (g) => g.name,
      productCount: (g) => g.productCount,
      createdAt: (g) => g.createdAt,
    },
    'name:asc',
  );
  return paginate(sorted, query);
});

route('POST', '/product-groups', ({ body }) => {
  const input = validate(productGroupCreateSchema, body);
  const s = db();
  if (s.groups.some((g) => lower(g.name) === lower(input.name)))
    fail(409, 'NAME_TAKEN', [{ field: 'name', message: 'Bu nom allaqachon mavjud' }]);
  const at = now();
  const row = {
    id: mockUuid(),
    name: input.name,
    description: input.description ?? null,
    isActive: true,
    createdAt: at,
    updatedAt: at,
  };
  s.groups.push(row);
  recordAudit({
    action: 'PRODUCT_GROUP_CREATED',
    entityType: 'PRODUCT_GROUP',
    entityId: row.id,
    metadata: { name: input.name },
  });
  return groupDto(row.id);
});

route('PATCH', '/product-groups/:id', ({ params, body }) => {
  const input = validate(productGroupUpdateSchema, body);
  const s = db();
  const g = s.groups.find((x) => x.id === params.id) ?? notFound();
  if (
    input.name &&
    s.groups.some((x) => x.id !== g.id && lower(x.name) === lower(input.name ?? ''))
  ) {
    fail(409, 'NAME_TAKEN', [{ field: 'name', message: 'Bu nom allaqachon mavjud' }]);
  }
  const before = { ...g };
  if (input.name !== undefined) g.name = input.name;
  if (input.description !== undefined) g.description = input.description ?? null;
  if (input.isActive !== undefined) g.isActive = input.isActive;
  const changes = diffChanges(before, g, ['name', 'description', 'isActive']);
  if (hasChanges(changes)) {
    recordAudit({
      action: 'PRODUCT_GROUP_UPDATED',
      entityType: 'PRODUCT_GROUP',
      entityId: g.id,
      metadata: { name: g.name, changes },
    });
  }
  g.updatedAt = now();
  return groupDto(g.id);
});

route('DELETE', '/product-groups/:id', ({ params }) => {
  const s = db();
  const g = s.groups.find((x) => x.id === params.id) ?? notFound();
  if (s.products.some((p) => p.groupId === g.id)) fail(409, 'ENTITY_IN_USE');
  s.groups = s.groups.filter((x) => x.id !== g.id);
  recordAudit({
    action: 'PRODUCT_GROUP_DELETED',
    entityType: 'PRODUCT_GROUP',
    entityId: g.id,
    metadata: { name: g.name },
  });
  return undefined;
});

// ─── Mahsulotlar ────────────────────────────────────────────────────────────

/** Guruh mavjud (404) va YANGI biriktirilsa faol (422) bo'lishi shart — backend bilan bir xil. */
function assertGroupAssignable(groupId: string, currentGroupId: string | null) {
  const g = db().groups.find((x) => x.id === groupId);
  if (!g) fail(404, 'NOT_FOUND', [{ field: 'groupId', message: 'Ma’lumot topilmadi' }]);
  if (!g.isActive && groupId !== currentGroupId) {
    fail(422, 'PRODUCT_GROUP_INACTIVE', [
      { field: 'groupId', message: 'Mahsulot guruhi faol emas (arxivlangan)' },
    ]);
  }
}

function assertBarcodeFree(barcode: string | null | undefined, exceptId?: string) {
  if (!barcode) return;
  if (db().products.some((p) => p.barcode === barcode && p.id !== exceptId)) {
    fail(409, 'BARCODE_TAKEN', [{ field: 'barcode', message: 'Bu shtrix-kod allaqachon mavjud' }]);
  }
}

route('GET', '/products', ({ query }) => {
  const s = db();
  if (query.sort?.startsWith('costPrice') && !currentCan(s, 'products.read_cost')) {
    fail(400, 'VALIDATION_ERROR', [{ field: 'sort', message: 'Saralash parametri noto‘g‘ri' }]);
  }
  const status = currentCan(s, 'products.manage') ? query.status : 'ACTIVE';
  const totals = productTotals(s);
  const warehouseId = query.warehouseId || undefined;
  let list = s.products
    .filter((p) => includesText([p.name, p.barcode], query.search))
    .filter((p) => !query.groupId || p.groupId === query.groupId)
    .filter((p) => !status || p.status === status)
    .map((p) => toProductDto(s, p, totals, warehouseId));
  if (warehouseId)
    list = list.filter((p) => p.warehouses.some((w) => w.warehouseId === warehouseId));
  if (query.stock === 'low') list = list.filter((p) => p.isLowStock);
  if (query.stock === 'out') list = list.filter((p) => compareQty(p.stock, '0') <= 0);
  const sorted = sortBy(
    list,
    query.sort,
    {
      name: (p) => p.name,
      group: (p) => p.groupName,
      stock: (p) => num(p.stock),
      received: (p) => num(p.received),
      sold: (p) => num(p.sold),
      costPrice: (p) => num(p.costPrice),
      salePrice: (p) => num(p.salePrice),
      createdAt: (p) => p.createdAt,
    },
    'name:asc',
  );
  return paginate(sorted, query);
});

route('GET', '/products/lookup', ({ query }) => {
  const s = db();
  const code = query.barcode?.trim();
  const p = s.products.find((x) => x.barcode === code && x.status === 'ACTIVE');
  if (!p) fail(404, 'NOT_FOUND', [], 'Bu shtrix-kod bo‘yicha mahsulot topilmadi');
  return toProductDto(s, p, productTotals(s), query.warehouseId || undefined);
});

route('GET', '/products/:id', ({ params }) => {
  const s = db();
  const p = s.products.find((x) => x.id === params.id) ?? notFound();
  if (p.status !== 'ACTIVE' && !currentCan(s, 'products.manage')) notFound();
  return toProductDto(s, p, productTotals(s));
});

route('GET', '/products/:id/summary', ({ params }): ProductSummaryDto => {
  const s = db();
  if (!currentCan(s, 'products.read_cost')) fail(403, 'FORBIDDEN');
  const p = s.products.find((x) => x.id === params.id) ?? notFound();
  const lines = s.sales.flatMap((sale) =>
    sale.items.filter((i) => i.productId === p.id).map((i) => ({ sale, i })),
  );
  const revenue = sumMoney(lines.map(({ i }) => lineTotal(i.quantity, i.unitPrice)));
  const cost = sumMoney(lines.map(({ i }) => lineTotal(i.quantity, i.unitCost)));
  return {
    product: toProductDto(s, p, productTotals(s)),
    totalRevenue: revenue,
    totalCost: cost,
    grossProfit: subMoney(revenue, cost),
    recentSales: lines
      .sort((a, b) => b.sale.soldAt.localeCompare(a.sale.soldAt))
      .slice(0, 8)
      .map(({ sale, i }) => ({
        saleId: sale.id,
        saleNumber: formatDocNumber('S', sale.number),
        soldAt: sale.soldAt,
        customerName: sale.customerName,
        warehouseName: s.warehouses.find((w) => w.id === sale.warehouseId)?.name ?? '—',
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: lineTotal(i.quantity, i.unitPrice),
      })),
  };
});

route('POST', '/products', ({ body }) => {
  const input = validate(productCreateSchema, body);
  const s = db();
  if (input.initialStock) requireReceivePermission();
  assertGroupAssignable(input.groupId, null);
  assertBarcodeFree(input.barcode);
  const initialStock = input.initialStock && { ...input.initialStock, costPrice: input.costPrice };
  if (initialStock) {
    assertReceivable(input, initialStock, (field) =>
      field === 'quantity' ? 'initialStock.quantity' : 'initialStock',
    );
  }
  const at = now();
  const row = {
    id: mockUuid(),
    name: input.name,
    groupId: input.groupId,
    barcode: input.barcode ?? null,
    costPrice: input.costPrice,
    salePrice: input.salePrice,
    unit: input.unit,
    allowDecimal: input.allowDecimal,
    minStock: input.minStock ?? null,
    status: input.status,
    createdAt: at,
    updatedAt: at,
  };
  s.products.push(row);
  recordAudit({
    action: 'PRODUCT_CREATED',
    entityType: 'PRODUCT',
    entityId: row.id,
    metadata: {
      name: row.name,
      barcode: row.barcode,
      groupId: row.groupId,
      unit: row.unit,
      costPrice: row.costPrice,
      salePrice: row.salePrice,
      status: row.status,
    },
  });
  if (initialStock) receiveStock(row, initialStock);
  return toProductDto(s, row, productTotals(s));
});

/** Mavjud mahsulotga qoldiq (sobiq "Kirim"): darhol tasdiqlangan kirim hujjati. */
route('POST', '/products/:id/stock', ({ params, body }) => {
  requireReceivePermission();
  const input = validate(stockReceiptSchema, body);
  const s = db();
  const row = s.products.find((p) => p.id === params.id) ?? notFound();
  assertReceivable(row, input, (field) => (field === 'quantity' ? 'quantity' : 'productId'));
  receiveStock(row, input);
  return toProductDto(s, row, productTotals(s));
});

route('PATCH', '/products/:id', ({ params, body }) => {
  const input = validate(productUpdateSchema, body);
  const s = db();
  const p = s.products.find((x) => x.id === params.id) ?? notFound();
  if ((input.unit ?? p.unit) === 'DONA' && (input.allowDecimal ?? p.allowDecimal)) {
    fail(400, 'VALIDATION_ERROR', [
      { field: 'allowDecimal', message: 'Dona bilan sotiladigan mahsulot kasr miqdorda bo‘lmaydi' },
    ]);
  }
  if (input.groupId !== undefined) assertGroupAssignable(input.groupId, p.groupId);
  if (input.barcode !== undefined) assertBarcodeFree(input.barcode, p.id);
  const before = { ...p };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) Object.assign(p, { [key]: value });
  }
  const changes = diffChanges(before, p, [
    'name',
    'groupId',
    'unit',
    'allowDecimal',
    'status',
    'barcode',
    'costPrice',
    'salePrice',
    'minStock',
  ]);
  if (hasChanges(changes)) {
    recordAudit({
      action: 'PRODUCT_UPDATED',
      entityType: 'PRODUCT',
      entityId: p.id,
      metadata: { name: p.name, changes },
    });
    if (changes.status) {
      recordAudit({
        action: 'PRODUCT_STATUS_CHANGED',
        entityType: 'PRODUCT',
        entityId: p.id,
        metadata: { name: before.name, ...changes.status },
      });
    }
  }
  p.updatedAt = now();
  return toProductDto(s, p, productTotals(s));
});

route('PATCH', '/products/:id/status', ({ params, body }) => {
  const input = validate(productStatusSchema, body);
  const s = db();
  const p = s.products.find((x) => x.id === params.id) ?? notFound();
  if (p.status !== input.status) {
    recordAudit({
      action: 'PRODUCT_STATUS_CHANGED',
      entityType: 'PRODUCT',
      entityId: p.id,
      metadata: { name: p.name, from: p.status, to: input.status },
    });
  }
  p.status = input.status;
  p.updatedAt = now();
  return toProductDto(s, p, productTotals(s));
});

/** Miqdor mahsulot siyosatiga mosmi (BR-13). Sotuv va kirim handler'lari ishlatadi. */
export function quantityAllowed(allowDecimal: boolean, quantity: string): boolean {
  return allowDecimal || isWholeQuantity(quantity);
}
