import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from '@divine/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { pgPoolConfig } from '../../src/database/pg-connection.js';
import { DEFAULT_SETTINGS } from '../../src/database/seed/reference-data.js';
import { seedReferenceData } from '../../src/database/seed/seed-reference-data.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(inject('databaseUrl'))) });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function permissionsOf(code: 'ADMIN' | 'USER'): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { role: { code } },
    select: { permission: { select: { code: true } } },
  });
  return rows.map((r) => r.permission.code).sort();
}

describe('seed (global setup `pnpm db:seed` CLI orqali bajarilgan)', () => {
  it('ADMIN va USER rollari, RBAC katalogidagi barcha permissionlar', async () => {
    const roles = await prisma.role.findMany({ orderBy: { code: 'asc' } });
    expect(roles.map((r) => [r.code, r.name])).toEqual([
      ['ADMIN', 'Administrator'],
      ['USER', 'Foydalanuvchi'],
    ]);
    const permissions = await prisma.permission.findMany();
    expect(permissions.map((p) => p.code).sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(permissions.every((p) => p.description.trim().length > 0)).toBe(true);
  });

  it('rol → permission xaritasi @divine/shared ROLE_PERMISSIONS bilan aynan bir xil', async () => {
    expect(await permissionsOf('ADMIN')).toEqual([...ROLE_PERMISSIONS.ADMIN].sort());
    expect(await permissionsOf('USER')).toEqual([...ROLE_PERMISSIONS.USER].sort());
  });

  it('tasdiqlangan standart sozlamalar', async () => {
    const settings = await prisma.setting.findMany({
      where: { key: { in: Object.keys(DEFAULT_SETTINGS) } },
    });
    expect(Object.fromEntries(settings.map((s) => [s.key, s.value]))).toEqual({
      company_name: 'Divine.uz',
      low_stock_default_threshold: '5',
      currency_label: 'so‘m',
    });
  });

  it('D-19: seed xarajat kategoriyasi va xarajat yaratmaydi (boshlang‘ich ro‘yxat bo‘sh, ADMIN qo‘shadi)', async () => {
    const before = [await prisma.expenseCategory.count(), await prisma.expense.count()];
    await seedReferenceData(prisma);
    expect([await prisma.expenseCategory.count(), await prisma.expense.count()]).toEqual(before);
  });

  it('seed‘da hech qanday user (va parol) yaratilmaydi', async () => {
    const seededUsers = await prisma.user.count({ where: { createdById: null, login: 'admin' } });
    expect(seededUsers).toBe(0);
  });
});

describe('seed idempotentligi va sinxronizatsiya', () => {
  it('takroriy ishga tushirish holatni o‘zgartirmaydi', async () => {
    const before = await prisma.rolePermission.count();
    const summary = await seedReferenceData(prisma);
    expect(summary).toEqual({
      roles: 2,
      permissions: ALL_PERMISSIONS.length,
      removedPermissions: [],
      rolePermissions: ROLE_PERMISSIONS.ADMIN.length + ROLE_PERMISSIONS.USER.length,
      insertedSettings: [],
    });
    expect(await prisma.rolePermission.count()).toBe(before);
  });

  it('admin o‘zgartirgan sozlama qayta seed‘da ustidan yozilmaydi', async () => {
    await prisma.setting.update({
      where: { key: 'company_name' },
      data: { value: 'Mening do‘konim' },
    });
    try {
      await seedReferenceData(prisma);
      const setting = await prisma.setting.findUniqueOrThrow({ where: { key: 'company_name' } });
      expect(setting.value).toBe('Mening do‘konim');
    } finally {
      await prisma.setting.update({ where: { key: 'company_name' }, data: { value: 'Divine.uz' } });
    }
  });

  it('katalogda yo‘q permission va ortiqcha rol bog‘lanishi olib tashlanadi', async () => {
    const stale = await prisma.permission.create({
      data: { code: 'legacy.feature', description: 'Eski funksiya' },
    });
    const userRole = await prisma.role.findUniqueOrThrow({ where: { code: 'USER' } });
    const reports = await prisma.permission.findUniqueOrThrow({ where: { code: 'reports.read' } });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: userRole.id, permissionId: stale.id },
        { roleId: userRole.id, permissionId: reports.id },
      ],
    });

    const summary = await seedReferenceData(prisma);
    expect(summary.removedPermissions).toEqual(['legacy.feature']);
    expect(await prisma.permission.findUnique({ where: { code: 'legacy.feature' } })).toBeNull();
    expect(await permissionsOf('USER')).toEqual([...ROLE_PERMISSIONS.USER].sort());
  });
});
