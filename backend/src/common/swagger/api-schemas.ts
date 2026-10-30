import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ERROR_MESSAGES_UZ, ErrorCode } from '@divine/shared';
import { httpStatusFor } from '../errors/error-status.js';

/**
 * OpenAPI sxemalari — docs/API.md §1.2–§1.4 contract'ining hujjatdagi aksi.
 * TypeScript tiplari `@divine/shared` da (`ApiErrorBody`, `Paginated<T>`); bu klasslar faqat Swagger uchun.
 */

export class ApiErrorDetailDto {
  @ApiProperty({ example: 'items[0].quantity' })
  field!: string;

  @ApiProperty({ example: 'Miqdor noldan katta bo‘lishi kerak' })
  message!: string;
}

export class ApiErrorDto {
  @ApiProperty({ enum: Object.values(ErrorCode), example: ErrorCode.VALIDATION_ERROR })
  code!: string;

  @ApiProperty({ example: ERROR_MESSAGES_UZ.VALIDATION_ERROR, description: 'O‘zbekcha xabar' })
  message!: string;

  @ApiPropertyOptional({ type: [ApiErrorDetailDto] })
  details?: ApiErrorDetailDto[];

  @ApiPropertyOptional({
    example: 'bd7d8535-ae83-4d59-a032-539cde15b31a',
    description: '`X-Request-Id` header bilan bir xil — server log’ini topish uchun',
  })
  requestId?: string;
}

export class ApiErrorBodyDto {
  @ApiProperty({ type: ApiErrorDto })
  error!: ApiErrorDto;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1, minimum: 1 })
  page!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 100 })
  pageSize!: number;

  @ApiProperty({ example: 134 })
  total!: number;

  @ApiProperty({ example: 7 })
  totalPages!: number;
}

/** Barcha endpointlarda bo'lishi mumkin bo'lgan javoblar (DocumentBuilder global response). */
export const GLOBAL_ERROR_RESPONSES = [
  { status: 429, code: ErrorCode.RATE_LIMITED },
  { status: 500, code: ErrorCode.INTERNAL_ERROR },
  { status: 503, code: ErrorCode.SERVICE_UNAVAILABLE },
].map(({ status, code }) => ({
  status,
  description: `${code} — ${ERROR_MESSAGES_UZ[code]}`,
  schema: { $ref: getSchemaPath(ApiErrorBodyDto) },
}));

/** Endpointga xos xato javoblari: `@ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.CONFLICT)`. */
export function ApiErrorResponses(...codes: ErrorCode[]) {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = httpStatusFor(code);
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return applyDecorators(
    ApiExtraModels(ApiErrorBodyDto),
    ...[...byStatus].map(([status, list]) =>
      ApiResponse({
        status,
        description: list.map((code) => `${code} — ${ERROR_MESSAGES_UZ[code]}`).join('; '),
        schema: { $ref: getSchemaPath(ApiErrorBodyDto) },
      }),
    ),
  );
}

/** Ro'yxat javobi: `{ data: T[], meta: PaginationMeta }` (API §1.2). */
export function ApiPaginatedResponse(model: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(PaginationMetaDto, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
  );
}
