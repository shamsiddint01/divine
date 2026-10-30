import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  type CustomerCreateInput,
  type CustomerDto,
  type CustomerPurchasesResponse,
  type CustomerUpdateInput,
  ErrorCode,
  type Paginated,
  Permission,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import { type AccessContext, hasPermission } from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import { SalesRepository } from '../sales/sales.repository.js';
import { toSaleDto } from '../sales/sales.service.js';
import {
  type CustomerRow,
  CustomersRepository,
  type ListCustomersQuery,
  type PurchasesQuery,
} from './customers.repository.js';

/** Yig'malar bo'yicha saralash ham xarid ma'lumotini oshkor qiladi — faqat `customers.read_history`. */
const HISTORY_SORTS = new Set(['totalSpent', 'purchaseCount']);

/**
 * Javob serializeri (OWN-07): `customers.read_history`siz user faqat `id, name, phone` ni oladi —
 * izoh, yig'malar va sanalar kaliti umuman yo'q. Barcha mijoz javoblari shu yerdan o'tadi.
 */
export function toCustomerDto(row: CustomerRow, full: boolean): CustomerDto {
  const base = { id: row.id, name: row.name, phone: row.phone };
  if (!full) return base;
  return {
    ...base,
    notes: row.notes,
    purchaseCount: row.purchaseCount,
    totalSpent: row.totalSpent,
    lastPurchaseAt: row.lastPurchaseAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Mijozlar (Phase 9, API §10, BR-05, BR-06, OWN-07, A-23, BR-30). Ism va telefon unique emas —
 * takroriy mijoz rad etilmaydi. O'chirish va arxivlash yo'q (sxemada holat yo'q; sotuvlar FK RESTRICT).
 * Audit metadata'siga shaxsiy qiymatlar (ism, telefon, izoh) yozilmaydi — faqat maydon nomlari.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly repository: CustomersRepository,
    private readonly sales: SalesRepository,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: AccessContext, query: ListCustomersQuery): Promise<Paginated<CustomerDto>> {
    const full = hasPermission(ctx, Permission.CUSTOMERS_READ_HISTORY);
    if (!full && HISTORY_SORTS.has(query.sort.field)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'sort', message: VALIDATION_MESSAGES_UZ.invalidSort }],
      });
    }
    const { rows, total } = await this.repository.list(query);
    return toPaginated(
      rows.map((row) => toCustomerDto(row, full)),
      total,
      query,
    );
  }

  async get(id: string): Promise<CustomerDto> {
    return toCustomerDto((await this.repository.find(id)) ?? notFound(), true);
  }

  async create(
    ctx: AccessContext,
    input: CustomerCreateInput,
    meta: RequestMeta,
  ): Promise<CustomerDto> {
    // Izoh — ichki ma'lumot: faqat tahrirlash ruxsati borlar yozadi (API §10). Bo'sh izoh — cheklov yo'q.
    if (input.notes && !hasPermission(ctx, Permission.CUSTOMERS_MANAGE)) {
      throw new AppError(ErrorCode.FORBIDDEN, {
        details: [{ field: 'notes', message: VALIDATION_MESSAGES_UZ.notesForbidden }],
      });
    }
    return this.transactions.run(async (tx) => {
      const id = await this.repository.create(tx, {
        name: input.name,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        createdById: ctx.userId,
      });
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.CUSTOMER_CREATED,
          entityType: AuditEntityType.CUSTOMER,
          entityId: id,
          metadata: { hasPhone: Boolean(input.phone), hasNotes: Boolean(input.notes) },
          meta,
        },
        tx,
      );
      const row = (await this.repository.find(id, tx)) ?? notFound();
      return toCustomerDto(row, hasPermission(ctx, Permission.CUSTOMERS_READ_HISTORY));
    });
  }

  /** O'tgan sotuvlardagi mijoz snapshot'i (`customer_name_snapshot`, `…phone_snapshot`) o'zgarmaydi. */
  async update(
    ctx: AccessContext,
    id: string,
    input: CustomerUpdateInput,
    meta: RequestMeta,
  ): Promise<CustomerDto> {
    return this.transactions.run(async (tx) => {
      const current = (await this.repository.lock(tx, id)) ?? notFound();
      const changes: { name?: string; phone?: string | null; notes?: string | null } = {};
      if (input.name !== undefined && input.name !== current.name) changes.name = input.name;
      if (input.phone !== undefined && input.phone !== current.phone) changes.phone = input.phone;
      if (input.notes !== undefined && input.notes !== current.notes) changes.notes = input.notes;
      const fields = Object.keys(changes);
      if (fields.length > 0) {
        await this.repository.update(tx, id, changes);
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.CUSTOMER_UPDATED,
            entityType: AuditEntityType.CUSTOMER,
            entityId: id,
            metadata: { fields },
            meta,
          },
          tx,
        );
      }
      return toCustomerDto((await this.repository.find(id, tx)) ?? notFound(), true);
    });
  }

  /** Xarid tarixi (REQ-080) — haqiqiy sotuvlardan; yig'ma — mijoz qatoridagi cache ustunlardan. */
  async purchases(
    ctx: AccessContext,
    id: string,
    query: PurchasesQuery,
  ): Promise<CustomerPurchasesResponse> {
    const customer = (await this.repository.find(id)) ?? notFound();
    const { page, pageSize, sort, ...dates } = query;
    const { rows, total } = await this.sales.list(
      { customerId: id, ...dates },
      { page, pageSize, sort },
      true,
    );
    const canReadCost = hasPermission(ctx, Permission.PRODUCTS_READ_COST);
    return {
      ...toPaginated(
        rows.map((row) => toSaleDto(row, canReadCost)),
        total,
        query,
      ),
      summary: {
        purchaseCount: customer.purchaseCount,
        totalSpent: customer.totalSpent,
        lastPurchaseAt: customer.lastPurchaseAt?.toISOString() ?? null,
      },
    };
  }
}

function notFound(): never {
  throw new AppError(ErrorCode.NOT_FOUND);
}
