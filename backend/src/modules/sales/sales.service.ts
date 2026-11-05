import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type ApiErrorDetail,
  AuditAction,
  AuditEntityType,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  formatIssuePath,
  isWholeQuantity,
  Permission,
  QUANTITY_MAX_INTEGER_DIGITS,
  type SaleCreateInput,
  type SaleDto,
  type SalePriceType,
  type SalesListResponse,
  VALIDATION_MESSAGES_UZ,
  WALK_IN_CUSTOMER_NAME,
} from '@divine/shared';
import { type AccessContext, hasPermission, ownerScope } from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { extractDbError } from '../../common/errors/database-errors.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { type Tx, TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import {
  type ProductForSale,
  type SaleFilter,
  type SaleLine,
  type SalePage,
  type SaleRow,
  SalesRepository,
} from './sales.repository.js';

/** Birlik nomlari — `INSUFFICIENT_STOCK` xabari uchun (UI lug'ati bilan bir xil). */
const UNIT_LABELS: Readonly<Record<string, string>> = {
  DONA: 'dona',
  KG: 'kg',
  LITR: 'litr',
  METR: 'metr',
};

/**
 * Javob serializeri (OWN-06): tannarx va foyda (`totalCost`, `grossProfit`, `unitCost`, `lineProfit`)
 * FAQAT `products.read_cost` bo'lsa — aks holda kalit yo'q. Barcha sotuv javoblari shu yerdan o'tadi
 * (`/sales`, `/customers/:id/purchases`).
 */
export function toSaleDto(row: SaleRow, canReadCost: boolean): SaleDto {
  const { totalCost, grossProfit, soldAt, items, ...rest } = row;
  return {
    ...rest,
    soldAt: soldAt.toISOString(),
    ...(canReadCost ? { totalCost, grossProfit } : {}),
    ...(items
      ? {
          items: items.map(({ unitCost, lineProfit, ...item }) =>
            canReadCost ? { ...item, unitCost, lineProfit } : item,
          ),
        }
      : {}),
  };
}

/** Miqdor (≤ 3 kasr) → mingdan bir birlik (BigInt) — float'siz qo'shish uchun. */
function toMilli(quantity: string): bigint {
  const [int = '0', frac = ''] = quantity.split('.');
  return BigInt(int) * 1000n + BigInt((frac + '000').slice(0, 3));
}

function fromMilli(milli: bigint): string {
  const int = milli / 1000n;
  const frac = (milli % 1000n).toString().padStart(3, '0');
  return `${int}.${frac}`;
}

/** Takroriy qatorlar birlashtiriladi (BR-19); birinchi uchragan tartib saqlanadi (xato maydon indekslari uchun). */
function mergeLines(items: SaleCreateInput['items']): SaleLine[] {
  const merged = new Map<string, bigint>();
  for (const item of items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0n) + toMilli(item.quantity));
  }
  return [...merged].map(([productId, milli]) => ({ productId, quantity: fromMilli(milli) }));
}

/**
 * Kanonik payload SHA-256 (REQ-145): qatorlar birlashtirilib `productId` bo'yicha tartiblangan, miqdorlar
 * normallashtirilgan — `"2"` va `"2.000"`, qatorlar tartibi farq qilmaydi; mijoz va ombor ham kiradi.
 */
