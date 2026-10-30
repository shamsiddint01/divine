import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  type MovementDto,
  type Paginated,
  Permission,
  type ReconciliationResult,
} from '@divine/shared';
import {
  type AccessContext,
  assertWarehouseAccess,
  hasPermission,
  warehouseScope,
} from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { Clock } from '../../common/time/clock.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import {
  InventoryRepository,
  type LedgerEntry,
  type MovementFilter,
  type MovementRow,
} from './inventory.repository.js';

/** Javobdagi nomuvofiqliklar soni chegarasi (to'liq son `mismatchCount`da). */
const RECONCILIATION_LIST_LIMIT = 500;

/** `unitCost` FAQAT `products.read_cost` bo'lsa (OWN-06) — barcha harakat javoblari shu yerdan o'tadi. */
export function toMovementDto(row: MovementRow, canReadCost: boolean): MovementDto {
  const { unitCost, createdAt, ...rest } = row;
  return {
    ...rest,
    ...(canReadCost ? { unitCost } : {}),
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Inventar (Phase 7, ARCHITECTURE §12, DATABASE §5.3, BR-21, BR-26). Qoldiq faqat shu service orqali
 * o'zgaradi — Phase 8 (kirim tasdiqlash) va Phase 10 (sotuv) uni o'z tranzaksiyasi ichida chaqiradi:
 *
 * ```ts
 * await this.transactions.run(async (tx) => {
 *   await this.inventory.assertOperationalWarehouse(tx, ctx, dto.warehouseId);
 *   …hujjat va qatorlar…
 *   await this.inventory.decrease(tx, entries);
 * });
 * ```
 *
 * Har bir o'zgarish: ombor `FOR SHARE` (faol bo'lishi shart) → `product_id` tartibida stock (deadlock yo'q)
 * → shu balans bilan ledger yozuvi. Trigger'lar ledger ↔ stock ↔ hujjat mosligini yana tekshiradi.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly repository: InventoryRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * Yangi operatsiya uchun ombor: user unga biriktirilgan (OWN-02) va ombor ACTIVE (BR-21). Ombor qatori
   * tranzaksiya oxirigacha `FOR SHARE` qulflanadi — parallel nofaol qilish shu operatsiyadan keyin o'tadi.
   */
  async assertOperationalWarehouse(tx: Tx, ctx: AccessContext, warehouseId: string): Promise<void> {
    assertWarehouseAccess(ctx, warehouseId);
    await this.lockActiveWarehouse(tx, warehouseId);
  }

  /** Kirim: qoldiq ↑ va `INCOMING` ledger yozuvi (hujjat CONFIRMED bo'lishi shart — trigger tekshiradi). */
  async increase(tx: Tx, entries: readonly LedgerEntry[]): Promise<void> {
    await this.lockWarehouses(tx, entries);
    for (const entry of sortByProduct(entries)) {
      positive(entry.quantity);
      const balance = await this.repository.addStock(
        tx,
        entry.warehouseId,
        entry.productId,
        entry.quantity,
      );
      await this.repository.insertMovement(tx, entry, entry.quantity, balance);
    }
  }

  /**
   * Sotuv: shartli qoldiq ↓ (yetmasa `409 INSUFFICIENT_STOCK`, butun tranzaksiya bekor) va `SALE` ledger
   * yozuvi (manfiy miqdor). Manfiy qoldiq — CHECK constraint bilan ham imkonsiz (REQ-161).
   */
  async decrease(tx: Tx, entries: readonly LedgerEntry[]): Promise<void> {
    await this.lockWarehouses(tx, entries);
    for (const entry of sortByProduct(entries)) {
      positive(entry.quantity);
      const balance = await this.repository.takeStock(
        tx,
        entry.warehouseId,
        entry.productId,
        entry.quantity,
      );
      if (balance === null) {
        const available = await this.repository.currentStock(
          tx,
          entry.warehouseId,
          entry.productId,
        );
        throw new AppError(ErrorCode.INSUFFICIENT_STOCK, {
          details: [{ field: entry.productId, message: ERROR_MESSAGES_UZ.INSUFFICIENT_STOCK }],
          cause: { productId: entry.productId, requested: entry.quantity, available },
        });
      }
      await this.repository.insertMovement(tx, entry, `-${entry.quantity}`, balance);
    }
  }

  async listMovements(
    ctx: AccessContext,
    filter: Omit<MovementFilter, 'scope'>,
  ): Promise<Paginated<MovementDto>> {
    if (filter.warehouseId) assertWarehouseAccess(ctx, filter.warehouseId);
    const { rows, total } = await this.repository.listMovements({
      ...filter,
      scope: warehouseScope(ctx),
    });
    const canReadCost = hasPermission(ctx, Permission.PRODUCTS_READ_COST);
    return toPaginated(
      rows.map((row) => toMovementDto(row, canReadCost)),
      total,
      filter,
    );
  }

  /**
   * Qoldiq ↔ ledger solishtiruvi (REQ-132, AC-23). Faqat o'qiydi — avtomatik tuzatish yo'q (D-03).
   * Har bir ishga tushirish audit qilinadi; kunlik job'da `actorId = null`.
   */
  async reconcile(
    actorId: string | null,
    source: 'api' | 'job',
    meta?: RequestMeta,
  ): Promise<ReconciliationResult> {
    const result = await this.repository.reconcile(RECONCILIATION_LIST_LIMIT);
    const checkedAt = this.clock.now().toISOString();
    await this.audit.record({
      actorId,
      action: AuditAction.INVENTORY_RECONCILIATION_RUN,
      entityType: AuditEntityType.INVENTORY,
      metadata: {
        source,
        pairsChecked: result.pairsChecked,
        mismatchCount: result.mismatchCount,
        documentIssueCount: result.documentIssueCount,
        customerIssueCount: result.customerIssueCount,
      },
      meta,
    });
    return { checkedAt, ...result };
  }

  private async lockWarehouses(tx: Tx, entries: readonly LedgerEntry[]): Promise<void> {
    // Bir nechta ombor bo'lsa — ID tartibida (deadlock yo'q).
    for (const warehouseId of [...new Set(entries.map((e) => e.warehouseId))].sort()) {
      await this.lockActiveWarehouse(tx, warehouseId);
    }
  }

  private async lockActiveWarehouse(tx: Tx, warehouseId: string): Promise<void> {
    const warehouse = await this.repository.lockWarehouseShared(tx, warehouseId);
    if (!warehouse) throw new AppError(ErrorCode.NOT_FOUND);
    if (warehouse.status !== 'ACTIVE') {
      throw new AppError(ErrorCode.WAREHOUSE_INACTIVE, {
        details: [{ field: 'warehouseId', message: ERROR_MESSAGES_UZ.WAREHOUSE_INACTIVE }],
      });
    }
  }
}

const sortByProduct = (entries: readonly LedgerEntry[]): LedgerEntry[] =>
  [...entries].sort(
    (a, b) =>
      a.productId.localeCompare(b.productId) || a.referenceItemId.localeCompare(b.referenceItemId),
  );

/** Miqdor musbat bo'lishi shart (ishora harakat turidan) — dasturchi xatosi, foydalanuvchi kiritmaydi. */
function positive(quantity: string): void {
  if (!/^\d+(\.\d+)?$/.test(quantity) || /^0+(\.0+)?$/.test(quantity)) {
    throw new Error(`Inventar miqdori musbat bo'lishi kerak: ${quantity}`);
  }
}
