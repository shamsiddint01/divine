import { z } from 'zod';
import type { ApiErrorDetail } from '../errors/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';

type RawIssue = z.core.$ZodRawIssue;

/**
 * Zod uchun global o'zbekcha error map. Sxemada aniq xabar berilmagan holatlar uchun ishlaydi.
 * Har bir ilova (api, web) ishga tushishda `configureZodUzbek()` ni chaqiradi.
 */
export function uzErrorMap(issue: RawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined || issue.input === null) return M.required;
      switch (issue.expected) {
        case 'string':
          return M.mustBeString;
        case 'number':
        case 'int':
        case 'bigint':
          return M.mustBeNumber;
        case 'boolean':
          return M.mustBeBoolean;
        case 'array':
          return M.mustBeArray;
        case 'object':
          return M.mustBeObject;
        default:
          return M.invalidValue;
      }
    }
    case 'too_small': {
      const min = issue.minimum as number | bigint;
      if (issue.origin === 'string') return Number(min) <= 1 ? M.required : M.tooShort(Number(min));
      if (issue.origin === 'array' || issue.origin === 'set') return M.arrayTooSmall(min);
      return M.numberTooSmall(min);
    }
    case 'too_big': {
      const max = issue.maximum as number | bigint;
      if (issue.origin === 'string') return M.tooLong(Number(max));
      if (issue.origin === 'array' || issue.origin === 'set') return M.arrayTooBig(max);
      return M.numberTooBig(max);
    }
    case 'invalid_format':
      if (issue.format === 'uuid' || issue.format === 'guid') return M.invalidId;
      if (issue.format === 'date' || issue.format === 'datetime') return M.invalidDate;
      return M.invalidFormat;
    case 'not_multiple_of':
      return M.mustBeInteger;
    case 'unrecognized_keys':
      return M.unknownFields;
    case 'invalid_value':
    case 'invalid_union':
    case 'invalid_key':
    case 'invalid_element':
      return M.invalidValue;
    default:
      return M.invalidFormat;
  }
}

let configured = false;

/** Zod'ning global error map'ini o'zbekchaga o'rnatadi. Takroriy chaqiruv xavfsiz. */
export function configureZodUzbek(): void {
  if (configured) return;
  z.config({ customError: uzErrorMap });
  configured = true;
}

/** `['items', 0, 'quantity']` → `items[0].quantity` */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`;
    const name = String(key);
    return acc ? `${acc}.${name}` : name;
  }, '');
}

/** ZodError → API error `details` massivi. */
export function zodIssuesToDetails(error: z.ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    field: formatIssuePath(issue.path),
    message: issue.message,
  }));
}
