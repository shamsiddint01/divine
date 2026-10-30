import { describe, expect, it } from 'vitest';
import {
  warehouseCreateSchema,
  warehouseStatusSchema,
  warehouseUpdateSchema,
} from './warehouses.js';

describe('ombor sxemalari (API §7)', () => {
  it('yaratish: nom trim qilinadi, bo‘sh manzil → null', () => {
    expect(warehouseCreateSchema.parse({ name: '  Asosiy ombor ', address: '  ' })).toEqual({
      name: 'Asosiy ombor',
      address: null,
    });
  });

  it('bo‘sh nom, 300 belgidan uzun manzil va noma’lum maydon rad etiladi', () => {
    for (const bad of [
      { name: '   ' },
      { name: 'Ombor', address: 'x'.repeat(301) },
      { name: 'Ombor', status: 'INACTIVE' },
    ]) {
      expect(warehouseCreateSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('tahrirlash: kamida bitta maydon; manzilni tozalash mumkin', () => {
    expect(warehouseUpdateSchema.safeParse({}).success).toBe(false);
    expect(warehouseUpdateSchema.parse({ address: '' })).toEqual({ address: null });
  });

  it('holat: faqat ACTIVE yoki INACTIVE', () => {
    expect(warehouseStatusSchema.parse({ status: 'INACTIVE' })).toEqual({ status: 'INACTIVE' });
    expect(warehouseStatusSchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });
});
