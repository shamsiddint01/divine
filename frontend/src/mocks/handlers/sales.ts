import {
  type ApiErrorDetail,
  type SaleCreateInput,
  VALIDATION_MESSAGES_UZ,
  customerCreateSchema,
  customerUpdateSchema,
  formatIssuePath,
  idempotencyKeySchema,
  saleCreateSchema,
  WALK_IN_CUSTOMER_NAME,
} from '@divine/shared';
import { addQty, compareQty, lineTotal, subMoney, sumMoney, sumQty } from '@/shared/lib/decimal';
import { formatQuantity } from '@/shared/lib/format';
import type { CustomerPurchasesResponse, SaleDto, SalesListResponse } from '@/shared/types/api';
import { t } from '@/i18n/uz';
import { diffChanges, hasChanges, recordAudit } from '../audit';
import { db } from '../db';
import { MockInsufficientStock, formatDocNumber, getStock, postMovement } from '../inventory';
import { fail, includesText, notFound, num, paginate, route, sortBy, validate } from '../lib/http';
import { mockUuid } from '../lib/random';
import { inDateRange } from '../lib/time';
import { currentCan, customerAggregates, toCustomerDto, toSaleDto } from '../mappers';
import type { CustomerRow, SaleItemRow, SaleRow } from '../state';
import { quantityAllowed } from './catalog';
import { nowIso } from '../lib/clock';

const now = nowIso;

// ─── Mijozlar ───────────────────────────────────────────────────────────────

// Backend shartnomasi (API §10): sxemalar shared'dan; `customers.read_history`siz — faqat
// `id, name, phone` (OWN-07); izohni faqat `customers.manage` yozadi; ism/telefon unique emas (A-23).

function requireCan(permission: Parameters<typeof currentCan>[1]) {
  if (!currentCan(db(), permission)) fail(403, 'FORBIDDEN');
}

function customerOut(c: CustomerRow, agg: ReturnType<typeof customerAggregates>) {
  const dto = toCustomerDto(c, agg);
  return currentCan(db(), 'customers.read_history')
    ? dto
    : { id: dto.id, name: dto.name, phone: dto.phone };
}

route('GET', '/customers', ({ query }) => {
  requireCan('customers.read');
  const s = db();
  if (
    !currentCan(s, 'customers.read_history') &&
    /^(totalSpent|purchaseCount)/.test(query.sort ?? '')
  ) {
    fail(400, 'VALIDATION_ERROR', [{ field: 'sort', message: VALIDATION_MESSAGES_UZ.invalidSort }]);
  }
  const agg = customerAggregates(s);
  const digits = query.search?.replace(/\D/g, '');
  const list = s.customers
    .filter(
      (c) =>
        includesText([c.name, c.phone], query.search) ||
        (!!digits && digits.length >= 3 && (c.phone ?? '').includes(digits)),
    )
    .map((c) => toCustomerDto(c, agg));
  const sorted = sortBy(
    list,
    query.sort,
    {
      name: (c) => c.name,
      purchaseCount: (c) => c.purchaseCount ?? 0,
      totalSpent: (c) => num(c.totalSpent ?? '0'),
      lastPurchaseAt: (c) => c.lastPurchaseAt ?? '',
    },
    'lastPurchaseAt:desc',
  );
  const page = paginate(sorted, query);
  const full = currentCan(s, 'customers.read_history');
  return {
    ...page,
    data: page.data.map((c) => (full ? c : { id: c.id, name: c.name, phone: c.phone })),
  };
});

route('GET', '/customers/:id', ({ params }) => {
  requireCan('customers.read_history');
  const s = db();
  const c = s.customers.find((x) => x.id === params.id) ?? notFound();
  return toCustomerDto(c, customerAggregates(s));
});

route('POST', '/customers', ({ body }) => {
  requireCan('customers.create');
  const input = validate(customerCreateSchema, body);
  const s = db();
  if (input.notes && !currentCan(s, 'customers.manage')) {
    fail(403, 'FORBIDDEN', [{ field: 'notes', message: VALIDATION_MESSAGES_UZ.notesForbidden }]);
  }
  const at = now();
  const row: CustomerRow = {
    id: mockUuid(),
    name: input.name,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
    createdAt: at,
    updatedAt: at,
  };
  s.customers.push(row);
  // D-17: shaxsiy qiymatlarsiz.
  recordAudit({
    action: 'CUSTOMER_CREATED',
    entityType: 'CUSTOMER',
    entityId: row.id,
    metadata: { hasPhone: Boolean(row.phone), hasNotes: Boolean(row.notes) },
  });
  return customerOut(row, customerAggregates(s));
});

