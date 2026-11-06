import { ALL_PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from '@divine/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { DEFAULT_SETTINGS, PERMISSION_DESCRIPTIONS, ROLE_NAMES } from './reference-data.js';

export interface SeedSummary {
  roles: number;
  permissions: number;
  /** Katalogdan olib tashlangan (DB'dan o'chirilgan) permission kodlari. */
  removedPermissions: string[];
  rolePermissions: number;
  /** Shu ishga tushirishda yangi yozilgan sozlama kalitlari. */
  insertedSettings: string[];
}

/**
 * Idempotent seed: rollar, permission katalogi, rol → permission xaritasi va standart sozlamalar.
 *
 * - Rollar va permissionlar `@divine/shared` bilan SINXRONLANADI (yo'g'i qo'shiladi, tavsif yangilanadi,
 *   katalogda yo'qlari o'chiriladi) — permissionlar kodda hardcode bo'lib qolmaydi, DB'da ham to'liq.
 * - Sozlamalar faqat mavjud bo'lmasa yoziladi.
 * - Hammasi bitta tranzaksiyada: yarim seed holati bo'lmaydi.
 *
 * Birinchi admin bu yerda yaratilmaydi: parol hash'i (argon2id + pepper) Phase 4 auth modulida
 * paydo bo'ladi va admin bootstrap o'sha yerda CLI sifatida qo'shiladi (docs/DATABASE.md §9).
 */
/** Masofadagi baza (Neon, noutbukdan): ko'p ketma-ket so'rov Prisma'ning standart 5 soniyasiga sig'maydi. */
const SEED_TRANSACTION_OPTIONS = { maxWait: 30_000, timeout: 180_000 };

export async function seedReferenceData(prisma: PrismaClient): Promise<SeedSummary> {
  return prisma.$transaction(async (tx) => {
    for (const code of ROLE_CODES) {
      await tx.role.upsert({
        where: { code },
        create: { code, name: ROLE_NAMES[code] },
        update: { name: ROLE_NAMES[code] },
      });
    }

    for (const code of ALL_PERMISSIONS) {
      await tx.permission.upsert({
        where: { code },
        create: { code, description: PERMISSION_DESCRIPTIONS[code] },
        update: { description: PERMISSION_DESCRIPTIONS[code] },
      });
    }

    const stale = await tx.permission.findMany({
      where: { code: { notIn: [...ALL_PERMISSIONS] } },
      select: { code: true },
    });
    // role_permissions ON DELETE CASCADE bilan birga o'chadi.
    await tx.permission.deleteMany({ where: { code: { in: stale.map((p) => p.code) } } });

    const roles = await tx.role.findMany({ select: { id: true, code: true } });
    const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
    const permissionId = new Map(permissions.map((p) => [p.code, p.id]));

    let rolePermissions = 0;
    for (const role of roles) {
      const wanted = ROLE_PERMISSIONS[role.code].map((code) => {
        const id = permissionId.get(code);
        if (id === undefined) throw new Error(`Permission topilmadi: ${code}`);
        return id;
      });
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wanted } },
      });
      await tx.rolePermission.createMany({
        data: wanted.map((id) => ({ roleId: role.id, permissionId: id })),
        skipDuplicates: true,
      });
      rolePermissions += wanted.length;
    }

    const insertedSettings: string[] = [];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      const created = await tx.setting.createMany({ data: [{ key, value }], skipDuplicates: true });
      if (created.count > 0) insertedSettings.push(key);
    }

    return {
      roles: roles.length,
      permissions: permissions.length,
      removedPermissions: stale.map((p) => p.code),
      rolePermissions,
      insertedSettings,
    };
  }, SEED_TRANSACTION_OPTIONS);
}
