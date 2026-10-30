import { Injectable } from '@nestjs/common';
import type { CurrentUser, Permission, RoleCode, UserStatus } from '@divine/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';

export interface LoginCandidate {
  id: string;
  login: string;
  passwordHash: string;
  status: UserStatus;
  lockedUntil: Date | null;
}

export interface AuthUser {
  id: string;
  login: string;
  status: UserStatus;
  roleId: number;
  role: RoleCode;
  passwordChangedAt: Date;
  warehouseIds: string[];
}

export interface SessionRow {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface FailureResult {
  /** Shu urinish lock'ni boshlab berdi. */
  justLocked: boolean;
  /** Urinish paytida user allaqachon lock'da edi (parallel urinish) — hisoblanmadi. */
  alreadyLocked: boolean;
  lockedUntil: Date | null;
  lockoutCount: number;
}

export interface LockoutPolicy {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
}

/** Auth uchun data access (ARCHITECTURE §4): faqat SQL/Prisma, biznes qarorlarsiz. */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Login bo'yicha (case-insensitive, `users_login_lower_key` index). */
  async findLoginCandidate(login: string): Promise<LoginCandidate | null> {
    const rows = await this.prisma.$queryRaw<LoginCandidate[]>`
      SELECT id, login, password_hash AS "passwordHash", status, locked_until AS "lockedUntil"
        FROM users WHERE lower(login) = lower(${login})`;
    return rows[0] ?? null;
  }

