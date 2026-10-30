import { Body, Param, type PipeTransform, Query } from '@nestjs/common';
import { configureZodUzbek, ErrorCode, zodIssuesToDetails } from '@divine/shared';
import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';

/**
 * Zod sxemasi bilan validatsiya (ARCHITECTURE §5.3). Sxemalar `@divine/shared` dan olinadi —
 * frontend formasi va server bir xil qoidalarni, bir xil o'zbekcha xabarlarni ishlatadi.
 * Xato → `400 VALIDATION_ERROR` + `details: [{ field, message }]` (API §1.3).
 *
 * Natija — sxemaning `output`i: transform/coerce/default'lar qo'llangan, tiplangan qiymat.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly schema: S,
    /** Bitta qiymatli parametr uchun (masalan `:id`) — xato tafsilotidagi maydon nomi. */
    private readonly field?: string,
  ) {
    // Global o'zbekcha error map (idempotent). main.ts ham chaqiradi; bu — testlar va CLI uchun kafolat.
    configureZodUzbek();
  }

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const details = zodIssuesToDetails(result.error).map((detail) =>
      this.field
        ? { ...detail, field: detail.field ? `${this.field}.${detail.field}` : this.field }
        : detail,
    );
    throw new AppError(ErrorCode.VALIDATION_ERROR, { details });
  }
}

/** `create(@ZodBody(createProductSchema) body: CreateProductInput)` — body uchun `z.strictObject` ishlating (API §1.1). */
export const ZodBody = (schema: z.ZodType) => Body(new ZodValidationPipe(schema));

/** `list(@ZodQuery(listSchema) query: ListQuery)` — pagination, sort va filtrlar. */
export const ZodQuery = (schema: z.ZodType) => Query(new ZodValidationPipe(schema));

/** `get(@ZodParam('id', uuidSchema) id: string)` */
export const ZodParam = (name: string, schema: z.ZodType) =>
  Param(name, new ZodValidationPipe(schema, name));