function requestHash(input: SaleCreateInput, lines: SaleLine[]): string {
  const canonical = JSON.stringify({
    warehouseId: input.warehouseId,
    customer: 'id' in input.customer ? { id: input.customer.id } : input.customer,
    // Dona sotuvda kalit yo'q: D-25 dan oldingi so'rovlarning xeshi o'zgarmaydi.
    ...(input.priceType === 'WHOLESALE' ? { priceType: input.priceType } : {}),
    items: [...lines].sort((a, b) => a.productId.localeCompare(b.productId)),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

const MAX_QUANTITY_MILLI = 10n ** BigInt(QUANTITY_MAX_INTEGER_DIGITS + 3) - 1n;

/**
 * Sotuvlar (Phase 10, API §11, ARCHITECTURE §12.1, BR-05…07, BR-09, BR-15, BR-19…23, D-16, OWN-02/04/05).
 * Bitta tranzaksiya: ombor (ruxsat + ACTIVE) → mahsulotlar `FOR SHARE` → mijoz → `sales` + `sale_items`
 * (narx va tannarx snapshot'i kartochkadan) → `InventoryService.decrease` (stock ↓ + ledger) → mijoz yig'malari
 * → audit. Biror qadam xato bersa — hech narsa saqlanmaydi. Idempotentlik: `Idempotency-Key` UNIQUE +
 * kanonik `request_hash`.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly repository: SalesRepository,
    private readonly inventory: InventoryService,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
  ) {}

  /** `created: false` — shu kalit va payload bilan avval yaratilgan sotuv (takroriy so'rov, 200). */
  async create(
    ctx: AccessContext,
    idempotencyKey: string,
    input: SaleCreateInput,
    meta: RequestMeta,
  ): Promise<{ sale: SaleDto; created: boolean }> {
    const lines = mergeLines(input.items);
    const hash = requestHash(input, lines);
    const replay = await this.replay(ctx, idempotencyKey, hash);
    if (replay) return { sale: replay, created: false };
    try {
      const saleId = await this.transactions.run((tx) =>
        this.createInTx(tx, ctx, idempotencyKey, hash, input, lines, meta),
      );
      return { sale: await this.load(ctx, saleId), created: true };
    } catch (error) {
      // Parallel so'rov shu kalit bilan oldinroq COMMIT qildi (UNIQUE) — o'sha sotuv qaytariladi.
      if (extractDbError(error)?.constraint === 'sales_idempotency_key_key') {
        const sale = await this.replay(ctx, idempotencyKey, hash);
        if (sale) return { sale, created: false };
      }
      throw error;
    }
  }

  async list(ctx: AccessContext, filter: SaleFilter, page: SalePage): Promise<SalesListResponse> {
    // OWN-04: `sales.read_all`siz user — faqat o'z sotuvlari; query'dagi `userId` e'tiborga olinmaydi.
    const scoped = {
      ...filter,
      userId: ownerScope(ctx, Permission.SALES_READ_ALL) ?? filter.userId,
    };
    const canReadCost = hasPermission(ctx, Permission.PRODUCTS_READ_COST);
    // Jami son yig'ma so'rovidan (bitta skan) — sahifa so'rovi faqat LIMIT qatorlarini o'qiydi.
    const [rows, summary] = await Promise.all([
      this.repository.page(scoped, page),
      this.repository.summary(scoped),
    ]);
    return {
      ...toPaginated(
        rows.map((row) => toSaleDto(row, canReadCost)),
        summary.count,
        page,
      ),
      summary: {
        count: summary.count,
        totalQuantity: summary.totalQuantity,
        totalAmount: summary.totalAmount,
        ...(canReadCost
          ? {
              totalCost: summary.totalCost,
              grossProfit: subtractMoney(summary.totalAmount, summary.totalCost),
            }
          : {}),
      },
    };
  }

  /** OWN-05: begona sotuv — `404` (mavjudligi ham oshkor qilinmaydi). */
  async get(ctx: AccessContext, id: string): Promise<SaleDto> {
    return this.load(ctx, id);
  }

  private async load(ctx: AccessContext, id: string): Promise<SaleDto> {
    const row = await this.repository.find(id);
    const owner = ownerScope(ctx, Permission.SALES_READ_ALL);
    if (!row || (owner && row.user.id !== owner)) throw new AppError(ErrorCode.NOT_FOUND);
    return toSaleDto(row, hasPermission(ctx, Permission.PRODUCTS_READ_COST));
  }

  /** Kalit avval ishlatilganmi: o'sha user va o'sha payload — sotuv; aks holda `409`. */
  private async replay(
    ctx: AccessContext,
    idempotencyKey: string,
    hash: string,
  ): Promise<SaleDto | null> {
    const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (!existing) return null;
    if (existing.userId !== ctx.userId || existing.requestHash !== hash) {
      throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REUSED);
    }
    return this.load(ctx, existing.id);
  }

  private async createInTx(
    tx: Tx,
    ctx: AccessContext,
    idempotencyKey: string,
    hash: string,
    input: SaleCreateInput,
    lines: SaleLine[],
    meta: RequestMeta,
  ): Promise<string> {
    // 1. Ombor: OWN-02 (biriktirilgan) va ACTIVE (BR-21), `FOR SHARE`.
    await this.inventory.assertOperationalWarehouse(tx, ctx, input.warehouseId);

    // 2. Mahsulotlar: mavjud, ACTIVE (BR-20), butun/kasr siyosati (BR-13).
    const products = await this.repository.lockProducts(
      tx,
      lines.map((line) => line.productId),
    );
    const resolved = lines.map((line, index) =>
      this.assertSellable(products.get(line.productId), line, index, input.priceType),
    );

    // 3. Qoldiq — barcha yetmayotgan qatorlar bitta javobda (BR-07). Kafolat — 6-qadamdagi shartli UPDATE.
    const stock = await this.repository.stockLevels(
      tx,
      input.warehouseId,
      lines.map((line) => line.productId),
    );
    const shortages = resolved
      .map(({ product, line, index }) => ({
        product,
        line,
        index,
        available: stock.get(product.id) ?? '0.000',
      }))
      .filter(({ line, available }) => toMilli(line.quantity) > toMilli(available));
    if (shortages.length > 0) {
      throw insufficientStock(
        shortages.map(({ product, index, available }) => ({ product, index, available })),
      );
    }

    // 4. Mijoz: mavjud (`FOR UPDATE` — yig'malar uchun) yoki yangi (BR-05, BR-06; takroriy ruxsat — D-17).
    const customer = await this.resolveCustomer(tx, ctx, input, meta);

    // 5. Hujjat va qatorlar — narx/tannarx snapshot'i kartochkadan (D-02, D-16), client narxi yo'q (BR-15).
    const sale = await this.repository.insertSale(tx, {
      userId: ctx.userId,
      warehouseId: input.warehouseId,
      customer,
      idempotencyKey,
      requestHash: hash,
      priceType: input.priceType,
      lines,
    });
    const items = await this.repository.insertItems(tx, sale.id, lines, input.priceType);

    // 6. Qoldiq ↓ + ledger (`product_id` tartibida, shartli UPDATE — overselling yo'q, REQ-077).
    try {
      await this.inventory.decrease(
        tx,
        items.map((item) => ({
          warehouseId: input.warehouseId,
          productId: item.productId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          referenceType: 'SALE' as const,
          referenceId: sale.id,
          referenceItemId: item.id,
          actorId: ctx.userId,
        })),
      );
    } catch (error) {
      // Oldindan tekshiruvdan keyin parallel sotuv qoldiqni kamaytirgan — aniq xabar bilan.
      if (error instanceof AppError && error.code === ErrorCode.INSUFFICIENT_STOCK) {
        const cause = error.cause as { productId?: string; available?: string } | undefined;
        const hit = resolved.find(({ product }) => product.id === cause?.productId);
        if (hit) {
          throw insufficientStock([{ ...hit, available: cause?.available ?? '0.000' }]);
        }
      }
      throw error;
    }

    // 7. Mijoz yig'malari (cache) — shu tranzaksiyada (REQ-080).
    await this.repository.addToCustomerAggregates(tx, sale.id);

    // 8. Audit (BR-24) — narx/tannarx emas, faqat raqam, summa va sonlar.
    const saved = await this.repository.find(sale.id, tx);
    await this.audit.record(
      {
        actorId: ctx.userId,
        action: AuditAction.SALE_CREATED,
        entityType: AuditEntityType.SALE,
        entityId: sale.id,
        metadata: {
          saleNumber: saved?.number,
          warehouseId: input.warehouseId,
          customerId: customer.id,
          itemsCount: lines.length,
          totalQuantity: saved?.totalQuantity,
          totalAmount: saved?.totalAmount,
        },
        meta,
      },
      tx,
    );
    return sale.id;
  }

  private assertSellable(
    product: ProductForSale | undefined,
    line: SaleLine,
    index: number,
    priceType: SalePriceType,
  ) {
    const field = (name: string) => formatIssuePath(['items', index, name]);
    if (!product) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        details: [{ field: field('productId'), message: ERROR_MESSAGES_UZ.NOT_FOUND }],
      });
    }
    if (product.status !== 'ACTIVE') {
      throw new AppError(ErrorCode.PRODUCT_INACTIVE, {
        message: `«${product.name}» mahsuloti faol emas`,
        details: [{ field: field('productId'), message: ERROR_MESSAGES_UZ.PRODUCT_INACTIVE }],
      });
    }
    // Tanlangan turda narx yo'q — boshqa narx bilan sotilmaydi (D-25).
    if ((priceType === 'WHOLESALE' ? product.wholesalePrice : product.salePrice) === null) {
      throw new AppError(ErrorCode.PRODUCT_PRICE_MISSING, {
        message: `«${product.name}» uchun ${priceType === 'WHOLESALE' ? 'optom' : 'dona'} narxi kiritilmagan`,
        details: [{ field: field('productId'), message: ERROR_MESSAGES_UZ.PRODUCT_PRICE_MISSING }],
      });
    }
    if (
      (!product.allowDecimal && !isWholeQuantity(line.quantity)) ||
      toMilli(line.quantity) > MAX_QUANTITY_MILLI
    ) {
      throw new AppError(ErrorCode.INVALID_QUANTITY, {
        details: [
          {
            field: field('quantity'),
            message: product.allowDecimal
              ? ERROR_MESSAGES_UZ.INVALID_QUANTITY
              : VALIDATION_MESSAGES_UZ.wholeQuantity,
          },
        ],
      });
    }
    return { product, line, index };
  }

  private async resolveCustomer(
    tx: Tx,
    ctx: AccessContext,
    input: SaleCreateInput,
    meta: RequestMeta,
  ): Promise<{ id: string; name: string; phone: string | null }> {
    if ('id' in input.customer) {
      const customer = await this.repository.lockCustomer(tx, input.customer.id);
      if (!customer) {
        throw new AppError(ErrorCode.NOT_FOUND, {
          details: [{ field: 'customer.id', message: ERROR_MESSAGES_UZ.NOT_FOUND }],
        });
      }
      return customer;
    }
    const { phone } = input.customer;
    if (input.customer.name === null) {
      // Ismsiz sotuv: telefon bo'yicha mavjud mijoz yoki bitta umumiy "Noma'lum mijoz" (2026-11-03).
      const walkIn = await this.repository.lockWalkInCustomer(tx, phone);
      if (walkIn) return walkIn;
    }
    const name = input.customer.name ?? WALK_IN_CUSTOMER_NAME;
    const id = await this.repository.createCustomer(tx, { name, phone, createdById: ctx.userId });
    await this.audit.record(
      {
        actorId: ctx.userId,
        action: AuditAction.CUSTOMER_CREATED,
        entityType: AuditEntityType.CUSTOMER,
        entityId: id,
        // D-17: shaxsiy qiymatlarsiz.
        metadata: { hasPhone: phone !== null, hasNotes: false, source: 'sale' },
        meta,
      },
      tx,
    );
    return { id, name, phone };
  }
}

function insufficientStock(
  hits: { product: ProductForSale; index: number; available: string }[],
): AppError {
  const details: ApiErrorDetail[] = hits.map(({ product, index, available }) => ({
    field: formatIssuePath(['items', index, 'quantity']),
    message:
      `«${product.name}» uchun omborda faqat ${formatQuantity(available)} ${UNIT_LABELS[product.unit] ?? ''} bor`.trim(),
  }));
  return new AppError(ErrorCode.INSUFFICIENT_STOCK, { details });
}

/** `"12.500"` → `"12.5"`, `"3.000"` → `"3"` (xabar uchun; hisob-kitob emas). */
function formatQuantity(quantity: string): string {
  return quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity;
}

/** Pul ayirmasi (2 kasr) — BigInt bilan, float'siz. */
function subtractMoney(a: string, b: string): string {
  const cents = (v: string) => {
    const [int = '0', frac = ''] = v.split('.');
    return BigInt(int) * 100n + BigInt((frac + '00').slice(0, 2));
  };
  const diff = cents(a) - cents(b);
  const sign = diff < 0n ? '-' : '';
  const abs = diff < 0n ? -diff : diff;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
