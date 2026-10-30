import { describe, expect, it } from 'vitest';
import { uz } from './uz';

function collectStrings(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      collectStrings(value, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

describe('o‘zbekcha lug‘at (REQ-002)', () => {
  const entries = collectStrings(uz);

  it('barcha matnlar bo‘sh emas', () => {
    for (const [path, value] of entries) expect(value.trim(), path).not.toBe('');
  });

  it('kirill harflari ishlatilmagan (faqat lotin yozuvi)', () => {
    for (const [path, value] of entries) expect(value, path).not.toMatch(/[Ѐ-ӿ]/);
  });

  it('o‘ va g‘ harflarida to‘g‘ri belgi (‘) ishlatilgan, oddiy apostrof emas', () => {
    for (const [path, value] of entries) expect(value, path).not.toMatch(/[oOgG]'/);
  });
});
