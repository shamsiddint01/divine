import { describe, expect, it } from 'vitest';
import { customerCreateSchema, customerUpdateSchema } from './customers.js';

describe('mijoz sxemalari (API §10, BR-05, BR-06)', () => {
  it('ism trim; telefon +998XXXXXXXXX ga normallashtiriladi; bo‘sh telefon/izoh → null', () => {
    expect(
      customerCreateSchema.parse({ name: '  Aziz Karimov ', phone: '90 123-45-67', notes: ' ' }),
    ).toEqual({ name: 'Aziz Karimov', phone: '+998901234567', notes: null });
    expect(customerCreateSchema.parse({ name: 'Aziz', phone: '' })).toEqual({
      name: 'Aziz',
      phone: null,
    });
  });

  it.each([
    ['bo‘sh ism', { name: '   ' }],
    ['ismsiz', { phone: '+998901234567' }],
    ['150 belgidan uzun ism', { name: 'x'.repeat(151) }],
    ['noto‘g‘ri telefon', { name: 'Aziz', phone: '12345' }],
    ['xorijiy raqam', { name: 'Aziz', phone: '+7 999 123 45 67' }],
    ['harfli telefon', { name: 'Aziz', phone: '90abc4567' }],
    ['yig‘ma maydon', { name: 'Aziz', totalSpent: '100' }],
    ['1000 belgidan uzun izoh', { name: 'Aziz', notes: 'x'.repeat(1001) }],
  ])('rad etiladi: %s', (_label, body) => {
    expect(customerCreateSchema.safeParse(body).success).toBe(false);
  });

  it('tahrirlash: kamida bitta maydon; telefon va izohni null bilan tozalash mumkin', () => {
    expect(customerUpdateSchema.safeParse({}).success).toBe(false);
    expect(customerUpdateSchema.parse({ phone: null, notes: '' })).toEqual({
      phone: null,
      notes: null,
    });
    expect(customerUpdateSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
