import { Injectable } from '@nestjs/common';
import type { RoleCode, SortSpec, UserDto, UserStatus, WarehouseOption } from '@divine/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { toPrismaOrderBy, toPrismaPagination } from '../../common/query/prisma-query.js';

/** Javobga chiqadigan maydonlar — parol hash'i, sessiyalar va lockout hisoblagichlari tanlanmaydi. */
const USER_SELECT = {
  id: true,
  login: true,
  fullName: true,
  status: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { code: true } },
  warehouses: {
    select: { warehouse: { select: { id: true, name: true } } },
    orderBy: { warehouse: { name: 'asc' } },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export type UserSortField = 'login' | 'createdAt' | 'lastLoginAt';

export interface ListUsersQuery {
  page: number;
  pageSize: number;
  sort: SortSpec<UserSortField>;
  search?: string;
  role?: RoleCode;
  status?: UserStatus;
}

/** O'zgartirishdan oldin qulflangan user holati (`FOR UPDATE`). */
export interface LockedUser {
  id: string;
  login: string;
  fullName: string | null;
  role: RoleCode;
  status: UserStatus;
  lockedUntil: Date | null;
  warehouseIds: string[];
}

/** LIKE maxsus belgilari (`%`, `_`, `\`) qidiruv matnida oddiy belgi sifatida qidirilsin. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * Bir vaqtda faol ADMIN'lar sonini kamaytirishi mumkin bo'lgan amallar uchun bitta advisory lock
 * (BR-27): ikki admin bir-birini bir vaqtda bloklasa/USER qilsa ham kamida bittasi qoladi.
 */
const ACTIVE_ADMINS_LOCK_KEY = 'divine.uz:active-admins';

/** Users uchun data access (ARCHITECTURE §4): faqat SQL/Prisma, biznes qarorlarsiz. */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListUsersQuery, now: Date): Promise<{ rows: UserDto[]; total: number }> {
    const search = query.search ? escapeLike(query.search) : undefined;
    const where: Prisma.UserWhereInput = {
      ...(search
        ? {
            OR: [
              { login: { contains: search, mode: 'insensitive' } },
              { fullName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.role ? { role: { code: query.role } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const orderBy = toPrismaOrderBy<UserSortField, Prisma.UserOrderByWithRelationInput>(
      query.sort,
      {
        login: (direction) => ({ login: direction }),
        createdAt: (direction) => ({ createdAt: direction }),
        lastLoginAt: (direction) => ({ lastLoginAt: { sort: direction, nulls: 'last' } }),
      },
      { id: 'asc' },
    );
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy,
        select: USER_SELECT,
        ...toPrismaPagination(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return { rows: rows.map((row) => toUserDto(row, now)), total };
  }

  async findDto(
    id: string,
    now: Date,
    client: Tx | PrismaService = this.prisma,
  ): Promise<UserDto | null> {
    const row = await client.user.findUnique({ where: { id }, select: USER_SELECT });
    return row ? toUserDto(row, now) : null;
  }

  /** User qatorini tranzaksiya oxirigacha qulflaydi: bir userga parallel o'zgarishlar ketma-ket. */
  async lockUser(tx: Tx, id: string): Promise<LockedUser | null> {
    const rows = await tx.$queryRaw<Omit<LockedUser, 'warehouseIds'>[]>`
      SELECT u.id, u.login, u.full_name AS "fullName", r.code AS role, u.status,
             u.locked_until AS "lockedUntil"
        FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ${id}::uuid
         FOR UPDATE OF u`;
    const user = rows[0];
    if (!user) return null;
    const links = await tx.userWarehouse.findMany({
      where: { userId: id },
      select: { warehouseId: true },
    });
    return { ...user, warehouseIds: links.map((link) => link.warehouseId) };
  }

  async lockActiveAdmins(tx: Tx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ACTIVE_ADMINS_LOCK_KEY}))`;
  }

  async countActiveAdmins(tx: Tx, exceptUserId: string): Promise<number> {
    return tx.user.count({
      where: { status: 'ACTIVE', role: { code: 'ADMIN' }, id: { not: exceptUserId } },
    });
  }

  async loginTaken(tx: Tx, login: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE lower(login) = lower(${login})`;
    return rows.length > 0;
  }

  async roleId(tx: Tx, code: RoleCode): Promise<number | null> {
    const role = await tx.role.findUnique({ where: { code }, select: { id: true } });
    return role?.id ?? null;
  }

  async findWarehouses(
    tx: Tx,
    ids: readonly string[],
  ): Promise<{ id: string; status: 'ACTIVE' | 'INACTIVE' }[]> {
    if (ids.length === 0) return [];
    return tx.warehouse.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, status: true },
    });
  }

  async activeWarehouseOptions(): Promise<WarehouseOption[]> {
    return this.prisma.warehouse.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, address: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async createUser(
    tx: Tx,
    data: {
      login: string;
      fullName: string | null;
      roleId: number;
      passwordHash: string;
      passwordChangedAt: Date;
      createdById: string;
    },
  ): Promise<string> {
    const user = await tx.user.create({ data, select: { id: true } });
    return user.id;
  }

  async updateUser(tx: Tx, id: string, data: Prisma.UserUncheckedUpdateInput): Promise<void> {
    await tx.user.update({ where: { id }, data, select: { id: true } });
  }

  /** Ombor biriktirishlarini `next` ro'yxatiga keltiradi (to'liq almashtirish). */
  async replaceWarehouses(
    tx: Tx,
    userId: string,
    current: readonly string[],
    next: readonly string[],
    actorId: string,
  ): Promise<{ added: string[]; removed: string[] }> {
    const added = next.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !next.includes(id));
    if (removed.length > 0) {
      await tx.userWarehouse.deleteMany({ where: { userId, warehouseId: { in: removed } } });
    }
    if (added.length > 0) {
      await tx.userWarehouse.createMany({
        data: added.map((warehouseId) => ({ userId, warehouseId, createdById: actorId })),
      });
    }
    return { added, removed };
  }

  /** Userning barcha faol sessiyalarini bekor qiladi (BR-28, BR-29). Qaytaradi: nechta. */
  async revokeAllSessions(
    tx: Tx,
    userId: string,
    reason: 'USER_BLOCKED' | 'PASSWORD_RESET',
    now: Date,
  ): Promise<number> {
    const result = await tx.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    return result.count;
  }
}

function toUserDto(row: UserRow, now: Date): UserDto {
  return {
    id: row.id,
    login: row.login,
    fullName: row.fullName,
    role: row.role.code,
    status: row.status,
    lockedUntil: row.lockedUntil && row.lockedUntil > now ? row.lockedUntil.toISOString() : null,
    warehouses: row.warehouses.map((link) => link.warehouse),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
