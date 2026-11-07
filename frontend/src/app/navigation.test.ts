import { ROLE_PERMISSIONS, RoleCode, hasAnyPermission } from '@divine/shared';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './navigation';

describe('asosiy navigatsiya (REQ-151, TZ §16)', () => {
  it('TZ’dagi bo‘limlar (Kirim — Mahsulotlar ichida; Nasiya va To‘lov qo‘shilgan) aynan shu tartib va nomlarda', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Bosh sahifa',
      'Userlar',
      'Mahsulotlar',
      'Mahsulot guruhlari',
      'Ombor',
      'Sotuvlar',
      'Mijozlar',
      'Nasiya',
      'Xarajatlar',
      'Hisobotlar',
      'To‘lov',
      'Sozlamalar',
    ]);
  });

  it('har bir bo‘limda permission va noyob yo‘l bor', () => {
    for (const item of NAV_ITEMS) expect(item.anyOf.length, item.key).toBeGreaterThan(0);
    expect(new Set(NAV_ITEMS.map((i) => i.path)).size).toBe(NAV_ITEMS.length);
  });

  it('ADMIN barcha bo‘limlarni ko‘radi', () => {
    const visible = NAV_ITEMS.filter((i) => hasAnyPermission(ROLE_PERMISSIONS.ADMIN, i.anyOf));
    expect(visible).toHaveLength(NAV_ITEMS.length);
  });

  it('USER faqat Bosh sahifa, Mahsulotlar, Sotuvlar va Xarajatlarni ko‘radi (D-04, D-12, RBAC.md)', () => {
    const visible = NAV_ITEMS.filter((i) =>
      hasAnyPermission(ROLE_PERMISSIONS[RoleCode.USER], i.anyOf),
    ).map((i) => i.key);
    expect(visible).toEqual(['dashboard', 'products', 'sales', 'expenses']);
  });
});
