import { AuditAction, AuditEntityType, RoleCode } from '@divine/shared';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { generatePassword, type PasswordHasher } from '../password/password-hasher.js';

export type BootstrapResult =
  | { status: 'created'; userId: string; login: string; password: string }
  | { status: 'admin_exists' }
  | { status: 'login_taken' }
  | { status: 'roles_missing' };

/** Barcha bootstrap jarayonlari uchun bitta advisory lock kaliti (parallel ishga tushirish). */
const BOOTSTRAP_LOCK_KEY = 'divine.uz:bootstrap-admin';

/**
 * Birinchi ADMIN (A-21, D-10). Faqat CLI'dan chaqiriladi — HTTP endpoint yo'q.
 *
 * - Tizimda kamida bitta ADMIN bo'lsa — hech narsa yaratilmaydi (`admin_exists`).
 * - Parallel ishga tushirish: tranzaksiya `pg_advisory_xact_lock` bilan ketma-ketlashtiriladi —
 *   ikkinchi jarayon birinchisi COMMIT qilgach ADMIN'ni ko'radi va rad etiladi.
 * - Parol server tomonida generatsiya qilinadi (6 raqam, CSPRNG), DB'ga faqat hash yoziladi;
 *   ochiq parol faqat natijada qaytadi va CLI uni terminalga bir marta chiqaradi.
 * - Audit: `USER_CREATED` (actor — tizim, metadata'da parolsiz).
 */
export async function bootstrapAdmin(
  prisma: PrismaClient,
  hasher: PasswordHasher,
  input: { login: string; fullName?: string | null },
): Promise<BootstrapResult> {
  const password = generatePassword();
  const passwordHash = await hasher.hash(password);

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BOOTSTRAP_LOCK_KEY}))`;

      const adminRole = await tx.role.findUnique({ where: { code: RoleCode.ADMIN } });
      if (!adminRole) return { status: 'roles_missing' as const };

      if ((await tx.user.count({ where: { roleId: adminRole.id } })) > 0) {
        return { status: 'admin_exists' as const };
      }
      const taken = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE lower(login) = lower(${input.login})`;
      if (taken.length > 0) return { status: 'login_taken' as const };

      const user = await tx.user.create({
        data: {
          login: input.login,
          passwordHash,
          fullName: input.fullName?.trim() || null,
          roleId: adminRole.id,
        },
        select: { id: true, login: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: AuditAction.USER_CREATED,
          entityType: AuditEntityType.USER,
          entityId: user.id,
          metadata: { login: user.login, role: RoleCode.ADMIN, bootstrap: true },
        },
      });
      return { status: 'created' as const, userId: user.id, login: user.login, password };
    },
    { maxWait: 30_000, timeout: 60_000 },
  );
}
