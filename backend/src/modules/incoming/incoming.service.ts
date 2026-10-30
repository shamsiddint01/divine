import { Injectable } from '@nestjs/common';
import {
  type ApiErrorDetail,
  AuditAction,
  AuditEntityType,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  formatIssuePath,
  type IncomingCreateInput,
  type IncomingDto,
  type IncomingItemInput,
  type IncomingUpdateInput,
  isWholeQuantity,
  type Paginated,
  Permission,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import {
  type AccessContext,
  assertWarehouseAccess,
  canAccessWarehouse,
  hasPermission,
  warehouseScope,
} from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { Clock } from '../../common/time/clock.js';
import { type Tx, TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import {
  type IncomingItemRow,
  IncomingRepository,
  type IncomingRow,
  type ListIncomingQuery,
  type LockedIncoming,
  type NewItem,
  type ProductForIncoming,
} from './incoming.repository.js';

/**
 * Javob serializeri (OWN-06): kelgan narxi, qator summasi va hujjat summasi FAQAT `products.read_cost`
 * bo'lsa — aks holda kalit umuman yo'q. Barcha kirim javoblari shu yerdan o'tadi.
 */
export function toIncomingDto(
  row: IncomingRow,
  items: IncomingItemRow[] | undefined,
  canReadCost: boolean,
): IncomingDto {
  const { totalAmount, confirmedAt, cancelledAt, createdAt, updatedAt, ...rest } = row;
  return {
    ...rest,
    ...(canReadCost ? { totalAmount } : {}),
    ...(items
      ? {
          items: items.map(({ costPrice, lineTotal, ...item }) =>
            canReadCost ? { ...item, costPrice, lineTotal } : item,
          ),
        }
      : {}),
    confirmedAt: confirmedAt?.toISOString() ?? null,
    cancelledAt: cancelledAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

const itemField = (index: number, field: keyof IncomingItemInput) =>
  formatIssuePath(['items', index, field]);

/**
 * Kirim (Phase 8, API §9, ARCHITECTURE §12.2, BR-08, BR-11, BR-13, BR-16…18, BR-21).
 * Holat mashinasi: `DRAFT → CONFIRMED` (stock ↑) · `DRAFT → CANCELLED`; yakuniy holatlar o'zgarmaydi.
 * Qoldiq faqat `InventoryService.increase` orqali, hujjat holati bilan bitta tranzaksiyada o'zgaradi.
 */
@Injectable()
export class IncomingService {
  constructor(
    private readonly repository: IncomingRepository,
    private readonly inventory: InventoryService,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(ctx: AccessContext, query: ListIncomingQuery): Promise<Paginated<IncomingDto>> {
    const canReadCost = hasPermission(ctx, Permission.PRODUCTS_READ_COST);
    // Summa bo'yicha tartib ham kelgan narxini oshkor qiladi (Phase 6 `sort=costPrice` qoidasi).
    if (query.sort.field === 'totalAmount' && !canReadCost) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'sort', message: VALIDATION_MESSAGES_UZ.invalidSort }],
      });
    }
    if (query.warehouseId) assertWarehouseAccess(ctx, query.warehouseId);
    const { rows, total } = await this.repository.list(query, warehouseScope(ctx));
    return toPaginated(
      rows.map((row) => toIncomingDto(row, undefined, canReadCost)),
      total,
      query,
    );
  }

  /** Begona ombor hujjati — `404` (mavjudligi ham oshkor qilinmaydi, RBAC §4). */
  async get(ctx: AccessContext, id: string): Promise<IncomingDto> {
    const row = await this.repository.find(id);
    if (!row || !canAccessWarehouse(ctx, row.warehouseId)) notFound();
    return toIncomingDto(
      row,
      await this.repository.items(id),
      hasPermission(ctx, Permission.PRODUCTS_READ_COST),
    );
  }

  async create(
    ctx: AccessContext,
    input: IncomingCreateInput,
    meta: RequestMeta,
  ): Promise<IncomingDto> {
    return this.transactions.run(async (tx) => {
      await this.inventory.assertOperationalWarehouse(tx, ctx, input.warehouseId);
      const items = await this.prepareItems(tx, input.items);
      const id = await this.repository.create(tx, {
        date: input.date,
        warehouseId: input.warehouseId,
        notes: input.notes ?? null,
        createdById: ctx.userId,
      });
      await this.repository.replaceItems(tx, id, items);
      await this.repository.recalculateTotals(tx, id);
      const doc = await this.load(tx, id);
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.INCOMING_CREATED,
          entityType: AuditEntityType.INCOMING,
          entityId: id,
          metadata: {
            number: doc.row.number,
            warehouseId: input.warehouseId,
            date: input.date,
            itemsCount: items.length,
            totalQuantity: doc.row.totalQuantity,
          },
          meta,
        },
        tx,
      );
      return this.respond(ctx, doc);
    });
  }

  async update(
    ctx: AccessContext,
    id: string,
    input: IncomingUpdateInput,
    meta: RequestMeta,
  ): Promise<IncomingDto> {
    return this.transactions.run(async (tx) => {
      const locked = await this.lockDraft(tx, ctx, id);
      // Nofaol omborning qoralamasi tahrirlanmaydi (faqat faol omborga ko'chirish yoki bekor qilish).
      const warehouseId = input.warehouseId ?? locked.warehouseId;
      await this.inventory.assertOperationalWarehouse(tx, ctx, warehouseId);
      const before = await this.repository.find(id, tx);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const header = {
        date: input.date ?? locked.incomingDate,
        warehouseId,
        notes: input.notes === undefined ? locked.notes : input.notes,
      };
      if (header.date !== locked.incomingDate) {
        changes.date = { from: locked.incomingDate, to: header.date };
      }
      if (header.warehouseId !== locked.warehouseId) {
        changes.warehouseId = { from: locked.warehouseId, to: header.warehouseId };
      }
      if (header.notes !== locked.notes) changes.notes = { from: locked.notes, to: header.notes };
      if (Object.keys(changes).length > 0) await this.repository.updateHeader(tx, id, header);
      if (input.items) {
        await this.repository.replaceItems(tx, id, await this.prepareItems(tx, input.items));
        await this.repository.recalculateTotals(tx, id);
      }
      const doc = await this.load(tx, id);
      const totalsChanged =
        before?.itemsCount !== doc.row.itemsCount ||
        before?.totalQuantity !== doc.row.totalQuantity ||
        before?.totalAmount !== doc.row.totalAmount;
      if (Object.keys(changes).length > 0 || input.items !== undefined) {
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.INCOMING_UPDATED,
            entityType: AuditEntityType.INCOMING,
            entityId: id,
            metadata: {
              number: doc.row.number,
              changes,
              ...(input.items !== undefined
                ? {
                    items: {
                      replaced: true,
                      totalsChanged,
                      from: {
                        itemsCount: before?.itemsCount,
                        totalQuantity: before?.totalQuantity,
                      },
                      to: { itemsCount: doc.row.itemsCount, totalQuantity: doc.row.totalQuantity },
                    },
                  }
                : {}),
            },
            meta,
          },
          tx,
        );
      }
      return this.respond(ctx, doc);
    });
  }

  /**
   * Tasdiqlash (ARCHITECTURE §12.2): hujjat `FOR UPDATE` → DRAFT ekani → ombor ruxsati va ACTIVE
   * (`FOR SHARE`) → qatorlar va mahsulotlar (`FOR SHARE`, ACTIVE, butun/kasr siyosati) → holat va
   * totallar → `InventoryService.increase` (ledger) → audit. Bitta tranzaksiya: biror qadam xato bersa —
   * hech narsa saqlanmaydi. Takroriy/parallel so'rov qulfni kutib, `409 INCOMING_NOT_DRAFT` oladi.
   */
  async confirm(ctx: AccessContext, id: string, meta: RequestMeta): Promise<IncomingDto> {
    return this.transactions.run(async (tx) => {
      const locked = await this.lockDraft(tx, ctx, id);
      await this.inventory.assertOperationalWarehouse(tx, ctx, locked.warehouseId);
      const items = await this.repository.items(id, tx);
      if (items.length === 0) throw new AppError(ErrorCode.INCOMING_EMPTY);
      const products = await this.repository.lockProducts(
        tx,
        items.map((item) => item.productId),
      );
      items.forEach((item, index) =>
        this.assertProductUsable(products.get(item.productId), item.quantity, index),
      );

      const at = this.clock.now();
      if (!(await this.repository.markConfirmed(tx, id, ctx.userId, at))) notDraft();
      await this.inventory.increase(
        tx,
        items.map((item) => ({
          warehouseId: locked.warehouseId,
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.costPrice,
          referenceType: 'INCOMING' as const,
          referenceId: id,
          referenceItemId: item.id,
          actorId: ctx.userId,
        })),
      );
      const doc = await this.load(tx, id);
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.INCOMING_CONFIRMED,
          entityType: AuditEntityType.INCOMING,
          entityId: id,
          metadata: {
            number: doc.row.number,
            warehouseId: locked.warehouseId,
            itemsCount: doc.row.itemsCount,
            totalQuantity: doc.row.totalQuantity,
            totalAmount: doc.row.totalAmount,
          },
          meta,
        },
        tx,
      );
      return this.respond(ctx, doc);
    });
  }

  /** Bekor qilish: faqat DRAFT, qoldiqqa tegmaydi (DRAFT hech qachon qoldiqni o'zgartirmagan). */
  async cancel(ctx: AccessContext, id: string, meta: RequestMeta): Promise<IncomingDto> {
    return this.transactions.run(async (tx) => {
      const locked = await this.lockDraft(tx, ctx, id);
      if (!(await this.repository.markCancelled(tx, id, ctx.userId, this.clock.now()))) notDraft();
      const doc = await this.load(tx, id);
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.INCOMING_CANCELLED,
          entityType: AuditEntityType.INCOMING,
          entityId: id,
          metadata: { number: doc.row.number, warehouseId: locked.warehouseId },
          meta,
        },
        tx,
      );
      return this.respond(ctx, doc);
    });
  }

  /** Hujjatni qulflaydi: yo'q yoki begona ombor — 404; DRAFT emas — `409` (joriy holat bilan). */
  private async lockDraft(tx: Tx, ctx: AccessContext, id: string): Promise<LockedIncoming> {
    const locked = await this.repository.lock(tx, id);
    if (!locked || !canAccessWarehouse(ctx, locked.warehouseId)) notFound();
    if (locked.status !== 'DRAFT') notDraft(locked.status);
    return locked;
  }

  /** Qatorlar: mahsulot mavjud, ACTIVE va miqdor siyosatiga mos; snapshot'lar shu paytdan (D-08). */
  private async prepareItems(tx: Tx, items: IncomingItemInput[]): Promise<NewItem[]> {
    const products = await this.repository.lockProducts(
      tx,
      items.map((item) => item.productId),
    );
    return items.map((item, index) => {
      const product = this.assertProductUsable(products.get(item.productId), item.quantity, index);
      return {
        productId: product.id,
        productName: product.name,
        barcode: product.barcode,
        quantity: item.quantity,
        costPrice: item.costPrice,
      };
    });
  }

  private assertProductUsable(
    product: ProductForIncoming | undefined,
    quantity: string,
    index: number,
  ): ProductForIncoming {
    if (!product) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        details: [{ field: itemField(index, 'productId'), message: ERROR_MESSAGES_UZ.NOT_FOUND }],
      });
    }
    if (product.status !== 'ACTIVE') {
      throw new AppError(ErrorCode.PRODUCT_INACTIVE, {
        message: `«${product.name}» mahsuloti faol emas`,
        details: [
          { field: itemField(index, 'productId'), message: ERROR_MESSAGES_UZ.PRODUCT_INACTIVE },
        ],
      });
    }
    if (!product.allowDecimal && !isWholeQuantity(quantity)) {
      const detail: ApiErrorDetail = {
        field: itemField(index, 'quantity'),
        message: VALIDATION_MESSAGES_UZ.wholeQuantity,
      };
      throw new AppError(ErrorCode.INVALID_QUANTITY, { details: [detail] });
    }
    return product;
  }

  private async load(tx: Tx, id: string): Promise<{ row: IncomingRow; items: IncomingItemRow[] }> {
    const row = (await this.repository.find(id, tx)) ?? notFound();
    return { row, items: await this.repository.items(id, tx) };
  }

  private respond(
    ctx: AccessContext,
    doc: { row: IncomingRow; items: IncomingItemRow[] },
  ): IncomingDto {
    return toIncomingDto(doc.row, doc.items, hasPermission(ctx, Permission.PRODUCTS_READ_COST));
  }
}

function notFound(): never {
  throw new AppError(ErrorCode.NOT_FOUND);
}

function notDraft(status?: string): never {
  throw new AppError(ErrorCode.INCOMING_NOT_DRAFT, {
    ...(status ? { details: [{ field: 'status', message: status }] } : {}),
  });
}