  /**
   * Muvaffaqiyatsiz urinish — ATOMIK (SECURITY §4). Qator lock qilinadi, shuning uchun parallel
   * urinishlar ketma-ket hisoblanadi. User lock'da bo'lsa urinish hisoblanmaydi (lock vaqtida kelgan
   * parallel urinishlar keyingi lock'ni "oldindan" to'plamasligi uchun).
   * N-xato → `lockout_count + 1`, `locked_until = now + min(base × 2^lockout_count, max)`, hisoblagich 0.
   */
  async registerFailure(
    tx: Tx,
    userId: string,
    now: Date,
    policy: LockoutPolicy,
  ): Promise<FailureResult> {
    const rows = await tx.$queryRaw<
      { lockedUntil: Date | null; lockoutCount: number; justLocked: boolean }[]
    >`
      UPDATE users SET
        failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= ${policy.maxAttempts}
                                     THEN 0 ELSE failed_login_attempts + 1 END,
        locked_until = CASE WHEN failed_login_attempts + 1 >= ${policy.maxAttempts}
                            THEN ${now}::timestamptz + make_interval(secs =>
                                   LEAST(${policy.baseMs}::float8 * power(2, lockout_count), ${policy.maxMs}::float8) / 1000)
                            ELSE locked_until END,
        lockout_count = CASE WHEN failed_login_attempts + 1 >= ${policy.maxAttempts}
                             THEN lockout_count + 1 ELSE lockout_count END,
        updated_at = ${now}
      WHERE id = ${userId}::uuid AND (locked_until IS NULL OR locked_until <= ${now})
      RETURNING locked_until AS "lockedUntil", lockout_count AS "lockoutCount",
                (locked_until IS NOT NULL AND locked_until > ${now}) AS "justLocked"`;
    if (rows[0]) return { ...rows[0], alreadyLocked: false };
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: { lockedUntil: true, lockoutCount: true },
    });
    return {
      justLocked: false,
      alreadyLocked: true,
      lockedUntil: current?.lockedUntil ?? null,
      lockoutCount: current?.lockoutCount ?? 0,
    };
  }

  /**
   * Muvaffaqiyatli login: hisoblagichlar nolga (SECURITY §4). Shartli — parallel xato urinish shu orada
   * lock qilgan bo'lsa, `false` (to'g'ri parol ham lock'ni chetlab o'tmaydi).
   */
  async registerSuccess(tx: Tx, userId: string, now: Date): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE users SET failed_login_attempts = 0, lockout_count = 0, locked_until = NULL,
                       last_login_at = ${now}, updated_at = ${now}
       WHERE id = ${userId}::uuid AND (locked_until IS NULL OR locked_until <= ${now})`;
    return updated === 1;
  }

  /**
   * Pepper rotation (SECURITY §13): eski versiyadagi hash'ni yangisiga almashtirish. Parol o'zgarmaydi —
   * `password_changed_at` va sessiyalarga tegilmaydi. Shartli: shu orada parol tiklangan bo'lsa (hash
   * boshqa) — hech narsa yozilmaydi (eski parolning hash'i yangisining ustidan yozilmasin).
   */
  async upgradePasswordHash(tx: Tx, userId: string, from: string, to: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE users SET password_hash = ${to}
       WHERE id = ${userId}::uuid AND password_hash = ${from}`;
  }

  /** `before`dan oldin muddati tugagan yoki bekor qilingan sessiyalar (faollari emas). `replaced_by` — SET NULL. */
  async deleteStaleSessions(before: Date): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM user_sessions WHERE expires_at < ${before} OR revoked_at < ${before}`;
  }

  async createSession(
    tx: Tx,
    data: {
      userId: string;
      tokenHash: string;
      familyId?: string;
      expiresAt: Date;
      now: Date;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<{ id: string; familyId: string }> {
    const session = await tx.userSession.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        familyId: data.familyId ?? crypto.randomUUID(),
        expiresAt: data.expiresAt,
        createdAt: data.now,
        ip: data.ip,
        userAgent: data.userAgent?.slice(0, 300) ?? null,
      },
      select: { id: true, familyId: true },
    });
    return session;
  }

  /** Refresh token bo'yicha sessiya — `FOR UPDATE`: parallel refresh'lar ketma-ket bajariladi. */
  async lockSessionByTokenHash(tx: Tx, tokenHash: string): Promise<SessionRow | null> {
    const rows = await tx.$queryRaw<SessionRow[]>`
      SELECT id, user_id AS "userId", family_id AS "familyId", expires_at AS "expiresAt",
             revoked_at AS "revokedAt", revoked_reason AS "revokedReason"
        FROM user_sessions WHERE token_hash = ${tokenHash} FOR UPDATE`;
    return rows[0] ?? null;
  }

  async revokeSession(
    tx: Tx,
    id: string,
    reason: 'LOGOUT' | 'ROTATED' | 'USER_BLOCKED',
    now: Date,
    replacedById?: string,
  ): Promise<void> {
    await tx.userSession.update({
      where: { id },
      data: { revokedAt: now, revokedReason: reason, replacedById, lastUsedAt: now },
    });
  }

  /** Reuse detection: butun family (shu zanjirdagi barcha ochiq sessiyalar) bekor qilinadi. */
  async revokeFamily(tx: Tx, familyId: string, now: Date): Promise<number> {
    const result = await tx.userSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'REUSE_DETECTED' },
    });
    return result.count;
  }

  /** Logout: ochiq sessiyani yopadi; topilmasa yoki allaqachon yopilgan bo'lsa — null. */
  async revokeByTokenHash(
    tx: Tx,
    tokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string } | null> {
    const rows = await tx.$queryRaw<{ id: string; userId: string }[]>`
      UPDATE user_sessions SET revoked_at = ${now}, revoked_reason = 'LOGOUT', last_used_at = ${now}
       WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
      RETURNING id, user_id AS "userId"`;
    return rows[0] ?? null;
  }

  /** JwtAuthGuard: har so'rovda PK bo'yicha (SECURITY §1 — bloklash darhol kuchga kiradi). */
  async findAuthUser(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        login: true,
        status: true,
        roleId: true,
        passwordChangedAt: true,
        role: { select: { code: true } },
        warehouses: { select: { warehouseId: true } },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      login: user.login,
      status: user.status,
      roleId: user.roleId,
      role: user.role.code,
      passwordChangedAt: user.passwordChangedAt,
      warehouseIds: user.warehouses.map((w) => w.warehouseId),
    };
  }

  async permissionsForRole(roleId: number): Promise<Permission[]> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { code: true } } },
    });
    return rows.map((row) => row.permission.code as Permission);
  }

  /** `GET /auth/me` va login javobi uchun `CurrentUser` (API §2). */
  async loadCurrentUser(
    userId: string,
    client: Tx | PrismaService = this.prisma,
  ): Promise<CurrentUser | null> {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        login: true,
        fullName: true,
        status: true,
        role: {
          select: {
            code: true,
            permissions: { select: { permission: { select: { code: true } } } },
          },
        },
        warehouses: { select: { warehouseId: true }, orderBy: { warehouseId: 'asc' } },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      role: user.role.code,
      status: user.status,
      permissions: user.role.permissions.map((rp) => rp.permission.code as Permission).sort(),
      warehouseIds: user.warehouses.map((w) => w.warehouseId),
    };
  }
}
