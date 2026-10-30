import { Global, Injectable, Module } from '@nestjs/common';
import type { AuditAction, AuditEntityType } from '@divine/shared';
import { LoginFingerprint } from '../../common/security/login-fingerprint.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditController } from './audit.controller.js';
import { AuditRepository } from './audit.repository.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';

/** So'rov konteksti: kim, qayerdan (audit va sessiyalar uchun). */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface AuditEntry {
  /** NULL — tizim yoki noma'lum (masalan, muvaffaqiyatsiz login). */
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

/** Bu kalitlar audit metadata'siga hech qachon yozilmaydi (SECURITY §14, D-06). */
const FORBIDDEN_KEY = /pass|hash|token|secret|pepper|cookie|authorization/i;
const USER_AGENT_MAX = 300;

function sanitize(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (typeof value !== 'object' || value === null || depth > 4) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !FORBIDDEN_KEY.test(key))
      .map(([key, item]) => [key, sanitize(item, depth + 1)]),
  );
}

/**
 * O'zgarmas audit jurnaliga yozish (REQ-120, REQ-121). Yozuv chaqiruvchining TRANZAKSIYASI ichida
 * qilinadi (`tx`): audit'siz o'zgarish ham, o'zgarishsiz audit ham bo'lmaydi (ARCHITECTURE §12).
 * Jurnalni o'zgartirish/o'chirish imkoniyati yo'q — DB trigger va huquqlar (D-06).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: sanitize(entry.metadata ?? {}) as Prisma.InputJsonObject,
        ip: entry.meta?.ip ?? null,
        userAgent: entry.meta?.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
        requestId: entry.meta?.requestId ?? null,
      },
    });
  }
}

/**
 * `AuditService` — global (har bir modul yozadi); o'qish API'si — `AuditController` (Phase 13).
 * `LoginFingerprint` (SEC-01) ham shu yerda: auth yozishda, audit o'qishda (eski yozuvlar) bir xil kalit.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditRepository,
    {
      provide: LoginFingerprint,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new LoginFingerprint(config.PASSWORD_PEPPER),
    },
  ],
  exports: [AuditService, LoginFingerprint],
})
export class AuditModule {}