route('PATCH', '/customers/:id', ({ params, body }) => {
  requireCan('customers.manage');
  const input = validate(customerUpdateSchema, body);
  const s = db();
  const c = s.customers.find((x) => x.id === params.id) ?? notFound();
  const before = { ...c };
  if (input.name !== undefined) c.name = input.name;
  if (input.phone !== undefined) c.phone = input.phone;
  if (input.notes !== undefined) c.notes = input.notes;
  const fields = Object.keys(diffChanges(before, c, ['name', 'phone', 'notes']));
  // D-17: faqat o'zgargan maydon nomlari, qiymatlar emas.
  if (hasChanges(Object.fromEntries(fields.map((f) => [f, true])))) {
    recordAudit({
      action: 'CUSTOMER_UPDATED',
      entityType: 'CUSTOMER',
      entityId: c.id,
      metadata: { fields },
    });
  }
  c.updatedAt = now();
  return toCustomerDto(c, customerAggregates(s));
});

route('GET', '/customers/:id/purchases', ({ params, query }): CustomerPurchasesResponse => {
  requireCan('customers.read_history');
  const s = db();
  const c = s.customers.find((x) => x.id === params.id) ?? notFound();
  const canReadCost = currentCan(s, 'products.read_cost');
  const list = s.sales
    .filter((x) => x.customerId === c.id && inDateRange(x.soldAt, query.dateFrom, query.dateTo))
    .sort((a, b) =>
      query.sort === 'soldAt:asc'
        ? a.soldAt.localeCompare(b.soldAt)
        : b.soldAt.localeCompare(a.soldAt),
    );
  const page = paginate(list, query);
  const agg = customerAggregates(s).get(c.id);
  return {
    ...page,
    data: page.data.map((x) => {
      const { totalCost, grossProfit, items, ...sale } = toSaleDto(s, x, true);
      return canReadCost
        ? { ...sale, totalCost, grossProfit, items }
        : {
            ...sale,
            items: items?.map(({ unitCost: _c, lineProfit: _p, ...item }) => item),
          };
    }),
    summary: {
      purchaseCount: agg?.count ?? 0,
      totalSpent: agg?.total ?? '0.00',
      lastPurchaseAt: agg?.last ?? null,
    },
  };
});

// ─── Sotuvlar ───────────────────────────────────────────────────────────────

// Backend shartnomasi (API §11): sxema shared'dan; kalit — UUID va kanonik payload xeshi (boshqa payload
// yoki boshqa user → 409); ism bilan kelgan mijoz — har doim yangi (D-17); narx/tannarx kartochkadan (D-16);
// tannarx va foyda faqat `products.read_cost` (OWN-06); USER faqat o'z sotuvlarini ko'radi (OWN-04/05).

