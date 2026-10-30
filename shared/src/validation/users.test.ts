import { describe, expect, it } from 'vitest';
import {
  createUserSchema,
  replaceUserWarehousesSchema,
  updateUserSchema,
  updateUserStatusSchema,
} from './users.js';

const W1 = '01990000-0000-7000-8000-000000000001';
const W2 = '01990000-0000-7000-8000-000000000002';

describe('user sxemalari (API §4, BR-02…04)', () => {
  it('yaratish: parol maydoni qabul qilinmaydi; omborlar standart []; ism trim', () => {
    expect(createUserSchema.parse({ login: 'aziz', role: 'USER', fullName: ' Aziz ' })).toEqual({
      login: 'aziz',
      role: 'USER',
      fullName: 'Aziz',
      warehouseIds: [],
    });
    for (const extra of [{ password: '123456' }, { passwordHash: 'x' }, { permissions: [] }]) {
      expect(createUserSchema.safeParse({ login: 'aziz', role: 'USER', ...extra }).success).toBe(
        false,
      );
    }
  });

  it('ism: bo‘sh → null, boshqaruv belgilari va 150 dan uzun → xato', () => {
    expect(updateUserSchema.parse({ fullName: '   ' })).toEqual({ fullName: null });
    expect(updateUserSchema.safeParse({ fullName: 'a\tb' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ fullName: 'a\u007fb' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ fullName: 'x'.repeat(151) }).success).toBe(false);
    expect(updateUserSchema.parse({ fullName: 'Ўзбек Ism-Familiya' })).toEqual({
      fullName: 'Ўзбек Ism-Familiya',
    });
  });

  it('tahrirlash: kamida bitta maydon; login o‘zgartirilmaydi', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
    expect(updateUserSchema.safeParse({ login: 'boshqa' }).success).toBe(false);
    expect(updateUserSchema.parse({ role: 'ADMIN' })).toEqual({ role: 'ADMIN' });
  });

  it('omborlar: UUID, takrorsiz; holat — faqat ACTIVE/BLOCKED', () => {
    expect(replaceUserWarehousesSchema.parse({ warehouseIds: [W1, W2] })).toEqual({
      warehouseIds: [W1, W2],
    });
    expect(replaceUserWarehousesSchema.safeParse({ warehouseIds: [W1, W1] }).success).toBe(false);
    expect(replaceUserWarehousesSchema.safeParse({ warehouseIds: ['ombor-1'] }).success).toBe(
      false,
    );
    expect(updateUserStatusSchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });
});
