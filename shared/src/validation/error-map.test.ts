import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { configureZodUzbek, formatIssuePath, zodIssuesToDetails } from './error-map.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';

beforeAll(() => configureZodUzbek());

describe('o‘zbekcha global error map (REQ-002)', () => {
  const schema = z.strictObject({
    name: z.string().max(5),
    age: z.number().int().min(18),
    tags: z.array(z.string()).min(1),
  });

  it('yetishmayotgan maydon uchun "Majburiy maydon"', () => {
    const result = schema.safeParse({ age: 20, tags: ['a'] });
    expect(result.error?.issues[0]?.message).toBe(M.required);
  });

  it('noto‘g‘ri tip, chegaralar va ortiqcha maydonlar o‘zbekcha', () => {
    const result = schema.safeParse({ name: 'uzun nom', age: 10, tags: [], extra: 1 });
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain(M.tooLong(5));
    expect(messages).toContain(M.numberTooSmall(18));
    expect(messages).toContain(M.arrayTooSmall(1));
    expect(messages).toContain(M.unknownFields);
  });

  it('hech bir xabar inglizcha Zod standart matni emas', () => {
    const result = schema.safeParse({ name: 1, age: 'x', tags: 'y', extra: true });
    for (const issue of result.error?.issues ?? []) {
      expect(issue.message).not.toMatch(/Invalid|expected|Required|Unrecognized/);
    }
  });
});

describe('har bir Zod xato turi o‘zbekcha (AC-25, Phase 15)', () => {
  const first = (schema: z.ZodType, input: unknown) =>
    schema.safeParse(input).error?.issues[0]?.message;

  it('tiplar: string, number, boolean, array, object va boshqalar', () => {
    expect(first(z.string(), 1)).toBe(M.mustBeString);
    expect(first(z.number(), 'x')).toBe(M.mustBeNumber);
    expect(first(z.int(), 'x')).toBe(M.mustBeNumber);
    expect(first(z.bigint(), 'x')).toBe(M.mustBeNumber);
    expect(first(z.boolean(), 'x')).toBe(M.mustBeBoolean);
    expect(first(z.array(z.string()), 'x')).toBe(M.mustBeArray);
    expect(first(z.object({}), 'x')).toBe(M.mustBeObject);
    expect(first(z.date(), 'x')).toBe(M.invalidValue);
    expect(first(z.string(), null)).toBe(M.required);
  });

  it('chegaralar: matn, son, massiv va to‘plam', () => {
    expect(first(z.string().min(1), '')).toBe(M.required);
    expect(first(z.string().min(3), 'ab')).toBe(M.tooShort(3));
    expect(first(z.string().max(2), 'abc')).toBe(M.tooLong(2));
    expect(first(z.number().max(5), 6)).toBe(M.numberTooBig(5));
    expect(first(z.array(z.number()).max(1), [1, 2])).toBe(M.arrayTooBig(1));
    expect(first(z.set(z.number()).min(2), new Set([1]))).toBe(M.arrayTooSmall(2));
  });

  it('format, karrali, qiymat, union, kalit va element xatolari', () => {
    expect(first(z.uuid(), 'x')).toBe(M.invalidId);
    expect(first(z.iso.date(), '2026-13-40')).toBe(M.invalidDate);
    expect(first(z.iso.datetime(), 'x')).toBe(M.invalidDate);
    expect(first(z.email(), 'x')).toBe(M.invalidFormat);
    expect(first(z.number().multipleOf(2), 3)).toBe(M.mustBeInteger);
    expect(first(z.enum(['A', 'B']), 'C')).toBe(M.invalidValue);
    expect(first(z.union([z.literal('a'), z.literal(1)]), true)).toBe(M.invalidValue);
    expect(first(z.record(z.string().regex(/^a$/), z.number()), { b: 1 })).toBe(M.invalidValue);
    expect(first(z.map(z.string(), z.number()), new Map([['a', 'x']]))).toBe(M.mustBeNumber);
    expect(
      first(
        z.string().refine(() => false),
        'x',
      ),
    ).toBe(M.invalidFormat);
  });
});

describe('zodIssuesToDetails', () => {
  it('yo‘lni items[0].quantity ko‘rinishida beradi', () => {
    expect(formatIssuePath(['items', 0, 'quantity'])).toBe('items[0].quantity');
    expect(formatIssuePath([])).toBe('');

    const schema = z.object({ items: z.array(z.object({ quantity: z.string() })) });
    const result = schema.safeParse({ items: [{ quantity: 5 }] });
    expect(zodIssuesToDetails(result.error!)).toEqual([
      { field: 'items[0].quantity', message: M.mustBeString },
    ]);
  });
});
