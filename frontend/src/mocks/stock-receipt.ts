import { VALIDATION_MESSAGES_UZ, isWholeQuantity } from '@divine/shared';
import { lineTotal } from '@/shared/lib/decimal';
import { recordAudit } from './audit';
import { db } from './db';
import { formatDocNumber, postMovement } from './inventory';
import { fail } from './lib/http';
import { nowIso } from './lib/clock';
import { mockUuid } from './lib/random';
import { currentCan } from './mappers';
import type { IncomingRow, ProductRow } from './state';

// Qoldiq qo'shish (backend `IncomingService.receive` aksi): sobiq "Kirim" bo'limi o'rniga mahsulotlar
// bo'limidan. Darhol tasdiqlangan kirim hujjati — ledger, ombor qoldig'i, hisobotlar va audit avvalgidek.
// D-16: kelgan narxi mahsulot kartasidagi narxni o'zgartirmaydi.

export interface StockReceipt {
  warehouseId: string;
  quantity: string;
  costPrice: string;
  date: string;
  notes?: string | null;
}

type FieldOf = (field: 'productId' | 'quantity') => string;

/** Kirim bilan bir xil ruxsat: `incoming.manage` + `incoming.confirm`. */
export function requireReceivePermission() {
  const s = db();
  if (!currentCan(s, 'incoming.manage') || !currentCan(s, 'incoming.confirm')) {
    fail(403, 'FORBIDDEN');
  }
}

/** Hech narsa yozishdan oldingi tekshiruvlar (atomiklik: xato bo'lsa — mahsulot ham yaratilmaydi). */
export function assertReceivable(
  product: Pick<ProductRow, 'status' | 'allowDecimal'>,
  receipt: StockReceipt,
  fieldOf: FieldOf,
) {
  const s = db();
  const warehouse = s.warehouses.find((w) => w.id === receipt.warehouseId);
  if (!warehouse) fail(404, 'NOT_FOUND');
  const me = s.users.find((u) => u.id === s.currentUserId);
  if (!currentCan(s, 'warehouses.read_all') && !me?.warehouseIds.includes(receipt.warehouseId)) {
    fail(403, 'WAREHOUSE_ACCESS_DENIED');
  }
  if (warehouse.status !== 'ACTIVE') fail(422, 'WAREHOUSE_INACTIVE');
  if (product.status !== 'ACTIVE') {
    fail(422, 'PRODUCT_INACTIVE', [{ field: fieldOf('productId'), message: 'Mahsulot faol emas' }]);
  }
  if (!product.allowDecimal && !isWholeQuantity(receipt.quantity)) {
    fail(422, 'INVALID_QUANTITY', [
      { field: fieldOf('quantity'), message: VALIDATION_MESSAGES_UZ.wholeQuantity },
    ]);
  }
}

export function receiveStock(product: ProductRow, receipt: StockReceipt) {
  const s = db();
  s.counters.incoming += 1;
  const at = nowIso();
  const doc: IncomingRow = {
    id: mockUuid(),
    number: s.counters.incoming,
    date: receipt.date,
    warehouseId: receipt.warehouseId,
    notes: receipt.notes ?? null,
    status: 'CONFIRMED',
    items: [
      {
        id: mockUuid(),
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        quantity: receipt.quantity,
        costPrice: receipt.costPrice,
      },
    ],
    createdBy: s.currentUserId,
    confirmedBy: s.currentUserId,
    confirmedAt: at,
    createdAt: at,
    updatedAt: at,
  };
  s.incoming.push(doc);
  postMovement(s, {
    warehouseId: doc.warehouseId,
    productId: product.id,
    type: 'INCOMING',
    quantity: receipt.quantity,
    referenceId: doc.id,
    referenceNumber: formatDocNumber('K', doc.number),
    userId: s.currentUserId,
    createdAt: at,
  });
  recordAudit({
    action: 'INCOMING_CONFIRMED',
    entityType: 'INCOMING',
    entityId: doc.id,
    metadata: {
      number: formatDocNumber('K', doc.number),
      warehouseId: doc.warehouseId,
      date: doc.date,
      itemsCount: 1,
      totalQuantity: receipt.quantity,
      totalAmount: lineTotal(receipt.quantity, receipt.costPrice),
    },
  });
}
