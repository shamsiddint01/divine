import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  type Paginated,
  type ProductGroupCreateInput,
  type ProductGroupDto,
  type ProductGroupUpdateInput,
} from '@divine/shared';
import type { AccessContext } from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import { type ListGroupsQuery, ProductGroupsRepository } from './product-groups.repository.js';

/**
 * Mahsulot guruhlari (Phase 6, API §5). Nom case-insensitive unique (DB: `product_groups_name_lower_key`).
 * Arxivlash (`isActive = false`) — yangi mahsulot qo'shilmaydi, mavjud mahsulotlar va tarix saqlanadi.
 * O'chirish faqat mahsulotsiz guruhga (`409 ENTITY_IN_USE`) — mahsulot havolalari buzilmaydi.
 */
@Injectable()
export class ProductGroupsService {
  constructor(
    private readonly repository: ProductGroupsRepository,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListGroupsQuery): Promise<Paginated<ProductGroupDto>> {
    const { rows, total } = await this.repository.list(query);
    return toPaginated(rows, total, query);
  }

  async get(id: string): Promise<ProductGroupDto> {
    return (await this.repository.findDto(id)) ?? notFound();
  }

  async create(
    ctx: AccessContext,
    input: ProductGroupCreateInput,
    meta: RequestMeta,
  ): Promise<ProductGroupDto> {
    return this.transactions.run(async (tx) => {
      if (await this.repository.nameTaken(tx, input.name)) throw nameTaken();
      const id = await this.repository.create(tx, {
        name: input.name,
        description: input.description ?? null,
        createdById: ctx.userId,
      });
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.PRODUCT_GROUP_CREATED,
          entityType: AuditEntityType.PRODUCT_GROUP,
          entityId: id,
          metadata: { name: input.name },
          meta,
        },
        tx,
      );
      return (await this.repository.findDto(id, tx)) ?? notFound();
    });
  }

  async update(
    ctx: AccessContext,
    id: string,
    input: ProductGroupUpdateInput,
    meta: RequestMeta,
  ): Promise<ProductGroupDto> {
    return this.transactions.run(async (tx) => {
      const group = (await this.repository.lock(tx, id)) ?? notFound();
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (input.name !== undefined && input.name !== group.name) {
        if (await this.repository.nameTaken(tx, input.name, id)) throw nameTaken();
        changes.name = { from: group.name, to: input.name };
      }
      if (input.description !== undefined && input.description !== group.description) {
        changes.description = { from: group.description, to: input.description };
      }
      if (input.isActive !== undefined && input.isActive !== group.isActive) {
        changes.isActive = { from: group.isActive, to: input.isActive };
      }
      if (Object.keys(changes).length > 0) {
        await this.repository.update(
          tx,
          id,
          Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.to])),
        );
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.PRODUCT_GROUP_UPDATED,
            entityType: AuditEntityType.PRODUCT_GROUP,
            entityId: id,
            metadata: { name: input.name ?? group.name, changes },
            meta,
          },
          tx,
        );
      }
      return (await this.repository.findDto(id, tx)) ?? notFound();
    });
  }

  async delete(ctx: AccessContext, id: string, meta: RequestMeta): Promise<void> {
    await this.transactions.run(async (tx) => {
      const group = (await this.repository.lock(tx, id)) ?? notFound();
      if ((await this.repository.productCount(tx, id)) > 0) {
        throw new AppError(ErrorCode.ENTITY_IN_USE);
      }
      await this.repository.delete(tx, id);
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.PRODUCT_GROUP_DELETED,
          entityType: AuditEntityType.PRODUCT_GROUP,
          entityId: id,
          metadata: { name: group.name },
          meta,
        },
        tx,
      );
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
