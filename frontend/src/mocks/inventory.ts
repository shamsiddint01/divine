import { addQty, compareQty } from '@/shared/lib/decimal';
import { type MockState, stockKey } from './state';

// Mock inventar xizmati — backenddagi InventoryService'ning aksi:
// qoldiq (warehouse_stock) va harakatlar jurnali (inventory_movements) DOIM birga yoziladi.

export class MockInsufficientStock extends Error {
  constructor(readonly available: string) {
    super('INSUFFICIENT_STOCK');
  }
}

export function getStock(state: MockState, warehouseId: string, productId: string): string {
  return state.stock[stockKey(warehouseId, productId)] ?? '0.000';
}

/** Barcha omborlardagi jami qoldiq. */
export function getTotalStock(
  state: MockState,
  productId: string,
  warehouseIds?: string[],
): string {
  return state.warehouses
    .filter((w) => !warehouseIds || warehouseIds.includes(w.id))
    .reduce((acc, w) => addQty(acc, getStock(state, w.id, productId)), '0.000');
}

export interface MovementInput {
  warehouseId: string;
  productId: string;
  type: 'INCOMING' | 'SALE';
  /** Ishorali miqdor: kirim musbat, sotuv manfiy. */
  quantity: string;
  referenceId: string;
  referenceNumber: string;
  userId: string;
  createdAt: string;
}

/** Harakatni yozadi va yangi qoldiqni qaytaradi. Qoldiq manfiy bo'lsa — xato (BR-07). */
export function postMovement(state: MockState, input: MovementInput): string {
  const key = stockKey(input.warehouseId, input.productId);
  const current = state.stock[key] ?? '0.000';
  const next = addQty(current, input.quantity);
  if (compareQty(next, '0') < 0) throw new MockInsufficientStock(current);
  state.stock[key] = next;
  state.counters.movement += 1;
  state.movements.push({
    id: state.counters.movement,
    warehouseId: input.warehouseId,
    productId: input.productId,
    type: input.type,
    quantity: input.quantity,
    balanceAfter: next,
    referenceId: input.referenceId,
    referenceNumber: input.referenceNumber,
    userId: input.userId,
    createdAt: input.createdAt,
  });
  return next;
}

export const formatDocNumber = (prefix: 'S' | 'K', n: number) =>
  `${prefix}-${String(n).padStart(6, '0')}`;
