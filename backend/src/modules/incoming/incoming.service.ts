import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  isWholeQuantity,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import type { AccessContext } from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { IncomingRepository, type ProductForIncoming } from './incoming.repository.js';

export interface StockReceipt {
  warehouseId: string;
  date: string;
  notes: string | null;
  items: { productId: string; quantity: string; costPrice: string }[];
}

/** Xato qaysi forma maydoniga tegishli (`quantity`, `initialStock.quantity` …). */
export type ReceiptFieldOf = (field: 'productId' | 'quantity') => string;

/**
 * Qoldiq qo'shish = tasdiqlangan kirim hujjati (ARCHITECTURE §12.2, BR-08, BR-11, BR-13, BR-21).
 * Alohida "Kirim" bo'limi yo'q: mahsulotlar moduli buni o'z tranzaksiyasi ichida chaqiradi. Tartib —
 * trigger'lar talab qiladigandek: ombor ruxsati va ACTIVE (`FOR SHARE`) → mahsulotlar (`FOR SHARE`) →
 * hujjat va qatorlar → CONFIRMED (totallar DB'da) → `InventoryService.increase` (ledger) → audit.
 * D-16: kelgan narxi mahsulot kartasidagi `cost_price`ni o'zgartirmaydi — faqat hujjat va ledger'da.
 */
@Injectable()
export class IncomingService {
  constructor(
    private readonly repository: IncomingRepository,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async receive(
    tx: Tx,
    ctx: AccessContext,
    receipt: StockReceipt,
    meta: RequestMeta,
    fieldOf: ReceiptFieldOf,
  ): Promise<void> {
    await this.inventory.assertOperationalWarehouse(tx, ctx, receipt.warehouseId);
    const products = await this.repository.lockProducts(
      tx,
      receipt.items.map((item) => item.productId),
    );
    const items = receipt.items.map((item) => {
      const product = assertProductUsable(products.get(item.productId), item.quantity, fieldOf);
      return {
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        quantity: item.quantity,
        costPrice: item.costPrice,
      };
    });

    const id = await this.repository.create(tx, {
      date: receipt.date,
      warehouseId: receipt.warehouseId,
      notes: receipt.notes,
      createdById: ctx.userId,
    });
    const inserted = await this.repository.insertItems(tx, id, items);
    const totals = await this.repository.markConfirmed(tx, id, ctx.userId, this.clock.now());
    if (!totals) throw new Error('Yangi kirim hujjati DRAFT holatida emas');
    await this.inventory.increase(
      tx,
      inserted.map((row) => ({
        warehouseId: receipt.warehouseId,
        productId: row.productId,
        quantity: items.find((item) => item.productId === row.productId)!.quantity,
        unitCost: items.find((item) => item.productId === row.productId)!.costPrice,
        referenceType: 'INCOMING' as const,
        referenceId: id,
        referenceItemId: row.id,
        actorId: ctx.userId,
      })),
    );
    await this.audit.record(
      {
        actorId: ctx.userId,
        action: AuditAction.INCOMING_CONFIRMED,
        entityType: AuditEntityType.INCOMING,
        entityId: id,
        metadata: {
          number: totals.number,
          warehouseId: receipt.warehouseId,
          date: receipt.date,
          itemsCount: items.length,
          totalQuantity: totals.totalQuantity,
          totalAmount: totals.totalAmount,
        },
        meta,
      },
      tx,
    );
  }
}

function assertProductUsable(
  product: ProductForIncoming | undefined,
  quantity: string,
  fieldOf: ReceiptFieldOf,
): ProductForIncoming {
  if (!product) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      details: [{ field: fieldOf('productId'), message: ERROR_MESSAGES_UZ.NOT_FOUND }],
    });
  }
  if (product.status !== 'ACTIVE') {
    throw new AppError(ErrorCode.PRODUCT_INACTIVE, {
      message: `«${product.name}» mahsuloti faol emas`,
      details: [{ field: fieldOf('productId'), message: ERROR_MESSAGES_UZ.PRODUCT_INACTIVE }],
    });
  }
  if (!product.allowDecimal && !isWholeQuantity(quantity)) {
    throw new AppError(ErrorCode.INVALID_QUANTITY, {
      details: [{ field: fieldOf('quantity'), message: VALIDATION_MESSAGES_UZ.wholeQuantity }],
    });
  }
  return product;
}
