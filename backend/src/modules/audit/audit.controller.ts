import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuditLogDto,
  auditLogIdSchema,
  type AuditLogPage,
  type AuditLogQuery,
  auditLogQuerySchema,
  ErrorCode,
  Permission,
} from '@divine/shared';
import { RequirePermissions } from '../../common/auth/auth.decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodParam, ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { AuditRepository } from './audit.repository.js';

/**
 * Audit jurnali (Phase 13, API §15, REQ-121, REQ-122): faqat o'qish, `audit.read` (ADMIN).
 * Yozish, o'zgartirish va o'chirish endpointlari ataylab yo'q (D-06, BR-25).
 */
@ApiTags('Audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly repository: AuditRepository) {}

  @Get()
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOperation({ summary: 'Audit jurnali (filtrlar, cursor pagination, yangilari birinchi)' })
  @ApiOkResponse({ description: 'AuditLogPage' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  list(@ZodQuery(auditLogQuerySchema) query: AuditLogQuery): Promise<AuditLogPage> {
    return this.repository.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOperation({ summary: 'Audit yozuvi' })
  @ApiOkResponse({ description: 'AuditLogDto' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  async get(@ZodParam('id', auditLogIdSchema) id: string): Promise<AuditLogDto> {
    const row = await this.repository.get(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return row;
  }
}