/** `"2"` ↔ `"2.000"`, qatorlar tartibi farq qilmaydi — backend `requestHash` bilan bir xil kanonik ko'rinish. */
function saleRequestHash(input: SaleCreateInput, merged: Map<string, string>): string {
  const toMilli = (q: string) => {
    const [int = '0', frac = ''] = q.split('.');
    return `${BigInt(int) * 1000n + BigInt((frac + '000').slice(0, 3))}`;
  };
  return JSON.stringify({
    warehouseId: input.warehouseId,
    customer: 'id' in input.customer ? { id: input.customer.id } : input.customer,
    items: [...merged.entries()]
      .map(([productId, quantity]) => ({ productId, quantity: toMilli(quantity) }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
  });
}

/** Tannarx/foyda faqat `products.read_cost` bilan (backend `toSaleDto` aksi). */
function saleOut(dto: SaleDto): SaleDto {
  if (currentCan(db(), 'products.read_cost')) return dto;
  const { totalCost: _c, grossProfit: _p, items, ...rest } = dto;
  return {
    ...rest,
    ...(items ? { items: items.map(({ unitCost: _u, lineProfit: _l, ...item }) => item) } : {}),
  };
}

function ownSalesOnly() {
  const s = db();
  return currentCan(s, 'sales.read_all') ? undefined : s.currentUserId;
}

route('POST', '/sales', ({ body, headers }) => {
  requireCan('sales.create');
  const key = headers['idempotency-key']?.trim();
  if (!key) fail(400, 'IDEMPOTENCY_KEY_REQUIRED');
  if (!idempotencyKeySchema.safeParse(key).success) {
    fail(400, 'VALIDATION_ERROR', [
      { field: 'Idempotency-Key', message: VALIDATION_MESSAGES_UZ.idempotencyKeyFormat },
    ]);
  }
  const input = validate(saleCreateSchema, body);
  const s = db();

  // Takroriy qatorlar birlashtiriladi (BR-19).
  const merged = new Map<string, string>();
  for (const item of input.items)
    merged.set(item.productId, addQty(merged.get(item.productId) ?? '0', item.quantity));
  const hash = saleRequestHash(input, merged);

  // Takroriy so'rov (tarmoq xatosidan keyin qayta yuborish) — yangi sotuv yaratilmaydi.
  const existing = s.sales.find((x) => x.idempotencyKey === key);
  if (existing) {
    const sameRequest =
      existing.userId === s.currentUserId && (existing.requestHash ?? hash) === hash;
    if (!sameRequest) fail(409, 'IDEMPOTENCY_KEY_REUSED');
    return saleOut(toSaleDto(s, existing, true));
  }

  const warehouse = s.warehouses.find((w) => w.id === input.warehouseId) ?? notFound();
  const seller = s.users.find((u) => u.id === s.currentUserId) ?? notFound();
  if (!currentCan(s, 'warehouses.read_all') && !seller.warehouseIds.includes(warehouse.id))
    fail(403, 'WAREHOUSE_ACCESS_DENIED');
  if (warehouse.status !== 'ACTIVE') fail(422, 'WAREHOUSE_INACTIVE');

  const items: SaleItemRow[] = [];
  const stockErrors: ApiErrorDetail[] = [];
  [...merged.entries()].forEach(([productId, quantity], index) => {
    const field = (name: string) => formatIssuePath(['items', index, name]);
    const p = s.products.find((x) => x.id === productId);
    if (!p) fail(404, 'NOT_FOUND', [{ field: field('productId'), message: 'Ma’lumot topilmadi' }]);
    if (p.status !== 'ACTIVE') {
      fail(422, 'PRODUCT_INACTIVE', [{ field: field('productId'), message: 'Mahsulot faol emas' }]);
    }
    if (!quantityAllowed(p.allowDecimal, quantity)) {
      fail(422, 'INVALID_QUANTITY', [
        { field: field('quantity'), message: VALIDATION_MESSAGES_UZ.wholeQuantity },
      ]);
    }
    const available = getStock(s, warehouse.id, p.id);
    if (compareQty(quantity, available) > 0) {
      stockErrors.push({
        field: field('quantity'),
        message: `«${p.name}» uchun omborda faqat ${formatQuantity(available)} ${t.units[p.unit]} bor`,
      });
    }
    // Narx va tannarx — kartochkadan (BR-15, D-16); client narx yubora olmaydi.
    items.push({ productId: p.id, quantity, unitPrice: p.salePrice, unitCost: p.costPrice });
  });
  if (stockErrors.length > 0) fail(409, 'INSUFFICIENT_STOCK', stockErrors);

  let customer: CustomerRow | undefined;
  let newCustomer = false;
  if ('id' in input.customer) {
    const id = input.customer.id;
    customer =
      s.customers.find((x) => x.id === id) ??
      fail(404, 'NOT_FOUND', [{ field: 'customer.id', message: 'Ma’lumot topilmadi' }]);
  } else if (input.customer.name === null) {
    // Ismsiz sotuv (backend `lockWalkInCustomer` aksi): telefon bo'yicha so'nggi mijoz yoki umumiy mijoz.
    const { phone } = input.customer;
    customer =
      phone !== null
        ? s.customers
            .filter((c) => c.phone === phone)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        : s.customers.find((c) => c.name === WALK_IN_CUSTOMER_NAME && c.phone === null);
  }
  if (!customer && !('id' in input.customer)) {
    // Ism bilan kelgan mijoz — har doim yangi yozuv (API §11; takroriy ism/telefon ruxsat — D-17).
    const at = now();
    customer = {
      id: mockUuid(),
      name: input.customer.name ?? WALK_IN_CUSTOMER_NAME,
      phone: input.customer.phone,
      notes: null,
      createdAt: at,
      updatedAt: at,
    };
    s.customers.push(customer);
    newCustomer = true;
  }
  const {
    id: customerId,
    name: customerName,
    phone: customerPhone,
  } = customer ?? notFound();

  // "Tranzaksiya": barcha tekshiruvlar o'tdi — endi sale + items + stock ↓ + movements birga yoziladi.
  s.counters.sale += 1;
  const sale: SaleRow = {
    id: mockUuid(),
    number: s.counters.sale,
    soldAt: now(),
    userId: seller.id,
    warehouseId: warehouse.id,
    customerId,
    customerName,
    customerPhone,
    items,
    totalQuantity: sumQty(items.map((i) => i.quantity)),
    totalAmount: sumMoney(items.map((i) => lineTotal(i.quantity, i.unitPrice))),
    totalCost: sumMoney(items.map((i) => lineTotal(i.quantity, i.unitCost))),
    idempotencyKey: key,
    requestHash: hash,
  };
  try {
    for (const item of items) {
      postMovement(s, {
        warehouseId: warehouse.id,
        productId: item.productId,
        type: 'SALE',
        quantity: `-${item.quantity}`,
        referenceId: sale.id,
        referenceNumber: formatDocNumber('S', sale.number),
        userId: seller.id,
        createdAt: sale.soldAt,
      });
    }
  } catch (error) {
    if (error instanceof MockInsufficientStock) fail(409, 'INSUFFICIENT_STOCK');
    throw error;
  }
  s.sales.push(sale);
  if (newCustomer) {
    recordAudit({
      action: 'CUSTOMER_CREATED',
      entityType: 'CUSTOMER',
      entityId: customerId,
      metadata: { hasPhone: customerPhone !== null, hasNotes: false, source: 'sale' },
    });
  }
  recordAudit({
    action: 'SALE_CREATED',
    entityType: 'SALE',
    entityId: sale.id,
    metadata: {
      saleNumber: sale.number,
      warehouseId: sale.warehouseId,
      customerId,
      itemsCount: items.length,
      totalQuantity: sale.totalQuantity,
      totalAmount: sale.totalAmount,
    },
  });
  return saleOut(toSaleDto(s, sale, true));
});

function filteredSales(query: Record<string, string | undefined>) {
  const s = db();
  return s.sales
    .filter((x) => inDateRange(x.soldAt, query.dateFrom, query.dateTo))
    .filter((x) => !query.userId || x.userId === query.userId)
    .filter((x) => !query.warehouseId || x.warehouseId === query.warehouseId)
    .filter((x) => !query.customerId || x.customerId === query.customerId)
    .filter((x) => !query.productId || x.items.some((i) => i.productId === query.productId))
    .filter((x) => includesText([x.customerName, formatDocNumber('S', x.number)], query.search));
}

route('GET', '/sales', ({ query }): SalesListResponse => {
  if (!currentCan(db(), 'sales.read_all') && !currentCan(db(), 'sales.read_own')) {
    fail(403, 'FORBIDDEN');
  }
  const s = db();
  const list = filteredSales({ ...query, userId: ownSalesOnly() ?? query.userId });
  const sorted = sortBy(
    list,
    query.sort,
    {
      soldAt: (x) => x.soldAt,
      totalAmount: (x) => num(x.totalAmount),
      number: (x) => x.number,
    },
    'soldAt:desc',
  );
  const page = paginate(sorted, query);
  const totalAmount = sumMoney(list.map((x) => x.totalAmount));
  const totalCost = sumMoney(list.map((x) => x.totalCost));
  const canReadCost = currentCan(s, 'products.read_cost');
  return {
    data: page.data.map((x) => saleOut(toSaleDto(s, x))),
    meta: page.meta,
    summary: {
      count: list.length,
      totalQuantity: sumQty(list.map((x) => x.totalQuantity)),
      totalAmount,
      ...(canReadCost ? { totalCost, grossProfit: subMoney(totalAmount, totalCost) } : {}),
    },
  };
});

route('GET', '/sales/:id', ({ params }) => {
  if (!currentCan(db(), 'sales.read_all') && !currentCan(db(), 'sales.read_own')) {
    fail(403, 'FORBIDDEN');
  }
  const s = db();
  const owner = ownSalesOnly();
  const sale = s.sales.find((x) => x.id === params.id && (!owner || x.userId === owner));
  return saleOut(toSaleDto(s, sale ?? notFound(), true));
});
