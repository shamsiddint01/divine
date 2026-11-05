import { type Permission, ROLE_PERMISSIONS } from '@divine/shared';
import { addQty, compareQty, lineTotal, subMoney, sumMoney, sumQty } from '@/shared/lib/decimal';
import type {
  CustomerDto,
  ExpenseCategoryDto,
  ExpenseDto,
  MovementDto,
  ProductDto,
  SaleDto,
  UserDto,
  UserRef,
  WarehouseDto,
  WarehouseStats,
} from '@/shared/types/api';
import { formatDocNumber, getStock } from './inventory';
import type {
  CustomerRow,
  ExpenseCategoryRow,
  ExpenseRow,
  MockState,
  MovementRow,
  ProductRow,
  SaleRow,
  UserRow,
  WarehouseRow,
} from './state';

// Qator → API DTO (backenddagi response mapper'ning aksi). Kelgan narxiga oid maydonlar backend kabi
// joriy userning `products.read_cost` ruxsatiga qarab qaytariladi (`currentCan`).

export function userRef(state: MockState, id: string): UserRef {
  const u = state.users.find((x) => x.id === id);
  return { id, login: u?.login ?? '—', fullName: u?.fullName ?? null };
}

export function thresholdOf(state: MockState, p: ProductRow): string {
  return p.minStock ?? state.settings.lowStockDefaultThreshold;
}

/** Bir martalik indekslar: mahsulot bo'yicha jami kirim va jami sotilgan. */
export function productTotals(state: MockState) {
  const received = new Map<string, string>();
  const sold = new Map<string, string>();
  for (const m of state.movements) {
    if (m.type === 'INCOMING')
      received.set(m.productId, addQty(received.get(m.productId) ?? '0', m.quantity));
  }
  for (const s of state.sales) {
    for (const i of s.items)
      sold.set(i.productId, addQty(sold.get(i.productId) ?? '0', i.quantity));
  }
  return { received, sold };
}

/** Joriy mock sessiya userida shu permission bormi (backend `AccessContext` aksi). */
export function currentCan(state: MockState, permission: Permission): boolean {
  const user = state.users.find((u) => u.id === state.currentUserId);
  return Boolean(user && ROLE_PERMISSIONS[user.role].includes(permission));
}

