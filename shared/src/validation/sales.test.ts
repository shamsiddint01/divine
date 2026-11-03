import { describe, expect, it } from 'vitest';
import { idempotencyKeySchema, saleCreateSchema } from './sales.js';

const W = '01990000-0000-7000-8000-000000000001';
const P = '01990000-0000-7000-8000-000000000002';
const C = '01990000-0000-7000-8000-000000000003';
const items = [{ productId: P, quantity: '2' }];

describe('sotuv sxemasi (API §11, BR-05, BR-06, BR-15)', () => {
  it('yangi mijoz: ism trim, telefon ixtiyoriy va normallashtiriladi (AC-16)', () => {
    expect(
      saleCreateSchema.parse({ warehouseId: W, customer: { name: ' Aziz ' }, items }).customer,
    ).toEqual({ name: 'Aziz', phone: null });
    expect(
      saleCreateSchema.parse({
        warehouseId: W,
        customer: { name: 'Aziz', phone: '90 123 45 67' },
        items,
      }).customer,
    ).toEqual({ name: 'Aziz', phone: '+998901234567' });
  });

  it('mavjud mijoz: faqat id', () => {
    expect(saleCreateSchema.parse({ warehouseId: W, customer: { id: C }, items }).customer).toEqual(
      { id: C },
    );
    expect(
      saleCreateSchema.safeParse({ warehouseId: W, customer: { id: C, name: 'X' }, items }).success,
    ).toBe(false);
  });

  it('ismsiz mijoz → `name: null`, telefon saqlanadi (umumiy mijoz, 2026-11-03)', () => {
    for (const customer of [{}, { name: '  ' }, { name: null }]) {
      expect(saleCreateSchema.parse({ warehouseId: W, customer, items }).customer).toEqual({
        name: null,
        phone: null,
      });
    }
    expect(
      saleCreateSchema.parse({ warehouseId: W, customer: { phone: '90 123 45 67' }, items })
        .customer,
    ).toEqual({ name: null, phone: '+998901234567' });
  });

  it('noto‘g‘ri ism (juda uzun, matn emas) → xato `customer.name` maydonida', () => {
    for (const customer of [{ name: 'A'.repeat(151) }, { name: 5 }]) {
      const res = saleCreateSchema.safeParse({ warehouseId: W, customer, items });
      expect(res.success).toBe(false);
      expect(res.error?.issues[0]?.path).toEqual(['customer', 'name']);
    }
  });

  it.each([
    ['client narxi', { items: [{ productId: P, quantity: '1', unitPrice: '1' }] }],
    ['client total', { totalAmount: '1' }],
    ['bo‘sh qatorlar', { items: [] }],
    ['nol miqdor', { items: [{ productId: P, quantity: '0' }] }],
    ['manfiy miqdor', { items: [{ productId: P, quantity: '-1' }] }],
    [
      '201 ta qator',
      { items: Array.from({ length: 201 }, () => ({ productId: P, quantity: '1' })) },
    ],
    ['noto‘g‘ri ombor', { warehouseId: 'x' }],
  ])('rad etiladi: %s', (_label, patch) => {
    expect(
      saleCreateSchema.safeParse({ warehouseId: W, customer: { name: 'A' }, items, ...patch })
        .success,
    ).toBe(false);
  });

  it('Idempotency-Key — UUID', () => {
    expect(idempotencyKeySchema.safeParse('6f1c0b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f').success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse('123').success).toBe(false);
  });
});
