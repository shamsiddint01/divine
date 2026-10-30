import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  type CreateUserInput,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  type Paginated,
  type PasswordResetResponse,
  type UpdateUserInput,
  type UserCreatedResponse,
  type UserDto,
  type UserStatus,
  type WarehouseOption,
} from '@divine/shared';
import type { AccessContext } from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { Clock } from '../../common/time/clock.js';
import { type Tx, TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import { generatePassword, PasswordHasher } from '../auth/password/password-hasher.js';
import { type ListUsersQuery, type LockedUser, UsersRepository } from './users.repository.js';

/**
 * Users moduli (Phase 5, API §4, BR-01…04, BR-27…29). Har bir mutatsiya bitta tranzaksiyada va
 * audit shu tranzaksiya ichida (BR-24). Kim bajarayotgani — faqat tasdiqlangan tokendan (`ctx`).
 *
 * Holat (`ACTIVE`/`BLOCKED`, admin boshqaradi) va login lockout (`locked_until`, vaqtinchalik) — ALOHIDA:
 * bloklash/blokdan chiqarish lockout'ga tegmaydi; parol tiklash lockout'ni tozalaydi (yangi parol —
 * yangi boshlanish), holatni esa o'zgartirmaydi.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
  ) {}

  async list(query: ListUsersQuery): Promise<Paginated<UserDto>> {
    const { rows, total } = await this.repository.list(query, this.clock.now());
    return toPaginated(rows, total, query);
  }

  async get(id: string): Promise<UserDto> {
    return (await this.repository.findDto(id, this.clock.now())) ?? notFound();
  }

  warehouseOptions(): Promise<WarehouseOption[]> {
    return this.repository.activeWarehouseOptions();
  }

  /** BR-01…04: parolni server yaratadi (CSPRNG), DB'ga faqat argon2id hash; parol javobda bir marta. */
  async create(
    ctx: AccessContext,
    input: CreateUserInput,
    meta: RequestMeta,
  ): Promise<UserCreatedResponse> {
    const generatedPassword = generatePassword();
    // Argon2 (~200 ms) tranzaksiyadan tashqarida: qulflar keraksiz ushlanmasin.
    const passwordHash = await this.hasher.hash(generatedPassword);
    const user = await this.transactions.run(async (tx) => {
      if (await this.repository.loginTaken(tx, input.login)) throw loginTaken();
      const roleId = (await this.repository.roleId(tx, input.role)) ?? notFound();
      await this.assertAssignable(tx, input.warehouseIds, []);
      const id = await this.repository.createUser(tx, {
        login: input.login,
        fullName: input.fullName ?? null,
        roleId,
        passwordHash,
        passwordChangedAt: this.clock.now(),
        createdById: ctx.userId,
      });
      await this.repository.replaceWarehouses(tx, id, [], input.warehouseIds, ctx.userId);
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.USER_CREATED,
          entityType: AuditEntityType.USER,
          entityId: id,
          metadata: { login: input.login, role: input.role, warehouseIds: input.warehouseIds },
          meta,
        },
        tx,
      );
      return (await this.repository.findDto(id, this.clock.now(), tx)) ?? notFound();
    });
    return { user, generatedPassword };
  }

  /**
   * Ism, rol va omborlar — bitta tranzaksiyada (qisman saqlanish yo'q). O'z rolini o'zgartirish —
   * `403 CANNOT_MODIFY_SELF`; oxirgi faol ADMIN'ni USER qilish — `409 LAST_ACTIVE_ADMIN` (BR-27).
   */
  async update(
    ctx: AccessContext,
    id: string,
    input: UpdateUserInput,
    meta: RequestMeta,
  ): Promise<UserDto> {
    return this.transactions.run(async (tx) => {
      if (input.role !== undefined) await this.repository.lockActiveAdmins(tx);
      const user = (await this.repository.lockUser(tx, id)) ?? notFound();
      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (input.role !== undefined && input.role !== user.role) {
        if (user.id === ctx.userId) throw new AppError(ErrorCode.CANNOT_MODIFY_SELF);
        if (user.role === 'ADMIN') await this.assertNotLastActiveAdmin(tx, user);
        changes.role = { from: user.role, to: input.role };
      }
      const fullName = input.fullName === undefined ? undefined : (input.fullName ?? null);
      if (fullName !== undefined && fullName !== user.fullName) {
        changes.fullName = { from: user.fullName, to: fullName };
      }

      if (Object.keys(changes).length > 0) {
        await this.repository.updateUser(tx, id, {
          ...(changes.fullName ? { fullName } : {}),
          ...(changes.role
            ? { roleId: (await this.repository.roleId(tx, input.role!)) ?? notFound() }
            : {}),
        });
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.USER_UPDATED,
            entityType: AuditEntityType.USER,
            entityId: id,
            metadata: { login: user.login, changes },
            meta,
          },
          tx,
        );
      }
      if (input.warehouseIds !== undefined) {
        await this.applyWarehouses(tx, ctx, user, input.warehouseIds, meta);
      }
      return (await this.repository.findDto(id, this.clock.now(), tx)) ?? notFound();
    });
  }

  /** `PUT /users/:id/warehouses` — to'liq almashtirish (OWN-01…03 manbai). */
  async replaceWarehouses(
    ctx: AccessContext,
    id: string,
    warehouseIds: string[],
    meta: RequestMeta,
  ): Promise<UserDto> {
    return this.transactions.run(async (tx) => {
      const user = (await this.repository.lockUser(tx, id)) ?? notFound();
      await this.applyWarehouses(tx, ctx, user, warehouseIds, meta);
      return (await this.repository.findDto(id, this.clock.now(), tx)) ?? notFound();
    });
  }

  /**
   * BR-27, BR-28: o'zini bloklash — `403`; oxirgi faol ADMIN'ni bloklash — `409`. BLOCKED bo'lganda
   * barcha sessiyalar bekor qilinadi; himoyalangan so'rovlar esa guard'da darhol rad etiladi.
   * Lockout (`locked_until`) o'zgartirilmaydi.
   */
  async setStatus(
    ctx: AccessContext,
    id: string,
    status: UserStatus,
    meta: RequestMeta,
  ): Promise<UserDto> {
    if (id === ctx.userId) throw new AppError(ErrorCode.CANNOT_MODIFY_SELF);
    return this.transactions.run(async (tx) => {
      await this.repository.lockActiveAdmins(tx);
      const user = (await this.repository.lockUser(tx, id)) ?? notFound();
      if (user.status !== status) {
        if (status === 'BLOCKED' && user.role === 'ADMIN') {
          await this.assertNotLastActiveAdmin(tx, user);
        }
        const now = this.clock.now();
        await this.repository.updateUser(tx, id, { status });
        const revokedSessions =
          status === 'BLOCKED'
            ? await this.repository.revokeAllSessions(tx, id, 'USER_BLOCKED', now)
            : 0;
        await this.audit.record(
          {
            actorId: ctx.userId,
            action: AuditAction.USER_STATUS_CHANGED,
            entityType: AuditEntityType.USER,
            entityId: id,
            metadata: { login: user.login, from: user.status, to: status, revokedSessions },
            meta,
          },
          tx,
        );
      }
      return (await this.repository.findDto(id, this.clock.now(), tx)) ?? notFound();
    });
  }

  /**
   * BR-29: yangi 6 xonali parol (CSPRNG) → argon2id hash; `password_changed_at = now` (eski access
   * tokenlar `401 SESSION_EXPIRED`), barcha refresh sessiyalar bekor, lockout tozalanadi.
   * O'z parolini bu yo'l bilan tiklash — `403` (admin boshqa admin orqali tiklaydi).
   */
  async resetPassword(
    ctx: AccessContext,
    id: string,
    meta: RequestMeta,
  ): Promise<PasswordResetResponse> {
    if (id === ctx.userId) throw new AppError(ErrorCode.CANNOT_MODIFY_SELF);
    const generatedPassword = generatePassword();
    const passwordHash = await this.hasher.hash(generatedPassword);
    await this.transactions.run(async (tx) => {
      const user = (await this.repository.lockUser(tx, id)) ?? notFound();
      const now = this.clock.now();
      await this.repository.updateUser(tx, id, {
        passwordHash,
        passwordChangedAt: now,
        failedLoginAttempts: 0,
        lockoutCount: 0,
        lockedUntil: null,
      });
      const revokedSessions = await this.repository.revokeAllSessions(
        tx,
        id,
        'PASSWORD_RESET',
        now,
      );
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.USER_PASSWORD_RESET,
          entityType: AuditEntityType.USER,
          entityId: id,
          metadata: {
            login: user.login,
            revokedSessions,
            lockCleared: user.lockedUntil !== null && user.lockedUntil > now,
          },
          meta,
        },
        tx,
      );
    });
    return { generatedPassword };
  }

  private async applyWarehouses(
    tx: Tx,
    ctx: AccessContext,
    user: LockedUser,
    next: string[],
    meta: RequestMeta,
  ): Promise<void> {
    await this.assertAssignable(tx, next, user.warehouseIds);
    const { added, removed } = await this.repository.replaceWarehouses(
      tx,
      user.id,
      user.warehouseIds,
      next,
      ctx.userId,
    );
    if (added.length === 0 && removed.length === 0) return;
    await this.audit.record(
      {
        actorId: ctx.userId,
        action: AuditAction.USER_WAREHOUSES_CHANGED,
        entityType: AuditEntityType.USER,
        entityId: user.id,
        metadata: { login: user.login, added, removed, warehouseIds: next },
        meta,
      },
      tx,
    );
  }

  /**
   * Har bir ombor mavjud bo'lishi shart (`404`). YANGI biriktiriladigan ombor ACTIVE bo'lishi shart
   * (`422 WAREHOUSE_INACTIVE`); keyin nofaol bo'lib qolgan, avvaldan biriktirilgan ombor saqlanishi
   * mumkin — aks holda boshqa maydonni tahrirlab bo'lmay qolardi.
   */
  private async assertAssignable(
    tx: Tx,
    ids: readonly string[],
    current: readonly string[],
  ): Promise<void> {
    const found = await this.repository.findWarehouses(tx, ids);
    const missing = ids.filter((id) => !found.some((w) => w.id === id));
    if (missing.length > 0) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        details: [{ field: 'warehouseIds', message: ERROR_MESSAGES_UZ.NOT_FOUND }],
      });
    }
    const inactiveAdded = found.filter((w) => w.status !== 'ACTIVE' && !current.includes(w.id));
    if (inactiveAdded.length > 0) {
      throw new AppError(ErrorCode.WAREHOUSE_INACTIVE, {
        details: [{ field: 'warehouseIds', message: ERROR_MESSAGES_UZ.WAREHOUSE_INACTIVE }],
      });
    }
  }

  /** Faol ADMIN'ning roli yoki holati o'zgarsa — kamida bitta boshqa faol ADMIN qolishi shart. */
  private async assertNotLastActiveAdmin(tx: Tx, user: LockedUser): Promise<void> {
    if (user.status !== 'ACTIVE') return;
    if ((await this.repository.countActiveAdmins(tx, user.id)) === 0) {
      throw new AppError(ErrorCode.LAST_ACTIVE_ADMIN);
    }
  }
}

function notFound(): never {
  throw new AppError(ErrorCode.NOT_FOUND);
}

function loginTaken(): AppError {
  return new AppError(ErrorCode.LOGIN_TAKEN, {
    details: [{ field: 'login', message: ERROR_MESSAGES_UZ.LOGIN_TAKEN }],
  });
}
