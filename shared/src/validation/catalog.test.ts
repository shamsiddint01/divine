import { describe, expect, it } from 'vitest';
import {
  productCreateSchema,
  productGroupUpdateSchema,
  productStatusSchema,
  productUpdateSchema,
} from './catalog.js';

const GROUP = '01990000-0000-7000-8000-000000000001';
const base = {
  name: 'Redmi 13',
  groupId: GROUP,
  costPrice: '1800000',
  salePrice: '2150000.50',
  unit: 'DONA',
  allowDecimal: false,
};

describe('katalog sxemalari (API §5–6, BR-13)', () => {
  it('mahsulot: holat standart ACTIVE; bo‘sh shtrix-kod va minStock → null', () => {
    expect(productCreateSchema.parse({ ...base, barcode: '  ', minStock: '' })).toMatchObject({
      status: 'ACTIVE',
      barcode: null,
      minStock: null,
    });
  });

  it('DONA + kasr, manfiy narx, noto‘g‘ri birlik va guruh, noma’lum maydon — rad etiladi', () => {
    for (const bad of [
      { allowDecimal: true },
      { salePrice: '-5' },
      { unit: 'QUTI' },
      { groupId: 'yoq' },
      { stock: '5' },
      { barcode: '478 000' },
    ]) {
      expect(productCreateSchema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
    expect(productCreateSchema.safeParse({ ...base, unit: 'KG', allowDecimal: true }).success).toBe(
      true,
    );
  });

  it('tahrirlash: qisman, kamida bitta maydon; holat — faqat ACTIVE/INACTIVE', () => {
    expect(productUpdateSchema.parse({ salePrice: '1' })).toEqual({ salePrice: '1' });
    expect(productUpdateSchema.safeParse({}).success).toBe(false);
    expect(productStatusSchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });

  it('guruh: arxivlash (isActive) va tavsifni tozalash', () => {
    expect(productGroupUpdateSchema.parse({ isActive: false, description: '' })).toEqual({
      isActive: false,
      description: null,
    });
    expect(productGroupUpdateSchema.safeParse({}).success).toBe(false);
  });
});
