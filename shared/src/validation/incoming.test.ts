import { describe, expect, it } from 'vitest';
import { incomingCreateSchema, incomingUpdateSchema } from './incoming.js';

const W = '01990000-0000-7000-8000-000000000001';
const P1 = '01990000-0000-7000-8000-000000000002';
const P2 = '01990000-0000-7000-8000-000000000003';
const base = {
  date: '2026-10-06',
  warehouseId: W,
  items: [
    { productId: P1, quantity: '50', costPrice: '1800000.00' },
    { productId: P2, quantity: '2.5', costPrice: '0' },
  ],
};

describe('kirim sxemalari (API §9, BR-14, BR-18, REQ-065)', () => {
  it('to‘g‘ri hujjat; bo‘sh izoh → null', () => {
    expect(incomingCreateSchema.parse({ ...base, notes: '  ' })).toMatchObject({ notes: null });
  });

  it('client totallari va noma’lum maydonlar rad etiladi (totalni faqat server hisoblaydi)', () => {
    expect(incomingCreateSchema.safeParse({ ...base, totalAmount: '1' }).success).toBe(false);
    const withLineTotal = {
      ...base,
      items: [{ productId: P1, quantity: '1', costPrice: '1', lineTotal: '999' }],
    };
    expect(incomingCreateSchema.safeParse(withLineTotal).success).toBe(false);
  });

  it.each([
    ['nol miqdor', { quantity: '0' }],
    ['manfiy miqdor', { quantity: '-1' }],
    ['4 kasr xona', { quantity: '1.0001' }],
    ['NaN', { quantity: 'NaN' }],
    ['Infinity', { costPrice: 'Infinity' }],
    ['manfiy narx', { costPrice: '-5' }],
    ['3 kasr xonali narx', { costPrice: '1.005' }],
    ['juda katta narx', { costPrice: '1'.repeat(17) }],
    ['raqam turi', { quantity: 5 }],
    ['noto‘g‘ri mahsulot ID', { productId: 'abc' }],
  ])('qator: %s → rad etiladi', (_label, patch) => {
    const items = [{ productId: P1, quantity: '1', costPrice: '100', ...patch }];
    expect(incomingCreateSchema.safeParse({ ...base, items }).success).toBe(false);
  });

  it('bo‘sh, takroriy mahsulot va noto‘g‘ri sana rad etiladi; xato yo‘li items.1.productId', () => {
    expect(incomingCreateSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    const dup = incomingCreateSchema.safeParse({
      ...base,
      items: [
        { productId: P1, quantity: '1', costPrice: '1' },
        { productId: P1, quantity: '2', costPrice: '1' },
      ],
    });
    expect(dup.success).toBe(false);
    expect(dup.error?.issues[0]?.path).toEqual(['items', 1, 'productId']);
    expect(incomingCreateSchema.safeParse({ ...base, date: '06.10.2026' }).success).toBe(false);
  });

  it('tahrirlash: kamida bitta maydon; items berilsa — to‘liq qoidalar bilan', () => {
    expect(incomingUpdateSchema.safeParse({}).success).toBe(false);
    expect(incomingUpdateSchema.parse({ notes: null })).toEqual({ notes: null });
    expect(incomingUpdateSchema.safeParse({ items: [] }).success).toBe(false);
  });
});
