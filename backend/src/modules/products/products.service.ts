import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  type Paginated,
  Permission,
  type ProductCreateInput,
  type ProductDto,
  type ProductStatus,
  type ProductSummaryDto,
  type ProductUpdateInput,
  type StockReceiptInput,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import {
  type AccessContext,
  assertWarehouseAccess,
  hasPermission,
  warehouseScope,
} from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { type Tx, TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import { IncomingService } from '../incoming/incoming.service.js';
import {
  type ListProductsQuery,
  type ProductFilter,
  type ProductRow,
  ProductsRepository,
} from './products.repository.js';

/**
 * Javob serializeri (OWN-06, AC-20): `costPrice` FAQAT `products.read_cost` bo'lsa qo'shiladi —
 * ruxsatsiz userga kalit umuman yuborilmaydi (null ham emas). Barcha product javoblari shu yerdan o'tadi.
 */
export function toProductDto(row: ProductRow, canReadCost: boolean): ProductDto {
  const { costPrice, createdAt, updatedAt, ...rest } = row;
  return {
    ...rest,
    ...(canReadCost ? { costPrice } : {}),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

/** Pul/miqdor satrlarini qiymat bo'yicha solishtirish (`"5"` = `"5.00"`), float'siz. */
function sameDecimal(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const norm = (v: string) => {
    const [int = '0', frac = ''] = v.split('.');
    return `${int.replace(/^0+(?=\d)/, '')}.${frac.replace(/0+$/, '')}`;
  };
  return norm(a) === norm(b);
}

/**
 * Mahsulotlar (Phase 6, API §6, BR-09…13, OWN-03, OWN-06). Ruxsatsiz userlar uchun:
 * faqat ACTIVE mahsulotlar, faqat biriktirilgan omborlar bo'yicha miqdorlar, kelgan narxi yo'q va
 * kelgan narxi bo'yicha saralab bo'lmaydi (tartib orqali ham oshkor bo'lmasin).
 * Tahrirlash tarixiy hujjatlarga ta'sir qilmaydi: sotuv/kirim qatorlarida snapshot (D-02, D-08).
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
    private readonly incoming: IncomingService,
  ) {}

  async list(ctx: AccessContext, query: ListProductsQuery): Promise<Paginated<ProductDto>> {
    const canReadCost = hasPermission(ctx, Permission.PRODUCTS_READ_COST);
    if (query.sort.field === 'costPrice' && !canReadCost) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'sort', message: VALIDATION_MESSAGES_UZ.invalidSort }],
      });
    }
    if (query.warehouseId) assertWarehouseAccess(ctx, query.warehouseId);
    const { rows, total } = await this.repository.list(
      { ...query, status: this.statusFor(ctx, query.status) },
      warehouseScope(ctx),
    );
    return toPaginated(
      rows.map((row) => toProductDto(row, canReadCost)),
      total,
      query,
    );
  }

  async get(ctx: AccessContext, id: string): Promise<ProductDto> {
    return this.one(ctx, { ids: [id], status: this.statusFor(ctx, undefined) });
  }

  /** Skaner (BR-10): faqat ACTIVE mahsulot; ombor berilsa — qoldiq shu ombor bo'yicha. */
  async lookup(ctx: AccessContext, barcode: string, warehouseId?: string): Promise<ProductDto> {
    if (warehouseId) assertWarehouseAccess(ctx, warehouseId);
    const row = await this.repository.findOne({
      barcode,
      status: 'ACTIVE',
      warehouseId,
      scope: warehouseScope(ctx),
    });
    if (!row) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: 'Bu shtrix-kod bo‘yicha mahsulot topilmadi',
      });
    }
    return toProductDto(row, hasPermission(ctx, Permission.PRODUCTS_READ_COST));
  }

  /** `products.read_cost` (controller'da): tushum, kelgan narxi, foyda va oxirgi sotuvlar. */
  async summary(ctx: AccessContext, id: string): Promise<ProductSummaryDto> {
    const product = await this.one(ctx, { ids: [id] });
    const sales = await this.repository.salesSummary(id);
    return {
      product,
      totalRevenue: sales.revenue,
      totalCost: sales.cost,
      grossProfit: sales.profit,
      recentSales: sales.recent,
    };
  }

  async create(
    ctx: AccessContext,
    input: ProductCreateInput,
    meta: RequestMeta,
  ): Promise<ProductDto> {
    // Boshlang'ich qoldiq — kirim bilan bir xil ruxsat (sobiq "Kirim" bo'limi shu yerga ko'chgan).
    if (input.initialStock) assertCanReceive(ctx);
    return this.transactions.run(async (tx) => {
      await this.assertGroupAssignable(tx, input.groupId, null);
      const barcode = input.barcode ?? null;
      if (barcode) await this.assertBarcodeFree(tx, barcode, null);
      const id = await this.repository.create(tx, {
        name: input.name,
        groupId: input.groupId,
        barcode,
        costPrice: input.costPrice,
        salePrice: input.salePrice,
        unit: input.unit,
        allowDecimal: input.allowDecimal,
        minStock: input.minStock ?? null,
        status: input.status,
        createdById: ctx.userId,
      });
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.PRODUCT_CREATED,
          entityType: AuditEntityType.PRODUCT,
          entityId: id,
          metadata: {
            name: input.name,
            barcode,
            groupId: input.groupId,
            unit: input.unit,
            costPrice: input.costPrice,
            salePrice: input.salePrice,
            status: input.status,
          },
          meta,
        },
        tx,
      );
      if (input.initialStock) {
        const { warehouseId, quantity, date, notes } = input.initialStock;
        // Kelgan narxi — kartadagi bilan bir xil (formada ikkinchi "kelgan narx" maydoni yo'q).
        await this.incoming.receive(
          tx,
          ctx,
          {
            warehouseId,
            date,
            notes: notes ?? null,
            items: [{ productId: id, quantity, costPrice: input.costPrice }],
          },
          meta,
          (field) => (field === 'quantity' ? 'initialStock.quantity' : 'initialStock'),
        );
      }
      return this.one(ctx, { ids: [id] }, tx);
    });
  }

  /**
   * Mavjud mahsulotga qoldiq qo'shish (`POST /products/:id/stock`) — tasdiqlangan kirim hujjati:
   * ledger, ombor qoldig'i, hisobotlar va audit avvalgi "Kirim" bo'limi bilan bir xil. D-16: kelgan narxi
   * mahsulot kartasidagi narxni o'zgartirmaydi.
   */
  async addStock(
    ctx: AccessContext,
    id: string,
    input: StockReceiptInput,
    meta: RequestMeta,
  ): Promise<ProductDto> {
    return this.transactions.run(async (tx) => {
      (await this.repository.lock(tx, id)) ?? notFound();
      await this.incoming.receive(
        tx,
        ctx,
        {
          warehouseId: input.warehouseId,
          date: input.date,
          notes: input.notes ?? null,
          items: [{ productId: id, quantity: input.quantity, costPrice: input.costPrice }],
        },
        meta,
        (field) => (field === 'quantity' ? 'quantity' : 'productId'),
      );
      return this.one(ctx, { ids: [id] }, tx);
    });
  }

  async update(
    ctx: AccessContext,
    id: string,
    input: ProductUpdateInput,
    meta: RequestMeta,
  ): Promise<ProductDto> {
    return this.transactions.run(async (tx) => {
      const current = (await this.repository.lock(tx, id)) ?? notFound();
      const unit = input.unit ?? current.unit;
      const allowDecimal = input.allowDecimal ?? current.allowDecimal;
      if (unit === 'DONA' && allowDecimal) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          details: [{ field: 'allowDecimal', message: VALIDATION_MESSAGES_UZ.unitDecimalConflict }],
        });
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const track = (field: keyof typeof current, next: unknown, same: boolean) => {
        if (next !== undefined && !same) changes[field] = { from: current[field], to: next };
      };
      track('name', input.name, input.name === current.name);
      track('groupId', input.groupId, input.groupId === current.groupId);
      track('unit', input.unit, input.unit === current.unit);
      track('allowDecimal', input.allowDecimal, input.allowDecimal === current.allowDecimal);
      track('status', input.status, input.status === current.status);
      if (input.barcode !== undefined) {
        track('barcode', input.barcode, input.barcode === current.barcode);
      }
      if (input.costPrice !== undefined) {
        track('costPrice', input.costPrice, sameDecimal(input.costPrice, current.costPrice));
      }
      if (input.salePrice !== undefined) {
        track('salePrice', input.salePrice, sameDecimal(input.salePrice, current.salePrice));
      }
      if (input.minStock !== undefined) {
        track('minStock', input.minStock, sameDecimal(input.minStock, current.minStock));
      }

      if (changes.groupId) await this.assertGroupAssignable(tx, input.groupId!, current.groupId);
      if (changes.barcode && input.barcode) await this.assertBarcodeFree(tx, input.barcode, id);

      if (Object.keys(changes).length > 0) {
        await this.repository.update(
          tx,
          id,
          Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.to])),
        );
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.PRODUCT_UPDATED,
            entityType: AuditEntityType.PRODUCT,
            entityId: id,
            metadata: { name: input.name ?? current.name, changes },
            meta,
          },
          tx,
        );
        if (changes.status) await this.auditStatus(tx, ctx, id, current.name, changes.status, meta);
      }
      return this.one(ctx, { ids: [id] }, tx);
    });
  }

  /** INACTIVE (arxiv): sotib ham, kirim qilib ham bo'lmaydi (BR-20); qoldiq va tarix saqlanadi. */
  async setStatus(
    ctx: AccessContext,
    id: string,
    status: ProductStatus,
    meta: RequestMeta,
  ): Promise<ProductDto> {
    return this.transactions.run(async (tx) => {
      const current = (await this.repository.lock(tx, id)) ?? notFound();
      if (current.status !== status) {
        await this.repository.update(tx, id, { status });
        await this.auditStatus(
          tx,
          ctx,
          id,
          current.name,
          { from: current.status, to: status },
          meta,
        );
      }
      return this.one(ctx, { ids: [id] }, tx);
    });
  }

  private statusFor(ctx: AccessContext, requested?: ProductStatus): ProductStatus | undefined {
    // Boshqarish huquqi yo'q user (sotuvchi) faqat sotuvdagi (ACTIVE) mahsulotlarni ko'radi.
    return hasPermission(ctx, Permission.PRODUCTS_MANAGE) ? requested : 'ACTIVE';
  }

  private async one(ctx: AccessContext, filter: ProductFilter, client?: Tx): Promise<ProductDto> {
    const row = await this.repository.findOne({ ...filter, scope: warehouseScope(ctx) }, client);
    return toProductDto(row ?? notFound(), hasPermission(ctx, Permission.PRODUCTS_READ_COST));
  }

  private async auditStatus(
    tx: Tx,
    ctx: AccessContext,
    id: string,
    name: string,
    change: { from: unknown; to: unknown },
    meta: RequestMeta,
  ): Promise<void> {
    await this.audit.record(
      {
        actorId: ctx.userId,
        action: AuditAction.PRODUCT_STATUS_CHANGED,
        entityType: AuditEntityType.PRODUCT,
        entityId: id,
        metadata: { name, ...change },
        meta,
      },
      tx,
    );
  }

  /** Guruh mavjud (`404`) va YANGI biriktirilsa faol (`422 PRODUCT_GROUP_INACTIVE`) bo'lishi shart. */
  private async assertGroupAssignable(tx: Tx, groupId: string, currentGroupId: string | null) {
    const group = await this.repository.group(tx, groupId);
    if (!group) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        details: [{ field: 'groupId', message: ERROR_MESSAGES_UZ.NOT_FOUND }],
      });
    }
    if (!group.isActive && groupId !== currentGroupId) {
      throw new AppError(ErrorCode.PRODUCT_GROUP_INACTIVE, {
        details: [{ field: 'groupId', message: ERROR_MESSAGES_UZ.PRODUCT_GROUP_INACTIVE }],
      });
    }
  }

  /** Shtrix-kod barcha mahsulotlar (arxivlanganlar ham) orasida unique (D-09); DB ham kafolatlaydi. */
  private async assertBarcodeFree(tx: Tx, barcode: string, exceptId: string | null) {
    const owner = await this.repository.barcodeOwner(tx, barcode);
    if (owner && owner !== exceptId) {
      throw new AppError(ErrorCode.BARCODE_TAKEN, {
        details: [{ field: 'barcode', message: ERROR_MESSAGES_UZ.BARCODE_TAKEN }],
      });
    }
  }
}

function assertCanReceive(ctx: AccessContext): void {
  if (
    !hasPermission(ctx, Permission.INCOMING_MANAGE) ||
    !hasPermission(ctx, Permission.INCOMING_CONFIRM)
  ) {
    throw new AppError(ErrorCode.FORBIDDEN);
  }
}

function notFound(): never {
  throw new AppError(ErrorCode.NOT_FOUND);
}
