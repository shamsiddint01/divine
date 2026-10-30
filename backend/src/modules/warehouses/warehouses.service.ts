import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  type MovementDto,
  type Paginated,
  Permission,
  type StockRowDto,
  VALIDATION_MESSAGES_UZ,
  type WarehouseCreateInput,
  type WarehouseDetailDto,
  type WarehouseDto,
  type WarehouseListItemDto,
  type WarehouseStatus,
  type WarehouseUpdateInput,
} from '@divine/shared';
import {
  type AccessContext,
  hasPermission,
  warehouseScope,
} from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { Clock } from '../../common/time/clock.js';
import { localDate, zonedDayStart } from '../../common/time/tashkent-time.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import type { MovementFilter } from '../inventory/inventory.repository.js';
import { InventoryService } from '../inventory/inventory.service.js';
import {
  type ListWarehousesQuery,
  type StockQuery,
  type StockRow,
  type WarehouseRow,
  type WarehouseStatsRow,
  WarehousesRepository,
} from './warehouses.repository.js';

/** Ombor detalidagi kirim/chiqim davri: bugun bilan birga 30 Toshkent kuni. */
const FLOW_DAYS = 30;

export function toWarehouseDto(row: WarehouseRow): WarehouseDto {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Ko'rsatkichlar bilan; `stockValue` FAQAT `products.read_cost` bo'lsa (OWN-06). */
function toStatsDto(row: WarehouseStatsRow, canReadCost: boolean) {
  return {
    ...toWarehouseDto(row),
    productCount: row.productCount,
    totalQuantity: row.totalQuantity,
    ...(canReadCost ? { stockValue: row.stockValue } : {}),
    lowStockCount: row.lowStockCount,
  };
}

function toStockRowDto(row: StockRow, canReadCost: boolean): StockRowDto {
  const { costPrice, stockValue, updatedAt, ...rest } = row;
  return {
    ...rest,
    ...(canReadCost ? { costPrice, stockValue } : {}),
    updatedAt: updatedAt.toISOString(),
  };
}

/** `YYYY-MM-DD` dan `days` kun oldingi sana (taqvim bo'yicha, vaqt mintaqasisiz). */
function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Omborlar (Phase 7, API §7, BR-21, OWN-01, D-13). O'chirish yo'q — faqat nofaol qilish: qoldiq, tarix va
 * user biriktiruvlari saqlanadi, nofaol omborga yangi kirim/sotuv qilinmaydi (`InventoryService`).
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly repository: WarehousesRepository,
    private readonly inventory: InventoryService,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * `warehouses.read_all` — barcha omborlar va ko'rsatkichlar. Aks holda (USER, OWN-01) — faqat
   * biriktirilgan va ACTIVE omborlar, faqat asosiy maydonlar (holat filtri e'tiborga olinmaydi).
   */
  async list(
    ctx: AccessContext,
    query: ListWarehousesQuery,
  ): Promise<Paginated<WarehouseListItemDto>> {
    const readAll = hasPermission(ctx, Permission.WAREHOUSES_READ_ALL);
    const canReadCost = hasPermission(ctx, Permission.PRODUCTS_READ_COST);
    const { rows, total } = await this.repository.list(
      readAll ? query : { ...query, status: 'ACTIVE' },
      { scope: warehouseScope(ctx), withStats: readAll },
    );
    return toPaginated(
      rows.map((row) =>
        'productCount' in row ? toStatsDto(row, canReadCost) : toWarehouseDto(row),
      ),
      total,
      query,
    );
  }

  async get(ctx: AccessContext, id: string): Promise<WarehouseDetailDto> {
    const row = (await this.repository.findWithStats(id)) ?? notFound();
    const today = localDate(this.clock.now());
    const flow = await this.repository.flowSince(
      id,
      zonedDayStart(minusDays(today, FLOW_DAYS - 1)),
    );
    return {
      ...toStatsDto(row, hasPermission(ctx, Permission.PRODUCTS_READ_COST)),
      incoming30: flow.incoming,
      outgoing30: flow.outgoing,
    };
  }

  async stock(ctx: AccessContext, id: string, query: StockQuery): Promise<Paginated<StockRowDto>> {
    const canReadCost = hasPermission(ctx, Permission.PRODUCTS_READ_COST);
    // Kelgan narxiga bog'liq tartib ham uni oshkor qiladi (Phase 6 `sort=costPrice` bilan bir xil qoida).
    if (query.sort.field === 'stockValue' && !canReadCost) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'sort', message: VALIDATION_MESSAGES_UZ.invalidSort }],
      });
    }
    await this.assertExists(id);
    const { rows, total } = await this.repository.stock(id, query);
    return toPaginated(
      rows.map((row) => toStockRowDto(row, canReadCost)),
      total,
      query,
    );
  }

  async movements(
    ctx: AccessContext,
    id: string,
    query: Omit<MovementFilter, 'scope' | 'warehouseId'>,
  ): Promise<Paginated<MovementDto>> {
    await this.assertExists(id);
    return this.inventory.listMovements(ctx, { ...query, warehouseId: id });
  }

  private async assertExists(id: string): Promise<void> {
    if (!(await this.repository.find(id))) notFound();
  }

  async create(
    ctx: AccessContext,
    input: WarehouseCreateInput,
    meta: RequestMeta,
  ): Promise<WarehouseDto> {
    return this.transactions.run(async (tx) => {
      if (await this.repository.nameTaken(tx, input.name)) throw nameTaken();
      const id = await this.repository.create(tx, {
        name: input.name,
        address: input.address ?? null,
        createdById: ctx.userId,
      });
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.WAREHOUSE_CREATED,
          entityType: AuditEntityType.WAREHOUSE,
          entityId: id,
          metadata: { name: input.name, address: input.address ?? null },
          meta,
        },
        tx,
      );
      return toWarehouseDto((await this.repository.find(id, tx)) ?? notFound());
    });
  }

  async update(
    ctx: AccessContext,
    id: string,
    input: WarehouseUpdateInput,
    meta: RequestMeta,
  ): Promise<WarehouseDto> {
    return this.transactions.run(async (tx) => {
      const warehouse = (await this.repository.lock(tx, id)) ?? notFound();
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (input.name !== undefined && input.name !== warehouse.name) {
        if (await this.repository.nameTaken(tx, input.name, id)) throw nameTaken();
        changes.name = { from: warehouse.name, to: input.name };
      }
      if (input.address !== undefined && input.address !== warehouse.address) {
        changes.address = { from: warehouse.address, to: input.address };
      }
      if (Object.keys(changes).length > 0) {
        await this.repository.update(tx, id, {
          ...(changes.name ? { name: input.name } : {}),
          ...(changes.address ? { address: input.address ?? null } : {}),
        });
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.WAREHOUSE_UPDATED,
            entityType: AuditEntityType.WAREHOUSE,
            entityId: id,
            metadata: { name: input.name ?? warehouse.name, changes },
            meta,
          },
          tx,
        );
      }
      return toWarehouseDto((await this.repository.find(id, tx)) ?? notFound());
    });
  }

  /**
   * Faollashtirish / nofaol qilish. `FOR UPDATE` qulfi davom etayotgan kirim/sotuv tranzaksiyalari
   * (`FOR SHARE`) tugashini kutadi. Qoldiq, ledger va `user_warehouses` qatorlariga tegilmaydi (D-13).
   * Bir xil holat — o'zgarishsiz, audit yozilmaydi (idempotent).
   */
  async setStatus(
    ctx: AccessContext,
    id: string,
    status: WarehouseStatus,
    meta: RequestMeta,
  ): Promise<WarehouseDto> {
    return this.transactions.run(async (tx) => {
      const warehouse = (await this.repository.lock(tx, id)) ?? notFound();
      if (warehouse.status === status) return toWarehouseDto(warehouse);
      await this.repository.update(tx, id, { status });
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.WAREHOUSE_STATUS_CHANGED,
          entityType: AuditEntityType.WAREHOUSE,
          entityId: id,
          metadata: {
            name: warehouse.name,
            from: warehouse.status,
            to: status,
            ...(await this.repository.usage(tx, id)),
          },
          meta,
        },
        tx,
      );
      return toWarehouseDto((await this.repository.find(id, tx)) ?? notFound());
    });
  }
}

function notFound(): never {
  throw new AppError(ErrorCode.NOT_FOUND);
}

function nameTaken(): AppError {
  return new AppError(ErrorCode.NAME_TAKEN, {
    details: [{ field: 'name', message: ERROR_MESSAGES_UZ.NAME_TAKEN }],
  });
}
