import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  normalizeThreshold,
  type SettingsDto,
  type SettingsUpdateInput,
} from '@divine/shared';
import type { AccessContext } from '../../common/auth/access-context.js';
import { DEFAULT_SETTINGS } from '../../database/seed/reference-data.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { TransactionRunner, type Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';

/** API maydoni → `settings.key` (seed bilan bir xil kalitlar). */
const KEYS = {
  companyName: 'company_name',
  lowStockDefaultThreshold: 'low_stock_default_threshold',
  currencyLabel: 'currency_label',
} as const satisfies Record<keyof SettingsDto, keyof typeof DEFAULT_SETTINGS>;

type Field = keyof typeof KEYS;
const FIELDS = Object.keys(KEYS) as Field[];

/**
 * Sozlamalar (Phase 12, API §16, D-21): faqat 3 ta maydon. Kam qoldiq chegarasi dashboard, mahsulot va
 * ombor hisobotlarida darhol qo'llanadi (har so'rovda `settings`dan o'qiladi). Audit — `before/after`.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
  ) {}

  get(): Promise<SettingsDto> {
    return this.read(this.prisma);
  }

  async update(
    ctx: AccessContext,
    input: SettingsUpdateInput,
    meta: RequestMeta,
  ): Promise<SettingsDto> {
    return this.transactions.run(async (tx) => {
      // Kalit qatorlari qulflanadi — parallel PATCH'lar audit'dagi `from` qiymatini buzmaydi.
      await tx.$queryRaw`SELECT key FROM settings WHERE key = ANY(${Object.values(KEYS)}::text[]) FOR UPDATE`;
      const current = await this.read(tx);
      const changes: Partial<Record<Field, { from: string; to: string }>> = {};
      for (const field of FIELDS) {
        const raw = input[field];
        if (raw === undefined) continue;
        const next = field === 'lowStockDefaultThreshold' ? normalizeThreshold(raw) : raw;
        if (next !== current[field]) changes[field] = { from: current[field], to: next };
      }
      for (const [field, change] of Object.entries(changes) as [Field, { to: string }][]) {
        await tx.setting.upsert({
          where: { key: KEYS[field] },
          create: { key: KEYS[field], value: change.to, updatedById: ctx.userId },
          update: { value: change.to, updatedById: ctx.userId },
        });
      }
      if (Object.keys(changes).length > 0) {
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.SETTINGS_UPDATED,
            entityType: AuditEntityType.SETTINGS,
            entityId: null,
            metadata: { changes },
            meta,
          },
          tx,
        );
      }
      return this.read(tx);
    });
  }

  private async read(client: Tx | PrismaService): Promise<SettingsDto> {
    const rows = await client.setting.findMany({ where: { key: { in: Object.values(KEYS) } } });
    const value = (field: Field): string => {
      const row = rows.find((r) => r.key === KEYS[field]);
      return typeof row?.value === 'string' ? row.value : DEFAULT_SETTINGS[KEYS[field]];
    };
    return {
      companyName: value('companyName'),
      lowStockDefaultThreshold: value('lowStockDefaultThreshold'),
      currencyLabel: value('currencyLabel'),
    };
  }
}