export function toProductDto(
  state: MockState,
  p: ProductRow,
  totals: ReturnType<typeof productTotals>,
  warehouseId?: string,
): ProductDto {
  const warehouses = state.warehouses
    .map((w) => ({
      warehouseId: w.id,
      warehouseName: w.name,
      quantity: getStock(state, w.id, p.id),
    }))
    .filter(
      (w) =>
        compareQty(w.quantity, '0') > 0 ||
        state.movements.some((m) => m.warehouseId === w.warehouseId && m.productId === p.id),
    );
  const stock = warehouseId
    ? getStock(state, warehouseId, p.id)
    : sumQty(warehouses.map((w) => w.quantity));
  return {
    id: p.id,
    name: p.name,
    groupId: p.groupId,
    groupName: state.groups.find((g) => g.id === p.groupId)?.name ?? '—',
    barcode: p.barcode,
    salePrice: p.salePrice,
    wholesalePrice: p.wholesalePrice,
    // Backend kabi: `products.read_cost` bo'lmasa kalit umuman yo'q (OWN-06).
    ...(currentCan(state, 'products.read_cost') ? { costPrice: p.costPrice } : {}),
    unit: p.unit,
    allowDecimal: p.allowDecimal,
    minStock: p.minStock,
    status: p.status,
    stock,
    received: totals.received.get(p.id) ?? '0.000',
    sold: totals.sold.get(p.id) ?? '0.000',
    isLowStock: p.status === 'ACTIVE' && compareQty(stock, thresholdOf(state, p)) <= 0,
    warehouses,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Asosiy maydonlar (USER ro'yxati, yaratish/tahrirlash javobi — backend kabi). */
export function toWarehouseBaseDto(w: WarehouseRow): WarehouseDto {
  return {
    id: w.id,
    name: w.name,
    address: w.address,
    status: w.status,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

/** Ko'rsatkichlar bilan (`warehouses.read_all`); `stockValue` — faqat `products.read_cost` (OWN-06). */
export function toWarehouseDto(state: MockState, w: WarehouseRow): WarehouseDto & WarehouseStats {
  const rows = state.products
    .map((p) => ({ p, qty: getStock(state, w.id, p.id) }))
    .filter((r) => compareQty(r.qty, '0') > 0 || state.stock[`${w.id}|${r.p.id}`] !== undefined);
  return {
    ...toWarehouseBaseDto(w),
    productCount: rows.filter((r) => compareQty(r.qty, '0') > 0).length,
    totalQuantity: sumQty(rows.map((r) => r.qty)),
    ...(currentCan(state, 'products.read_cost')
      ? { stockValue: sumMoney(rows.map((r) => lineTotal(r.qty, r.p.costPrice))) }
      : {}),
    lowStockCount: rows.filter(
      (r) => r.p.status === 'ACTIVE' && compareQty(r.qty, thresholdOf(state, r.p)) <= 0,
    ).length,
  };
}

export function toUserDto(state: MockState, u: UserRow): UserDto {
  return {
    id: u.id,
    login: u.login,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    // Mock'da login lockout yo'q (SECURITY §4 faqat backend'da).
    lockedUntil: null,
    warehouses: u.warehouseIds
      .map((id) => state.warehouses.find((w) => w.id === id))
      .filter((w): w is WarehouseRow => Boolean(w))
      .map((w) => ({ id: w.id, name: w.name })),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export function customerAggregates(state: MockState) {
  const agg = new Map<string, { count: number; total: string; last: string | null }>();
  for (const s of state.sales) {
    const a = agg.get(s.customerId) ?? { count: 0, total: '0.00', last: null };
    a.count += 1;
    a.total = sumMoney([a.total, s.totalAmount]);
    if (!a.last || s.soldAt > a.last) a.last = s.soldAt;
    agg.set(s.customerId, a);
  }
  return agg;
}

export function toCustomerDto(
  c: CustomerRow,
  agg: ReturnType<typeof customerAggregates>,
): CustomerDto {
  const a = agg.get(c.id);
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    purchaseCount: a?.count ?? 0,
    totalSpent: a?.total ?? '0.00',
    lastPurchaseAt: a?.last ?? null,
    createdAt: c.createdAt,
  };
}

export function toSaleDto(state: MockState, s: SaleRow, withItems = false): SaleDto {
  const product = (id: string) => state.products.find((p) => p.id === id);
  const dto: SaleDto = {
    id: s.id,
    number: formatDocNumber('S', s.number),
    soldAt: s.soldAt,
    user: userRef(state, s.userId),
    warehouse: {
      id: s.warehouseId,
      name: state.warehouses.find((w) => w.id === s.warehouseId)?.name ?? '—',
    },
    customer: { id: s.customerId, name: s.customerName, phone: s.customerPhone },
    itemsCount: s.items.length,
    totalQuantity: s.totalQuantity,
    totalAmount: s.totalAmount,
    totalCost: s.totalCost,
    grossProfit: subMoney(s.totalAmount, s.totalCost),
    status: 'COMPLETED',
    priceType: s.priceType ?? 'RETAIL',
  };
  if (withItems) {
    dto.items = s.items.map((i) => {
      const p = product(i.productId);
      const total = lineTotal(i.quantity, i.unitPrice);
      return {
        productId: i.productId,
        productName: p?.name ?? '—',
        barcode: p?.barcode ?? null,
        unit: p?.unit ?? 'DONA',
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: total,
        unitCost: i.unitCost,
        lineProfit: subMoney(total, lineTotal(i.quantity, i.unitCost)),
      };
    });
  }
  return dto;
}

export function toMovementDto(state: MockState, m: MovementRow): MovementDto {
  const p = state.products.find((x) => x.id === m.productId);
  return {
    id: String(m.id),
    warehouseId: m.warehouseId,
    warehouseName: state.warehouses.find((w) => w.id === m.warehouseId)?.name ?? '—',
    productId: m.productId,
    productName: p?.name ?? '—',
    unit: p?.unit ?? 'DONA',
    movementType: m.type,
    quantity: m.quantity,
    balanceAfter: m.balanceAfter,
    referenceType: m.type,
    referenceId: m.referenceId,
    referenceNumber: m.referenceNumber,
    createdBy: userRef(state, m.userId),
    createdAt: m.createdAt,
  };
}

export function toExpenseDto(state: MockState, e: ExpenseRow): ExpenseDto {
  return {
    id: e.id,
    date: e.date,
    amount: e.amount,
    category: {
      id: e.categoryId,
      name: state.expenseCategories.find((c) => c.id === e.categoryId)?.name ?? '—',
    },
    note: e.note,
    createdBy: userRef(state, e.createdBy),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

/** Kategoriya egasi (D-23): eski demo yozuvlari — birinchi ADMIN'niki. */
export function categoryOwner(state: MockState, c: ExpenseCategoryRow): string {
  return c.createdBy ?? state.users.find((u) => u.role === 'ADMIN')?.id ?? '';
}

/** Backend `toExpenseCategoryDto` aksi: sotuvchiga (faqat `expenses.create`) — `id, name`. */
export function toExpenseCategoryDto(
  state: MockState,
  c: ExpenseCategoryRow,
  full: boolean,
): ExpenseCategoryDto {
  if (!full) return { id: c.id, name: c.name };
  return {
    id: c.id,
    name: c.name,
    isActive: c.isActive,
    expenseCount: state.expenses.filter((e) => e.categoryId === c.id).length,
    createdBy: userRef(state, categoryOwner(state, c)),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
